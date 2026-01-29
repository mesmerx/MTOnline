import { create } from 'zustand';
import Peer from 'peerjs';
import type { DataConnection, PeerJSOption } from 'peerjs';
import { randomId } from '../lib/id';
import type { DeckEntry, SavedDeck } from '../lib/deck';
import { loadDecks as loadLocalDecks, saveDeck as saveLocalDeck, deleteDeck as deleteLocalDeck } from '../lib/deck';
import { debugLog } from '../lib/debug';

export interface PlayerSummary {
  id: string;
  name: string;
  life?: number;
  commanderDamage?: Record<string, number>; // Record<attackerPlayerId, damage>
}

export interface Point {
  x: number;
  y: number;
}

export interface CardOnBoard {
  id: string;
  name: string;
  ownerId: string; // Nome do jogador dono da carta (não ID)
  imageUrl?: string;
  backImageUrl?: string; // Imagem do verso da carta (para cartas com duas faces)
  oracleText?: string;
  manaCost?: string;
  typeLine?: string;
  setName?: string;
  position: Point;
  tapped: boolean;
  zone: 'battlefield' | 'library' | 'hand' | 'cemetery';
  stackIndex?: number; // Para cartas empilhadas no grimório
  handIndex?: number; // Para ordenar cartas na mão
  flipped?: boolean; // Se a carta está virada (mostrando o verso)
}

export type CounterType = 'numeral' | 'plus';

export interface Counter {
  id: string;
  ownerId: string; // Nome do jogador que criou o contador (não ID)
  type: CounterType;
  position: Point; // Posição absoluta do contador no board
  // Para tipo 'numeral'
  value?: number;
  // Para tipo 'plus'
  plusX?: number;
  plusY?: number;
}

export interface NewCardPayload {
  name: string;
  imageUrl?: string;
  oracleText?: string;
  manaCost?: string;
  typeLine?: string;
  setName?: string;
  position?: Point;
}

type CardAction =
  | { kind: 'add'; card: CardOnBoard }
  | { kind: 'move'; id: string; position: Point }
  | { kind: 'moveLibrary'; playerName: string; position: Point }
  | { kind: 'moveCemetery'; playerName: string; position: Point }
  | { kind: 'toggleTap'; id: string }
  | { kind: 'remove'; id: string }
  | { kind: 'addToLibrary'; card: CardOnBoard }
  | { kind: 'replaceLibrary'; cards: CardOnBoard[]; playerName: string }
  | { kind: 'drawFromLibrary'; playerName: string }
  | { kind: 'changeZone'; id: string; zone: 'battlefield' | 'library' | 'hand' | 'cemetery'; position: Point; libraryPlace?: 'top' | 'bottom' | 'random' }
  | { kind: 'reorderHand'; cardId: string; newIndex: number; playerName: string }
  | { kind: 'reorderLibrary'; cardId: string; newIndex: number; playerName: string }
  | { kind: 'shuffleLibrary'; playerName: string }
  | { kind: 'mulligan'; playerName: string }
  | { kind: 'createCounter'; ownerId: string; type: CounterType; position: Point }
  | { kind: 'moveCounter'; counterId: string; position: Point }
  | { kind: 'modifyCounter'; counterId: string; delta?: number; deltaX?: number; deltaY?: number; setValue?: number; setX?: number; setY?: number }
  | { kind: 'removeCounterToken'; counterId: string }
  | { kind: 'setPlayerLife'; playerId: string; life: number }
  | { kind: 'flipCard'; id: string }
  | { kind: 'setSimulatedPlayers'; count: number }
  | { kind: 'setZoomedCard'; cardId: string | null }
  | { kind: 'setCommanderDamage'; targetPlayerId: string; attackerPlayerId: string; damage: number }
  | { kind: 'adjustCommanderDamage'; targetPlayerId: string; attackerPlayerId: string; delta: number };

type IncomingMessage =
  | { type: 'REQUEST_ACTION'; action: CardAction; actorId: string; skipEventSave?: boolean }
  | { type: 'BOARD_STATE'; board: CardOnBoard[]; counters?: Counter[]; cemeteryPositions?: Record<string, Point>; libraryPositions?: Record<string, Point> }
  | { type: 'ROOM_STATE'; board: CardOnBoard[]; counters?: Counter[]; players: PlayerSummary[]; simulatedPlayers?: PlayerSummary[]; cemeteryPositions?: Record<string, Point>; libraryPositions?: Record<string, Point> }
  | { type: 'PLAYER_STATE'; players: PlayerSummary[]; simulatedPlayers?: PlayerSummary[] }
  | { type: 'HOST_TRANSFER'; newHostId: string; board: CardOnBoard[]; counters?: Counter[]; players: PlayerSummary[]; cemeteryPositions?: Record<string, Point>; libraryPositions?: Record<string, Point> }
  | { type: 'ERROR'; message: string };

type RoomStatus = 'idle' | 'initializing' | 'waiting' | 'connected' | 'error';

const deriveStunUrlFromTurn = (turnUrl: string): string | undefined => {
  const match = turnUrl.match(/^(turns?):/i);
  if (!match) return undefined;
  const protocol = match[1]?.toLowerCase();
  const rest = turnUrl.slice(match[0].length);
  if (!protocol || !rest) return undefined;
  return `${protocol === 'turns' ? 'stuns' : 'stun'}:${rest}`;
};

const buildCoturnServers = (turnUrl: string, username?: string, credential?: string): RTCIceServer[] => {
  const servers: RTCIceServer[] = [];
  const stunUrl = deriveStunUrlFromTurn(turnUrl);
  if (stunUrl) {
    servers.push({ urls: stunUrl });
  }
  
  // Validar que username e credential estão presentes e não vazios antes de adicionar TURN
  if (username && credential && username.trim() !== '' && credential.trim() !== '') {
    servers.push({
      urls: turnUrl,
      username,
      credential,
    });
  } else {
    console.warn('[TURN] Ignorando servidor TURN sem credenciais válidas:', turnUrl);
  }
  
  return servers;
};

// Cache para credenciais TURN da API
let turnCredentialsCache: { username: string; credential: string; urls: string[]; expiresAt: number } | null = null;
let turnCredentialsPromise: Promise<void> | null = null;
let turnCredentialsInitialized = false;

const fetchTurnCredentials = async (): Promise<{ username: string; credential: string; urls: string[] } | null> => {
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  
  try {
    const startTime = performance.now();
    console.log('[TURN] Buscando credenciais da API...');
    const response = await fetch(`${API_URL}/api/turn-credentials`, {
      credentials: 'include',
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const fetchTime = performance.now() - startTime;
    const data = await response.json();
    const totalTime = performance.now() - startTime;
    console.log('[TURN] Credenciais recebidas da API:', {
      username: data.username,
      credential: data.credential,
      urls: data.urls,
      fetchTime: `${fetchTime.toFixed(2)}ms`,
      totalTime: `${totalTime.toFixed(2)}ms`,
    });
    
    // Cache válido por 50 minutos (menos que 1 hora para garantir validade)
    const expiresAt = Date.now() + (50 * 60 * 1000);
    turnCredentialsCache = {
      username: data.username,
      credential: data.credential,
      urls: data.urls,
      expiresAt,
    };
    
    return {
      username: data.username,
      credential: data.credential,
      urls: data.urls,
    };
  } catch (error) {
    console.warn('[TURN] Falha ao buscar credenciais da API, usando fallback local:', error);
    return null;
  }
};

const getTurnCredentials = async (): Promise<{ username: string; credential: string; urls: string[] } | null> => {
  // Verificar cache
  if (turnCredentialsCache && turnCredentialsCache.expiresAt > Date.now()) {
    console.log('[TURN] Usando credenciais do cache');
    return {
      username: turnCredentialsCache.username,
      credential: turnCredentialsCache.credential,
      urls: turnCredentialsCache.urls,
    };
  }
  
  // Se já há uma requisição em andamento, aguardar ela
  if (turnCredentialsPromise) {
    await turnCredentialsPromise;
    if (turnCredentialsCache && turnCredentialsCache.expiresAt > Date.now()) {
      return {
        username: turnCredentialsCache.username,
        credential: turnCredentialsCache.credential,
        urls: turnCredentialsCache.urls,
      };
    }
  }
  
  // Fazer nova requisição
  turnCredentialsPromise = fetchTurnCredentials().then(() => {
    turnCredentialsPromise = null;
  });
  await turnCredentialsPromise;
  
  if (turnCredentialsCache && turnCredentialsCache.expiresAt > Date.now()) {
    return {
      username: turnCredentialsCache.username,
      credential: turnCredentialsCache.credential,
      urls: turnCredentialsCache.urls,
    };
  }
  
  return null;
};

const parseIceServersFromEnv = (): RTCIceServer[] => {
  const env = import.meta.env;
  const internalIp = env.VITE_INTERNAL_IP;

  // Começar com lista vazia - apenas servidores locais
  let servers: RTCIceServer[] = [];

  if (env.VITE_PEER_ICE_SERVERS) {
    try {
      const parsed = JSON.parse(env.VITE_PEER_ICE_SERVERS);
      if (Array.isArray(parsed)) {
        // Filtrar apenas servidores locais e adicionar aos padrões
        const localServers = parsed.filter((server: RTCIceServer) => {
          const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
          return urls.some((url: string) => 
            url.includes('127.0.0.1') || 
            url.includes('0.0.0.0') || 
            url.includes('localhost') ||
            (internalIp && url.includes(internalIp)) ||
            url.includes('turn:127.0.0.1') ||
            url.includes('turn:0.0.0.0') ||
            (internalIp && url.includes(`turn:${internalIp}`)) ||
            url.includes('stun:127.0.0.1') ||
            url.includes('stun:0.0.0.0') ||
            (internalIp && url.includes(`stun:${internalIp}`))
          );
        });
        servers = [...servers, ...localServers];
      }
    } catch (error) {
      console.warn('Failed to parse VITE_PEER_ICE_SERVERS', error);
    }
  }

  const turnUrl = env.VITE_TURN_URL?.trim();
  if (turnUrl && (
    turnUrl.startsWith('turn:127.0.0.1') || 
    turnUrl.startsWith('turn:0.0.0.0') || 
    turnUrl.includes('localhost') ||
    (internalIp && turnUrl.includes(internalIp))
  )) {
    servers = [...servers, ...buildCoturnServers(turnUrl, env.VITE_TURN_USERNAME, env.VITE_TURN_CREDENTIAL)];
  }

  // Adicionar servidores TURN externos usando credenciais da API (se disponíveis no cache)
  if (turnCredentialsCache && turnCredentialsCache.expiresAt > Date.now()) {
    const { username, credential, urls } = turnCredentialsCache;
    console.log('[TURN] Adicionando servidores externos do cache:', { username, urls });
    
    if (urls && Array.isArray(urls)) {
      urls.forEach((url) => {
        if (url.startsWith('turn:') || url.startsWith('turns:')) {
          // Só adicionar se username e credential estiverem presentes e não vazios
          if (username && credential && username.trim() !== '' && credential.trim() !== '') {
            servers.push({
              urls: url,
              username,
              credential,
            });
          } else {
            console.warn('[TURN] Ignorando servidor TURN sem credenciais válidas:', url);
          }
        } else if (url.startsWith('stun:') || url.startsWith('stuns:')) {
          servers.push({ urls: url });
        }
      });
    }
  } else {
    // Se não há cache, verificar se já há uma busca em andamento (pré-carregamento)
    if (!turnCredentialsPromise) {
      // Iniciar busca se não houver pré-carregamento em andamento
      turnCredentialsPromise = getTurnCredentials().then(() => {
        turnCredentialsPromise = null;
        console.log('[TURN] Credenciais obtidas. Elas estarão disponíveis na próxima criação do peer.');
      }).catch((error) => {
        console.warn('[TURN] Erro ao buscar credenciais:', error);
        turnCredentialsPromise = null;
      });
    } else {
      console.log('[TURN] Busca de credenciais já em andamento (pré-carregamento). Peer criado sem servidores TURN externos por enquanto.');
    }
  }

  return servers;
};

const resolvePeerEndpoint = (): Omit<PeerJSOption, 'config'> => {
  const hasWindow = typeof window !== 'undefined';
  const env = import.meta.env;
  const defaultHost = hasWindow ? window.location.hostname : 'localhost';
  const isHttps = hasWindow ? window.location.protocol === 'https:' : false;
  const rawPort = env.VITE_PEER_PORT ?? (isHttps ? '443' : '9910');
  const port = Number(rawPort);
  const host = env.VITE_PEER_HOST || defaultHost;
  const secure = typeof env.VITE_PEER_SECURE === 'string' ? env.VITE_PEER_SECURE === 'true' : isHttps;
  // Remover aspas e espaços do path se vier do .env
  // O path deve corresponder exatamente ao path configurado no servidor PeerJS
  const rawPath = env.VITE_PEER_PATH || '/peerjs';
  const path = typeof rawPath === 'string' ? rawPath.replace(/^["']|["']$/g, '').trim() : '/peerjs';

  const result: Omit<PeerJSOption, 'config'> = {
    host,
    path,
    secure,
  };

  if (Number.isFinite(port)) {
    result.port = port;
  }

  console.log('[PeerJS] Configurando endpoint:', {
    host,
    port,
    path,
    secure,
    env: {
      VITE_PEER_HOST: env.VITE_PEER_HOST,
      VITE_PEER_PORT: env.VITE_PEER_PORT,
      VITE_PEER_PATH: env.VITE_PEER_PATH,
      VITE_PEER_SECURE: env.VITE_PEER_SECURE,
    },
  });

  return result;
};

interface TurnConfig {
  mode: 'env' | 'custom';
  url: string;
  username: string;
  credential: string;
}

const TURN_STORAGE_KEY = 'mtonline.turnConfig';
const defaultTurnConfig = (): TurnConfig => ({
  mode: 'env',
  url: '',
  username: '',
  credential: '',
});

const loadTurnConfig = (): TurnConfig => {
  if (typeof window === 'undefined') {
    return defaultTurnConfig();
  }
  try {
    const raw = window.localStorage.getItem(TURN_STORAGE_KEY);
    if (!raw) return defaultTurnConfig();
    const parsed = JSON.parse(raw) as TurnConfig;
    return parsed && typeof parsed === 'object' ? { ...defaultTurnConfig(), ...parsed } : defaultTurnConfig();
  } catch {
    return defaultTurnConfig();
  }
};

const persistTurnConfig = (config: TurnConfig) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TURN_STORAGE_KEY, JSON.stringify(config));
};

// Funções para event sourcing - salvar e carregar eventos
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Salvar um evento no backend
const saveEvent = async (roomId: string, eventType: string, eventData: CardAction, playerId?: string, playerName?: string): Promise<void> => {
  if (!roomId) return;
  
  try {
    await fetch(`${API_URL}/api/rooms/${roomId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        eventType,
        eventData,
        playerId,
        playerName,
      }),
    });
  } catch (error) {
    console.warn('[Store] Erro ao salvar evento:', error);
  }
};

// Carregar eventos e fazer replay para reconstruir o estado
const loadRoomStateFromEvents = async (roomId: string): Promise<{
  board: CardOnBoard[];
  counters: Counter[];
  players: PlayerSummary[];
  cemeteryPositions: Record<string, Point>;
  libraryPositions: Record<string, Point>;
} | null> => {
  if (!roomId) return null;
  
  try {
    const response = await fetch(`${API_URL}/api/rooms/${roomId}/events`, {
      credentials: 'include',
    });
    if (!response.ok) return null;
    
    const { events } = await response.json();
    if (!events || events.length === 0) {
      // Se não houver eventos, tentar carregar estado antigo (backward compatibility)
      const stateResponse = await fetch(`${API_URL}/api/rooms/${roomId}/state`, {
        credentials: 'include',
      });
      if (stateResponse.ok) {
        return await stateResponse.json();
      }
      return null;
    }
    
    // Replay dos eventos para reconstruir o estado
    let board: CardOnBoard[] = [];
    let counters: Counter[] = [];
    let players: PlayerSummary[] = [];
    let zoomedCard: string | null = null;
    let cemeteryPositions: Record<string, Point> = {};
    let libraryPositions: Record<string, Point> = {};
    
    // Funções auxiliares para aplicar ações (simplificadas para replay)
    const applyCardActionReplay = (currentBoard: CardOnBoard[], action: CardAction): CardOnBoard[] => {
      switch (action.kind) {
        case 'add':
          return [...currentBoard, action.card];
        case 'move':
          return currentBoard.map((c) => (c.id === action.id ? { ...c, position: action.position } : c));
        case 'toggleTap':
          return currentBoard.map((c) => (c.id === action.id ? { ...c, tapped: !c.tapped } : c));
        case 'remove':
          return currentBoard.filter((c) => c.id !== action.id);
        case 'addToLibrary':
          return [...currentBoard, { ...action.card, zone: 'library' }];
        case 'replaceLibrary':
          return currentBoard.filter((c) => !(c.zone === 'library' && c.ownerId === action.playerName)).concat(action.cards);
        case 'drawFromLibrary':
          const libraryCards = currentBoard.filter((c) => c.zone === 'library' && c.ownerId === action.playerName);
          if (libraryCards.length > 0) {
            const drawnCard = libraryCards[libraryCards.length - 1];
            return currentBoard.map((c) => (c.id === drawnCard.id ? { ...c, zone: 'hand' } : c));
          }
          return currentBoard;
        case 'changeZone':
          return currentBoard.map((c) => (c.id === action.id ? { ...c, zone: action.zone, position: action.position } : c));
        case 'reorderHand': {
          const card = currentBoard.find((c) => c.id === action.cardId);
          if (!card || card.zone !== 'hand' || card.ownerId !== action.playerName) return currentBoard;
          
          const handCards = currentBoard
            .filter((c) => c.zone === 'hand' && c.ownerId === action.playerName)
            .sort((a, b) => {
              if (a.handIndex !== undefined && b.handIndex !== undefined) {
                return a.handIndex - b.handIndex;
              }
              if (a.handIndex !== undefined) return -1;
              if (b.handIndex !== undefined) return 1;
              return a.id.localeCompare(b.id);
            });
          
          const oldIndex = handCards.findIndex((c) => c.id === action.cardId);
          if (oldIndex === -1) return currentBoard;
          
          const reordered = [...handCards];
          const [movedCard] = reordered.splice(oldIndex, 1);
          reordered.splice(action.newIndex, 0, movedCard);
          
          const updatedHandCards = reordered.map((c, idx) => ({
            ...c,
            handIndex: idx,
          }));
          
          const otherCards = currentBoard.filter((c) => !(c.zone === 'hand' && c.ownerId === action.playerName));
          return [...otherCards, ...updatedHandCards];
        }
        case 'reorderLibrary': {
          const card = currentBoard.find((c) => c.id === action.cardId);
          if (!card || card.zone !== 'library' || card.ownerId !== action.playerName) return currentBoard;
          
          const libraryCards = currentBoard
            .filter((c) => c.zone === 'library' && c.ownerId === action.playerName)
            .sort((a, b) => {
              if (a.stackIndex !== undefined && b.stackIndex !== undefined) {
                return (b.stackIndex ?? 0) - (a.stackIndex ?? 0); // Ordem reversa (topo primeiro)
              }
              if (a.stackIndex !== undefined) return -1;
              if (b.stackIndex !== undefined) return 1;
              return a.id.localeCompare(b.id);
            });
          
          const oldIndex = libraryCards.findIndex((c) => c.id === action.cardId);
          if (oldIndex === -1) return currentBoard;
          
          const reordered = [...libraryCards];
          const [movedCard] = reordered.splice(oldIndex, 1);
          reordered.splice(action.newIndex, 0, movedCard);
          
          // Atualizar stackIndex (ordem reversa - maior índice = topo)
          const updatedLibraryCards = reordered.map((c, idx) => ({
            ...c,
            stackIndex: reordered.length - 1 - idx,
          }));
          
          const otherCards = currentBoard.filter((c) => !(c.zone === 'library' && c.ownerId === action.playerName));
          return [...otherCards, ...updatedLibraryCards];
        }
        case 'shuffleLibrary':
          // Shuffle não precisa ser replayed exatamente, apenas manter as cartas
          return currentBoard;
        case 'mulligan':
          // Mulligan remove cartas da mão, mas não vamos reimplementar a lógica completa aqui
          return currentBoard;
        case 'flipCard':
          return currentBoard.map((c) => (c.id === action.id ? { ...c, flipped: !c.flipped } : c));
        default:
          return currentBoard;
      }
    };
    
    const applyCounterActionReplay = (currentCounters: Counter[], action: CardAction): Counter[] => {
      switch (action.kind) {
        case 'createCounter':
          return [...currentCounters, {
            id: `counter-${Date.now()}-${Math.random()}`,
            ownerId: action.ownerId,
            type: action.type,
            position: action.position,
            value: 1,
          }];
        case 'moveCounter':
          return currentCounters.map((c) => (c.id === action.counterId ? { ...c, position: action.position } : c));
        case 'modifyCounter':
          return currentCounters.map((c) => {
            if (c.id !== action.counterId) return c;
            const updated = { ...c };
            if (action.setValue !== undefined) updated.value = action.setValue;
            else if (action.delta !== undefined) updated.value = (updated.value || 1) + action.delta;
            if (action.setX !== undefined) updated.position = { ...updated.position, x: action.setX };
            else if (action.deltaX !== undefined) updated.position = { ...updated.position, x: updated.position.x + action.deltaX };
            if (action.setY !== undefined) updated.position = { ...updated.position, y: action.setY };
            else if (action.deltaY !== undefined) updated.position = { ...updated.position, y: updated.position.y + action.deltaY };
            return updated;
          });
        case 'removeCounterToken':
          return currentCounters.filter((c) => c.id !== action.counterId);
        default:
          return currentCounters;
      }
    };
    
    // Replay de cada evento
    for (const event of events) {
      const action = event.eventData as CardAction;
      
      // Aplicar ação no board
      board = applyCardActionReplay(board, action);
      
      // Aplicar ação nos counters
      counters = applyCounterActionReplay(counters, action);
      
      // Atualizar posições de library e cemetery
      if (action.kind === 'moveCemetery' && 'playerName' in action && 'position' in action) {
        cemeteryPositions = {
          ...cemeteryPositions,
          [action.playerName]: action.position,
        };
      } else if (action.kind === 'moveLibrary' && 'playerName' in action && 'position' in action) {
        libraryPositions = {
          ...libraryPositions,
          [action.playerName]: action.position,
        };
      }
      
      // Atualizar players (setPlayerLife)
      if (action.kind === 'setPlayerLife' && 'playerId' in action && 'life' in action) {
        const existingPlayer = players.find((p) => p.id === action.playerId);
        if (existingPlayer) {
          players = players.map((p) => (p.id === action.playerId ? { ...p, life: action.life } : p));
        }
      }
      
      // Atualizar commander damage
      if (action.kind === 'setCommanderDamage' && 'targetPlayerId' in action && 'attackerPlayerId' in action && 'damage' in action) {
        players = players.map((p) => {
          if (p.id === action.targetPlayerId) {
            const commanderDamage = { ...(p.commanderDamage || {}), [action.attackerPlayerId]: action.damage };
            return { ...p, commanderDamage };
          }
          return p;
        });
      }
    }
    
    return {
      board,
      counters,
      players,
      cemeteryPositions,
      libraryPositions,
    };
  } catch (error) {
    console.warn('[Store] Erro ao carregar eventos do room:', error);
    return null;
  }
};

// Alias para manter compatibilidade
const loadRoomState = loadRoomStateFromEvents;

interface User {
  id: number;
  username: string;
}

interface GameStore {
  playerId: string;
  playerName: string;
  setPlayerName: (name: string) => void;
  status: RoomStatus;
  isHost: boolean;
  roomId: string;
  roomPassword: string;
  error?: string;
  board: CardOnBoard[];
  counters: Counter[];
  players: PlayerSummary[];
  cemeteryPositions: Record<string, Point>;
  libraryPositions: Record<string, Point>;
  zoomedCard: string | null;
  savedDecks: SavedDeck[];
  turnConfig: TurnConfig;
  peer?: Peer;
  connections: Record<string, DataConnection>;
  hostConnection?: DataConnection;
  user: User | null;
  setUser: (user: User | null) => void;
  checkAuth: () => Promise<void>;
  hydrateDecks: () => Promise<void>;
  saveDeckDefinition: (name: string, entries: DeckEntry[], rawText: string, isPublic?: boolean) => Promise<void>;
  deleteDeckDefinition: (deckId: string) => Promise<void>;
  publicDecks: SavedDeck[];
  loadPublicDecks: () => Promise<void>;
  setTurnMode: (mode: TurnConfig['mode']) => void;
  updateTurnCredentials: (credentials: Partial<Omit<TurnConfig, 'mode'>>) => void;
  resetTurnConfig: () => void;
  createRoom: (roomId: string, password: string) => void;
  joinRoom: (roomId: string, password: string) => void;
  leaveRoom: () => void;
  addCardToBoard: (card: NewCardPayload) => void;
  addCardToLibrary: (card: NewCardPayload) => void;
  replaceLibrary: (cards: NewCardPayload[]) => void;
  drawFromLibrary: () => void;
  moveCard: (cardId: string, position: Point) => void;
  moveLibrary: (playerName: string, relativePosition: Point, absolutePosition: Point) => void;
  moveCemetery: (playerName: string, position: Point) => void;
  toggleTap: (cardId: string) => void;
  removeCard: (cardId: string) => void;
  changeCardZone: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery', position: Point, libraryPlace?: 'top' | 'bottom' | 'random') => void;
  reorderHandCard: (cardId: string, newIndex: number) => void;
  reorderLibraryCard: (cardId: string, newIndex: number) => void;
  shuffleLibrary: (playerName: string) => void;
  mulligan: (playerName: string) => void;
  createCounter: (ownerId: string, type: CounterType, position: Point) => void;
  moveCounter: (counterId: string, position: Point) => void;
  modifyCounter: (counterId: string, delta?: number, deltaX?: number, deltaY?: number, setValue?: number, setX?: number, setY?: number) => void;
  removeCounterToken: (counterId: string) => void;
  flipCard: (cardId: string) => void;
  setPlayerLife: (playerId: string, life: number) => void;
  changePlayerLife: (playerId: string, delta: number) => void;
  setCommanderDamage: (targetPlayerId: string, attackerPlayerId: string, damage: number) => void;
  changeCommanderDamage: (targetPlayerId: string, attackerPlayerId: string, delta: number) => void;
  resetBoard: () => void;
  setSimulatedPlayers: (count: number) => void;
  setPeerEventLogger: (logger: ((type: 'SENT' | 'RECEIVED', direction: 'TO_HOST' | 'TO_PEERS' | 'FROM_HOST' | 'FROM_PEER', messageType: string, actionKind?: string, target?: string, details?: Record<string, unknown>) => void) | null) => void;
  setZoomedCard: (cardId: string | null) => void;
}

// Função helper para recalcular posições das cartas na mão
const recalculateHandPositions = (board: CardOnBoard[], playerName: string): CardOnBoard[] => {
  const handCards = board
    .filter((c) => c.zone === 'hand' && c.ownerId === playerName)
    .sort((a, b) => {
      // Ordenar por handIndex se disponível, senão por ID para manter ordem consistente
      if (a.handIndex !== undefined && b.handIndex !== undefined) {
        return a.handIndex - b.handIndex;
      }
      if (a.handIndex !== undefined) return -1;
      if (b.handIndex !== undefined) return 1;
      return a.id.localeCompare(b.id);
    });
  
  if (handCards.length === 0) return board;
  
  // Atualizar handIndex para garantir ordem sequencial
  const updatedCards = handCards.map((card, index) => ({
    ...card,
    handIndex: index,
    position: { x: 0, y: 0 }, // Posições serão calculadas pelo componente
  }));
  
  // Atualizar o board com as cartas reordenadas
  const otherCards = board.filter((c) => !(c.zone === 'hand' && c.ownerId === playerName));
  return [...otherCards, ...updatedCards];
};

const applyCardAction = (board: CardOnBoard[], action: CardAction) => {
  let newBoard: CardOnBoard[];
  
  switch (action.kind) {
    case 'add':
      newBoard = [...board.filter((card) => card.id !== action.card.id), action.card];
      // Se adicionou carta na mão, recalcular posições
      if (action.card.zone === 'hand') {
        newBoard = recalculateHandPositions(newBoard, action.card.ownerId);
      }
      return newBoard;
    case 'move': {
      newBoard = board.map((card) => (card.id === action.id ? { ...card, position: action.position } : card));
      
      // Se moveu uma carta que estava na mão, NÃO recalcular posições durante o drag
      // Apenas atualizar a posição da carta sendo arrastada
      // As posições serão recalculadas quando a carta for solta (reorderHandCard)
      return newBoard;
    }
    case 'moveLibrary': {
      // Atualizar posição do library do player
      // Apenas as top 5 cartas visíveis precisam ter posição trackeada
      // As outras cartas não precisam de posição (são apenas dados)
      const libraryCards = board.filter((c) => c.zone === 'library' && c.ownerId === action.playerName);
      if (libraryCards.length === 0) return board;
      
      // Ordenar por stackIndex para pegar as top 5 cartas (maiores índices)
      const sortedCards = [...libraryCards].sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));
      const top5Cards = sortedCards.slice(0, 5);
      const topCard = top5Cards[0];
      
      if (!topCard) return board;
      
      // Calcular offset baseado na carta do topo
      const currentX = topCard.position.x || 0;
      const currentY = topCard.position.y || 0;
      const offsetX = action.position.x - currentX;
      const offsetY = action.position.y - currentY;
      
      // Criar um Set com os IDs das top 5 cartas para lookup rápido
      const top5CardIds = new Set(top5Cards.map(c => c.id));
      
      return board.map((card) => {
        if (card.zone === 'library' && card.ownerId === action.playerName) {
          // Apenas atualizar posição das top 5 cartas visíveis
          if (top5CardIds.has(card.id)) {
            const cardCurrentX = card.position.x || 0;
            const cardCurrentY = card.position.y || 0;
            return {
              ...card,
              position: {
                x: cardCurrentX + offsetX,
                y: cardCurrentY + offsetY,
              },
            };
          }
          // Cartas não visíveis mantêm posição (0,0) - não precisam ser atualizadas
          return card;
        }
        return card;
      });
    }
    case 'moveCemetery': {
      // Atualizar posição do cemitério do player
      // Apenas as top 5 cartas visíveis precisam ter posição trackeada
      // As outras cartas não precisam de posição (são apenas dados)
      const cemeteryCards = board.filter((c) => c.zone === 'cemetery' && c.ownerId === action.playerName);
      if (cemeteryCards.length === 0) return board;
      
      // Ordenar por stackIndex para pegar as top 5 cartas (maiores índices)
      const sortedCards = [...cemeteryCards].sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));
      const top5Cards = sortedCards.slice(0, 5);
      const topCard = top5Cards[0];
      
      if (!topCard) return board;
      
      // Calcular offset baseado na carta do topo
      // Se a carta do topo não tiver posição (0,0), usar a posição da ação diretamente
      const currentX = topCard.position.x || 0;
      const currentY = topCard.position.y || 0;
      const offsetX = action.position.x - currentX;
      const offsetY = action.position.y - currentY;
      
      // Criar um Set com os IDs das top 5 cartas para lookup rápido
      const top5CardIds = new Set(top5Cards.map(c => c.id));
      
      return board.map((card) => {
        if (card.zone === 'cemetery' && card.ownerId === action.playerName) {
          // Apenas atualizar posição das top 5 cartas visíveis
          if (top5CardIds.has(card.id)) {
            const cardIndex = top5Cards.findIndex((c) => c.id === card.id);
            const cardCurrentX = card.position.x || 0;
            const cardCurrentY = card.position.y || 0;
            // Se a carta não tinha posição (0,0), usar a posição base + offset do stack
            const CEMETERY_CARD_WIDTH = 100;
            const stackOffsetX = cardIndex * 3; // Offset visual do stack
            const stackOffsetY = cardIndex * 3;
            return {
              ...card,
              position: {
                x: (cardCurrentX === 0 && cardCurrentY === 0) 
                  ? action.position.x + stackOffsetX 
                  : cardCurrentX + offsetX,
                y: (cardCurrentX === 0 && cardCurrentY === 0) 
                  ? action.position.y + stackOffsetY 
                  : cardCurrentY + offsetY,
              },
            };
          }
          // Cartas não visíveis mantêm posição (0,0) - não precisam ser atualizadas
          return card;
        }
        return card;
      });
    }
    case 'toggleTap':
      return board.map((card) => (card.id === action.id ? { ...card, tapped: !card.tapped } : card));
    case 'changeZone': {
      const changedCard = board.find((c) => c.id === action.id);
      if (!changedCard) return board;
      
      // Se for library com libraryPlace, calcular stackIndex primeiro e ajustar outras cartas
      let libraryAdjustments: Array<{ id: string; newStackIndex: number }> = [];
      let newStackIndex: number | undefined = undefined;
      
      if (action.zone === 'library' && action.libraryPlace) {
        const libraryCards = board.filter((c) => c.zone === 'library' && c.ownerId === changedCard.ownerId && c.id !== action.id);
        const sortedCards = [...libraryCards].sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));
        
        if (action.libraryPlace === 'top') {
          // Topo = maior índice + 1
          const maxStackIndex = sortedCards.length > 0 
            ? Math.max(...sortedCards.map((c) => c.stackIndex ?? 0))
            : -1;
          newStackIndex = maxStackIndex + 1;
        } else if (action.libraryPlace === 'bottom') {
          // Bottom = menor índice - 1, ou 0 se menor já é 0
          const minStackIndex = sortedCards.length > 0
            ? Math.min(...sortedCards.map((c) => c.stackIndex ?? 0))
            : 0;
          newStackIndex = minStackIndex - 1;
          
          // Se ficou negativo, ajustar todas as outras cartas para cima
          if (newStackIndex < 0) {
            libraryAdjustments = sortedCards.map((c) => ({
              id: c.id,
              newStackIndex: (c.stackIndex ?? 0) + 1,
            }));
            newStackIndex = 0;
          }
        } else if (action.libraryPlace === 'random') {
          // Random = posição aleatória
          const librarySize = sortedCards.length;
          
          if (librarySize === 0) {
            newStackIndex = 0;
          } else {
            // Escolher uma posição aleatória (0 = bottom, librarySize = top)
            const randomPosition = Math.floor(Math.random() * (librarySize + 1));
            
            if (randomPosition === 0) {
              // Colocar no bottom
              const minStackIndex = Math.min(...sortedCards.map((c) => c.stackIndex ?? 0));
              newStackIndex = minStackIndex - 1;
              if (newStackIndex < 0) {
                libraryAdjustments = sortedCards.map((c) => ({
                  id: c.id,
                  newStackIndex: (c.stackIndex ?? 0) + 1,
                }));
                newStackIndex = 0;
              }
            } else if (randomPosition === librarySize) {
              // Colocar no topo
              const maxStackIndex = Math.max(...sortedCards.map((c) => c.stackIndex ?? 0));
              newStackIndex = maxStackIndex + 1;
            } else {
              // Colocar entre duas cartas
              // A carta na posição randomPosition-1 está acima, queremos ficar abaixo dela
              const cardAbove = sortedCards[randomPosition - 1];
              const targetStackIndex = cardAbove.stackIndex ?? 0;
              newStackIndex = targetStackIndex;
              
              // Mover todas as cartas com stackIndex >= targetStackIndex para cima
              libraryAdjustments = sortedCards
                .filter((c) => (c.stackIndex ?? 0) >= targetStackIndex)
                .map((c) => ({
                  id: c.id,
                  newStackIndex: (c.stackIndex ?? 0) + 1,
                }));
            }
          }
        }
      }
      
      let newBoard = board.map((card) => {
        if (card.id === action.id) {
          const updatedCard = {
            ...card,
            zone: action.zone,
            position: action.position,
          };
          
          // Se mudou para battlefield, remover handIndex e stackIndex
          if (action.zone === 'battlefield') {
            const { handIndex, stackIndex, ...rest } = updatedCard as any;
            return rest;
          }
          
          // Se mudou para hand, pode precisar de handIndex
          if (action.zone === 'hand') {
            const handCards = board.filter((c) => c.zone === 'hand' && c.ownerId === card.ownerId && c.id !== card.id);
            const maxHandIndex = handCards.reduce((max, c) => Math.max(max, c.handIndex ?? -1), -1);
            const { stackIndex, ...rest } = updatedCard as any;
            return {
              ...rest,
              handIndex: maxHandIndex + 1,
            };
          }
          
          // Se mudou para cemetery, calcular stackIndex (sempre no topo)
          if (action.zone === 'cemetery') {
            const cemeteryCards = board.filter((c) => c.zone === 'cemetery' && c.ownerId === card.ownerId && c.id !== card.id);
            const maxStackIndex = cemeteryCards.length > 0 
              ? Math.max(...cemeteryCards.map((c) => c.stackIndex ?? 0))
              : -1;
            const stackIndex = maxStackIndex + 1;
            
            const { handIndex, ...rest } = updatedCard as any;
            return {
              ...rest,
              stackIndex,
            };
          }
          
          // Se mudou para library, usar o stackIndex calculado anteriormente
          if (action.zone === 'library') {
            let stackIndex: number;
            
            if (newStackIndex !== undefined) {
              stackIndex = newStackIndex;
            } else if (action.libraryPlace === 'top') {
              // Fallback para top (caso não tenha sido calculado)
              const libraryCards = board.filter((c) => c.zone === 'library' && c.ownerId === card.ownerId && c.id !== card.id);
              const maxStackIndex = libraryCards.length > 0 
                ? Math.max(...libraryCards.map((c) => c.stackIndex ?? 0))
                : -1;
              stackIndex = maxStackIndex + 1;
            } else {
              // Padrão: adicionar no topo
              const libraryCards = board.filter((c) => c.zone === 'library' && c.ownerId === card.ownerId && c.id !== card.id);
              const maxStackIndex = libraryCards.length > 0 
                ? Math.max(...libraryCards.map((c) => c.stackIndex ?? 0))
                : -1;
              stackIndex = maxStackIndex + 1;
            }
            
            const { handIndex, ...rest } = updatedCard as any;
            return {
              ...rest,
              stackIndex,
            };
          }
          
          return updatedCard;
        }
        
        // Aplicar ajustes de stackIndex para outras cartas da library
        if (libraryAdjustments.length > 0) {
          const adjustment = libraryAdjustments.find((adj) => adj.id === card.id);
          if (adjustment) {
            return {
              ...card,
              stackIndex: adjustment.newStackIndex,
            };
          }
        }
        
        return card;
      });
      
      // Se mudou de hand para outra zone, recalcular posições das cartas restantes na mão
      if (changedCard.zone === 'hand' && action.zone !== 'hand') {
        newBoard = recalculateHandPositions(newBoard, changedCard.ownerId);
      }
      
      // Se mudou para hand, recalcular posições
      if (action.zone === 'hand') {
        newBoard = recalculateHandPositions(newBoard, changedCard.ownerId);
      }
      
      return newBoard;
    }
    case 'reorderHand': {
      const card = board.find((c) => c.id === action.cardId);
      if (!card || card.zone !== 'hand' || card.ownerId !== action.playerName) return board;
      
      // Filtrar e ordenar cartas da mão do player
      const handCards = board
        .filter((c) => c.zone === 'hand' && c.ownerId === action.playerName)
        .sort((a, b) => {
          if (a.handIndex !== undefined && b.handIndex !== undefined) {
            return a.handIndex - b.handIndex;
          }
          if (a.handIndex !== undefined) return -1;
          if (b.handIndex !== undefined) return 1;
          return a.id.localeCompare(b.id);
        });
      
      const oldIndex = handCards.findIndex((c) => c.id === action.cardId);
      if (oldIndex === -1) return board;
      
      // Reordenar o array
      const reordered = [...handCards];
      const [movedCard] = reordered.splice(oldIndex, 1);
      reordered.splice(action.newIndex, 0, movedCard);
      
      // Atualizar handIndex de todas as cartas
      const updatedHandCards = reordered.map((c, idx) => ({
        ...c,
        handIndex: idx,
      }));
      
      // Combinar com outras cartas
      const otherCards = board.filter((c) => !(c.zone === 'hand' && c.ownerId === action.playerName));
      return [...otherCards, ...updatedHandCards];
    }
    case 'reorderLibrary': {
      const card = board.find((c) => c.id === action.cardId);
      if (!card || card.zone !== 'library' || card.ownerId !== action.playerName) return board;
      
      // Filtrar e ordenar cartas da library do player (ordem reversa - maior índice = topo)
      const libraryCards = board
        .filter((c) => c.zone === 'library' && c.ownerId === action.playerName)
        .sort((a, b) => {
          if (a.stackIndex !== undefined && b.stackIndex !== undefined) {
            return (b.stackIndex ?? 0) - (a.stackIndex ?? 0);
          }
          if (a.stackIndex !== undefined) return -1;
          if (b.stackIndex !== undefined) return 1;
          return a.id.localeCompare(b.id);
        });
      
      const oldIndex = libraryCards.findIndex((c) => c.id === action.cardId);
      if (oldIndex === -1) return board;
      
      // Reordenar o array
      const reordered = [...libraryCards];
      const [movedCard] = reordered.splice(oldIndex, 1);
      reordered.splice(action.newIndex, 0, movedCard);
      
      // Atualizar stackIndex (ordem reversa - maior índice = topo)
      const updatedLibraryCards = reordered.map((c, idx) => ({
        ...c,
        stackIndex: reordered.length - 1 - idx,
      }));
      
      // Combinar com outras cartas
      const otherCards = board.filter((c) => !(c.zone === 'library' && c.ownerId === action.playerName));
      return [...otherCards, ...updatedLibraryCards];
    }
    case 'remove': {
      const removedCard = board.find((c) => c.id === action.id);
      newBoard = board.filter((card) => card.id !== action.id);
      
      // Se removeu uma carta da mão, recalcular posições das outras cartas na mão
      if (removedCard && removedCard.zone === 'hand') {
        newBoard = recalculateHandPositions(newBoard, removedCard.ownerId);
      }
      return newBoard;
    }
    case 'addToLibrary': {
      const libraryCards = board.filter((c) => c.zone === 'library' && c.ownerId === action.card.ownerId);
      const maxStackIndex = libraryCards.length > 0 
        ? Math.max(...libraryCards.map((c) => c.stackIndex ?? 0))
        : -1;
      return [...board.filter((card) => card.id !== action.card.id), {
        ...action.card,
        zone: 'library' as const,
        stackIndex: maxStackIndex + 1,
      }];
    }
    case 'replaceLibrary': {
      // Remove todas as cartas do library do player e adiciona as novas
      const filtered = board.filter((c) => !(c.zone === 'library' && c.ownerId === action.playerName));
      return [...filtered, ...action.cards];
    }
    case 'drawFromLibrary': {
      const libraryCards = board
        .filter((c) => c.zone === 'library' && c.ownerId === action.playerName)
        .sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0)); // Topo é o maior índice
      
      if (libraryCards.length === 0) return board;
      
      const topCard = libraryCards[0];
      
      // Obter a posição atual do stack (da carta do topo)
      const stackPosition = topCard.position.x !== 0 || topCard.position.y !== 0 
        ? { x: topCard.position.x, y: topCard.position.y }
        : null;
      
      // Mover carta do topo para a mão
      // Obter o maior handIndex atual para adicionar a nova carta no final
      const currentHandCards = board.filter((c) => c.zone === 'hand' && c.ownerId === action.playerName);
      const maxHandIndex = currentHandCards.reduce((max, card) => 
        Math.max(max, card.handIndex ?? -1), -1
      );
      
      newBoard = board.map((card) => {
        if (card.id === topCard.id) {
          return {
            ...card,
            zone: 'hand' as const,
            stackIndex: undefined,
            handIndex: maxHandIndex + 1, // Adicionar no final da mão
            position: { x: 0, y: 0 }, // Posição será calculada pelo componente
          };
        }
        return card;
      });
      
      // Se havia posição do stack, mover as próximas 4 cartas para a posição do stack
      // A próxima carta (que era a segunda) agora é a primeira e deve herdar a posição do stack
      if (stackPosition && libraryCards.length > 1) {
        const newTop5Cards = libraryCards.slice(1, 6); // Próximas 5 cartas (após remover a primeira)
        const newTop5CardIds = new Set(newTop5Cards.map(c => c.id));
        
        newBoard = newBoard.map((card) => {
          if (card.zone === 'library' && card.ownerId === action.playerName && newTop5CardIds.has(card.id)) {
            // A nova carta do topo (que era a segunda) herda a posição do stack
            if (card.id === newTop5Cards[0].id) {
              return {
                ...card,
                position: stackPosition,
              };
            }
            // As outras 4 cartas visíveis mantêm offset relativo (3px cada)
            const cardIndex = newTop5Cards.findIndex(c => c.id === card.id);
            if (cardIndex > 0) {
              return {
                ...card,
                position: {
                  x: stackPosition.x + (cardIndex * 3),
                  y: stackPosition.y + (cardIndex * 3),
                },
              };
            }
          }
          return card;
        });
      }
      
      // Recalcular posições de todas as cartas na mão
      newBoard = recalculateHandPositions(newBoard, action.playerName);
      return newBoard;
    }
    case 'shuffleLibrary': {
      const libraryCards = board
        .filter((c) => c.zone === 'library' && c.ownerId === action.playerName)
        .sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));
      
      if (libraryCards.length === 0) return board;
      
      // Embaralhar os stackIndex
      const shuffled = [...libraryCards].sort(() => Math.random() - 0.5);
      
      // Atualizar stackIndex de cada carta mantendo suas posições
      const updatedLibraryCards = shuffled.map((card, index) => ({
        ...card,
        stackIndex: libraryCards.length - 1 - index, // Inverter para manter ordem (maior índice = topo)
      }));
      
      const otherCards = board.filter((c) => !(c.zone === 'library' && c.ownerId === action.playerName));
      return [...otherCards, ...updatedLibraryCards];
    }
    case 'mulligan': {
      // Pegar todas as cartas da mão do jogador
      const handCards = board.filter((c) => c.zone === 'hand' && c.ownerId === action.playerName);
      
      if (handCards.length === 0) return board;
      
      // Pegar cartas do library para calcular o próximo stackIndex
      const libraryCards = board.filter((c) => c.zone === 'library' && c.ownerId === action.playerName);
      const maxStackIndex = libraryCards.length > 0 
        ? Math.max(...libraryCards.map((c) => c.stackIndex ?? 0))
        : -1;
      
      // Mover todas as cartas da mão para o library (no topo)
      let newBoard = board.map((card) => {
        if (card.zone === 'hand' && card.ownerId === action.playerName) {
          return {
            ...card,
            zone: 'library' as const,
            handIndex: undefined,
            stackIndex: maxStackIndex + handCards.length - handCards.findIndex(c => c.id === card.id),
            position: { x: 0, y: 0 },
          };
        }
        return card;
      });
      
      // Embaralhar o library
      const allLibraryCards = newBoard
        .filter((c) => c.zone === 'library' && c.ownerId === action.playerName)
        .sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));
      
      if (allLibraryCards.length === 0) return newBoard;
      
      // Embaralhar os stackIndex
      const shuffled = [...allLibraryCards].sort(() => Math.random() - 0.5);
      
      // Atualizar stackIndex de cada carta
      const updatedLibraryCards = shuffled.map((card, index) => ({
        ...card,
        stackIndex: allLibraryCards.length - 1 - index, // Inverter para manter ordem (maior índice = topo)
      }));
      
      const otherCards = newBoard.filter((c) => !(c.zone === 'library' && c.ownerId === action.playerName));
      return [...otherCards, ...updatedLibraryCards];
    }
    case 'flipCard': {
      return board.map((card) => {
        if (card.id === action.id) {
          return {
            ...card,
            flipped: !card.flipped,
          };
        }
        return card;
      });
    }
    default:
      return board;
  }
};

const applyCounterAction = (counters: Counter[], action: CardAction): Counter[] => {
  switch (action.kind) {
    case 'createCounter': {
      const newCounter: Counter = {
        id: randomId(),
        ownerId: action.ownerId,
        type: action.type,
        position: action.position,
        value: action.type === 'numeral' ? 0 : undefined,
        plusX: action.type === 'plus' ? 0 : undefined,
        plusY: action.type === 'plus' ? 0 : undefined,
      };
      return [...counters, newCounter];
    }
    case 'moveCounter': {
      return counters.map((counter) =>
        counter.id === action.counterId ? { ...counter, position: action.position } : counter
      );
    }
    case 'modifyCounter': {
      return counters.map((counter) => {
        if (counter.id !== action.counterId) return counter;
        
        if (counter.type === 'numeral') {
          if (action.setValue !== undefined) {
            return { ...counter, value: action.setValue };
          }
          if (action.delta !== undefined) {
            return { ...counter, value: Math.max(0, (counter.value ?? 0) + action.delta) };
          }
        } else if (counter.type === 'plus') {
          let newPlusX = counter.plusX ?? 0;
          let newPlusY = counter.plusY ?? 0;
          
          if (action.setX !== undefined) newPlusX = action.setX;
          else if (action.deltaX !== undefined) newPlusX += action.deltaX;
          
          if (action.setY !== undefined) newPlusY = action.setY;
          else if (action.deltaY !== undefined) newPlusY += action.deltaY;
          
          return { ...counter, plusX: newPlusX, plusY: newPlusY };
        }
        return counter;
      });
    }
    case 'removeCounterToken': {
      return counters.filter((counter) => counter.id !== action.counterId);
    }
    case 'remove': {
      // Contadores são independentes, não são removidos quando cartas são removidas
      return counters;
    }
    default:
      return counters;
  }
};

export const useGameStore = create<GameStore>((set, get) => {
  let peerEventLogger: ((type: 'SENT' | 'RECEIVED', direction: 'TO_HOST' | 'TO_PEERS' | 'FROM_HOST' | 'FROM_PEER', messageType: string, actionKind?: string, target?: string, details?: Record<string, unknown>) => void) | null = null;
  
  // Função para carregar estado persistido do localStorage
  const loadPersistedState = () => {
    if (typeof window === 'undefined') {
      return {
        roomId: '',
        roomPassword: '',
        playerName: '',
        isHost: false,
      };
    }
    
    try {
      const persisted = localStorage.getItem('mtonline-room-state');
      if (persisted) {
        const parsed = JSON.parse(persisted);
        return {
          roomId: parsed.roomId || '',
          roomPassword: parsed.roomPassword || '',
          playerName: parsed.playerName || '',
          isHost: parsed.isHost || false,
        };
      }
    } catch (error) {
      console.warn('[Store] Erro ao carregar estado persistido:', error);
    }
    
    return {
      roomId: '',
      roomPassword: '',
      playerName: '',
      isHost: false,
    };
  };

  // Função para salvar estado no localStorage
  const savePersistedState = (roomId: string, roomPassword: string, playerName: string, isHost: boolean) => {
    if (typeof window === 'undefined') return;
    
    try {
      localStorage.setItem('mtonline-room-state', JSON.stringify({
        roomId,
        roomPassword,
        playerName,
        isHost,
      }));
    } catch (error) {
      console.warn('[Store] Erro ao salvar estado persistido:', error);
    }
  };

  // Função para limpar estado persistido
  const clearPersistedState = () => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem('mtonline-room-state');
    } catch (error) {
      console.warn('[Store] Erro ao limpar estado persistido:', error);
    }
  };

  const persisted = loadPersistedState();

  const baseState = () => ({
    status: 'idle' as RoomStatus,
    isHost: persisted.isHost,
    roomId: persisted.roomId,
    roomPassword: persisted.roomPassword,
    error: undefined,
    board: [] as CardOnBoard[],
    counters: [] as Counter[],
    players: [] as PlayerSummary[],
    simulatedPlayers: [] as PlayerSummary[],
    cemeteryPositions: {} as Record<string, Point>,
    libraryPositions: {} as Record<string, Point>,
    zoomedCard: null as string | null,
    connections: {} as Record<string, DataConnection>,
    hostConnection: undefined as DataConnection | undefined,
    peer: undefined as Peer | undefined,
  });

  const logIceServers = (servers: RTCIceServer[]): void => {
    console.log('[ICE Servers] Configurando servidores TURN/STUN:');
    servers.forEach((server, index) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      urls.forEach((url) => {
        const isStun = url.startsWith('stun:') || url.startsWith('stuns:');
        const hasAuth = server.username && server.credential;
        let authInfo: string;
        if (isStun) {
          authInfo = ' (STUN não requer autenticação)';
        } else if (hasAuth) {
          authInfo = ` (username: ${server.username})`;
        } else {
          authInfo = ' (sem autenticação)';
        }
        console.log(`  [${index + 1}] ${url}${authInfo}`);
      });
    });
  };

  const buildIceServers = (): RTCIceServer[] => {
    const state = get();
    if (!state) {
      const servers = parseIceServersFromEnv();
      logIceServers(servers);
      return servers;
    }
    const config = state.turnConfig;
    if (config.mode === 'custom' && config.url && config.username && config.credential) {
      debugLog('using custom turn server', config.url);
      // Apenas servidores customizados (locais)
      const customServers = buildCoturnServers(config.url, config.username, config.credential);
      logIceServers(customServers);
      return customServers;
    }
    const servers = parseIceServersFromEnv();
    logIceServers(servers);
    return servers;
  };

  const createPeerInstance = async (peerId?: string): Promise<Peer> => {
    const createStartTime = performance.now();
    
    // Aguardar credenciais TURN se ainda não foram inicializadas
    if (!turnCredentialsInitialized && turnCredentialsPromise) {
      console.log('[TURN] Aguardando credenciais antes de criar peer...');
      const waitStart = performance.now();
      await turnCredentialsPromise;
      console.log(`[TURN] Credenciais aguardadas em ${(performance.now() - waitStart).toFixed(2)}ms`);
    }
    
    // Se ainda não há cache e não há promise em andamento, tentar buscar agora
    if (!turnCredentialsCache && !turnCredentialsPromise) {
      console.log('[TURN] Buscando credenciais antes de criar peer...');
      const fetchStart = performance.now();
      await getTurnCredentials();
      console.log(`[TURN] Credenciais buscadas em ${(performance.now() - fetchStart).toFixed(2)}ms`);
    }
    
    const iceServers = buildIceServers();
    const options: PeerJSOption = {
      ...resolvePeerEndpoint(),
      debug: 0,
      config: { iceServers },
    };
    debugLog('creating peer instance', peerId ?? 'anonymous', options);
    
    const peerCreationStart = performance.now();
    const peer = peerId ? new Peer(peerId, options) : new Peer(options);
    const peerCreationTime = performance.now() - peerCreationStart;
    console.log(`[Peer] Instância criada em ${peerCreationTime.toFixed(2)}ms`);
    console.log(`[Peer] Tempo total de criação: ${(performance.now() - createStartTime).toFixed(2)}ms`);
    
    // DEBUG ICE e Performance - Adicionar handlers para logar candidatos ICE e estatísticas
    peer.on('open', () => {
      // Acessar RTCPeerConnection interno do PeerJS
      const pc = (peer as any)._pc as RTCPeerConnection | undefined;
      if (pc) {
        // Log de candidatos ICE
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            console.log('[ICE] Candidate:', event.candidate.candidate, {
              type: event.candidate.type,
              protocol: event.candidate.protocol,
              address: event.candidate.address,
              port: event.candidate.port,
            });
          } else {
            console.log('[ICE] Gathering finished');
          }
        };

        // Log de mudanças de estado ICE
        pc.oniceconnectionstatechange = () => {
          console.log('[ICE] Connection state:', pc.iceConnectionState);
        };

        pc.onicegatheringstatechange = () => {
          console.log('[ICE] Gathering state:', pc.iceGatheringState);
        };

        // Coletar estatísticas de performance periodicamente
        const statsInterval = setInterval(async () => {
          try {
            const stats = await pc.getStats();
            const statsMap = new Map(stats);
            
            // Encontrar estatísticas de transporte (candidate-pair)
            const candidatePairs: any[] = [];
            const localCandidates: any[] = [];
            const remoteCandidates: any[] = [];
            
            statsMap.forEach((report) => {
              if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                candidatePairs.push({
                  id: report.id,
                  localCandidateId: report.localCandidateId,
                  remoteCandidateId: report.remoteCandidateId,
                  state: report.state,
                  priority: report.priority,
                  nominated: report.nominated,
                  bytesReceived: report.bytesReceived,
                  bytesSent: report.bytesSent,
                  packetsReceived: report.packetsReceived,
                  packetsSent: report.packetsSent,
                  lastPacketReceivedTimestamp: report.lastPacketReceivedTimestamp,
                  lastPacketSentTimestamp: report.lastPacketSentTimestamp,
                  totalRoundTripTime: report.totalRoundTripTime,
                  currentRoundTripTime: report.currentRoundTripTime,
                });
              } else if (report.type === 'local-candidate') {
                localCandidates.push({
                  id: report.id,
                  candidateType: report.candidateType,
                  ip: report.ip,
                  port: report.port,
                  protocol: report.protocol,
                  priority: report.priority,
                });
              } else if (report.type === 'remote-candidate') {
                remoteCandidates.push({
                  id: report.id,
                  candidateType: report.candidateType,
                  ip: report.ip,
                  port: report.port,
                  protocol: report.protocol,
                  priority: report.priority,
                });
              }
            });

            if (candidatePairs.length > 0) {
              console.log('[RTC Stats] Active candidate pairs:', candidatePairs);
              console.log('[RTC Stats] Local candidates:', localCandidates);
              console.log('[RTC Stats] Remote candidates:', remoteCandidates);
              
              // Calcular latência média se disponível
              const activePair = candidatePairs[0];
              if (activePair.currentRoundTripTime) {
                console.log(`[RTC Stats] RTT: ${(activePair.currentRoundTripTime * 1000).toFixed(2)}ms`);
              }
            }
          } catch (error) {
            console.warn('[RTC Stats] Erro ao coletar estatísticas:', error);
          }
        }, 5000); // Coletar a cada 5 segundos

        // Limpar intervalo quando o peer for fechado
        peer.on('close', () => {
          clearInterval(statsInterval);
        });

        peer.on('error', () => {
          clearInterval(statsInterval);
        });
      }
    });
    
    return peer;
  };

  const broadcastToPeers = (message: IncomingMessage) => {
    const state = get();
    if (!state || !state.isHost) return;
    const connections = state.connections;
    const peerIds = Object.keys(connections);
    const openConnections = Object.values(connections).filter(conn => conn && conn.open);
    
    openConnections.forEach((conn) => {
      try {
        conn.send(message);
      } catch (error) {
        debugLog('failed to send message', error);
      }
    });
    
    // Log evento
    if (peerEventLogger && openConnections.length > 0) {
      const actionKind = (message as any).action?.kind;
      const details: Record<string, unknown> = {
        messageType: message.type,
        targetCount: openConnections.length,
        peerIds: peerIds,
      };
      
      // Adicionar informações específicas por tipo de mensagem
      if (message.type === 'BOARD_STATE' && Array.isArray((message as any).board)) {
        details.boardSize = (message as any).board.length;
        details.cardsByZone = {
          battlefield: (message as any).board.filter((c: any) => c.zone === 'battlefield').length,
          hand: (message as any).board.filter((c: any) => c.zone === 'hand').length,
          library: (message as any).board.filter((c: any) => c.zone === 'library').length,
          cemetery: (message as any).board.filter((c: any) => c.zone === 'cemetery').length,
        };
      } else if (message.type === 'ROOM_STATE') {
        if (Array.isArray((message as any).board)) {
          details.boardSize = (message as any).board.length;
        }
        if (Array.isArray((message as any).players)) {
          details.playersCount = (message as any).players.length;
          details.playerNames = (message as any).players.map((p: any) => p.name);
        }
      } else if (message.type === 'PLAYER_STATE') {
        if (Array.isArray((message as any).players)) {
          details.playersCount = (message as any).players.length;
          details.playerNames = (message as any).players.map((p: any) => p.name);
        }
        if (Array.isArray((message as any).simulatedPlayers)) {
          details.simulatedCount = (message as any).simulatedPlayers.length;
        }
      }
      
      peerEventLogger('SENT', 'TO_PEERS', message.type, actionKind, `${openConnections.length} peer(s)`, details);
    }
  };


  const handleHostAction = (action: CardAction, skipEventSave = false) => {
    set((state) => {
      if (!state) return state;
      
      // Tratar setPlayerLife separadamente (não afeta o board)
      if (action.kind === 'setPlayerLife') {
        let updated = false;
        const updatedPlayers = state.players.map((p) => {
          if (p.id === action.playerId) {
            updated = true;
            return { ...p, life: action.life };
          }
          return p;
        });
        if (updated) {
          return {
            ...state,
            players: updatedPlayers,
          };
        }
        const updatedSimulatedPlayers = state.simulatedPlayers.map((p) => {
          if (p.id === action.playerId) {
            return { ...p, life: action.life };
          }
          return p;
        });
        return {
          ...state,
          simulatedPlayers: updatedSimulatedPlayers,
        };
      }
      
      // Tratar setCommanderDamage separadamente
      if (action.kind === 'setCommanderDamage') {
        let updated = false;
        const updatedPlayers = state.players.map((p) => {
          if (p.id === action.targetPlayerId) {
            updated = true;
            const commanderDamage = { ...(p.commanderDamage || {}), [action.attackerPlayerId]: action.damage };
            return { ...p, commanderDamage };
          }
          return p;
        });
        if (updated) {
          return {
            ...state,
            players: updatedPlayers,
          };
        }
        const updatedSimulatedPlayers = state.simulatedPlayers.map((p) => {
          if (p.id === action.targetPlayerId) {
            const commanderDamage = { ...(p.commanderDamage || {}), [action.attackerPlayerId]: action.damage };
            return { ...p, commanderDamage };
          }
          return p;
        });
        return {
          ...state,
          simulatedPlayers: updatedSimulatedPlayers,
        };
      }
      
      if (action.kind === 'adjustCommanderDamage') {
        const applyUpdate = (playersList: PlayerSummary[]) => {
          let updated = false;
          const updatedList = playersList.map((p) => {
            if (p.id !== action.targetPlayerId) {
              return p;
            }
            updated = true;
            const currentLife = p.life ?? 40;
            const newLife = Math.max(0, currentLife - action.delta);
            const currentDamage = p.commanderDamage?.[action.attackerPlayerId] ?? 0;
            const newDamage = Math.max(0, currentDamage + action.delta);
            const commanderDamage = {
              ...(p.commanderDamage || {}),
              [action.attackerPlayerId]: newDamage,
            };
            return { ...p, life: newLife, commanderDamage };
          });
          return { updatedList, updated };
        };
        
        const realPlayersUpdate = applyUpdate(state.players);
        if (realPlayersUpdate.updated) {
          return {
            ...state,
            players: realPlayersUpdate.updatedList,
          };
        }
        
        const simulatedUpdate = applyUpdate(state.simulatedPlayers);
        return {
          ...state,
          simulatedPlayers: simulatedUpdate.updatedList,
        };
      }
      
      // Tratar setSimulatedPlayers separadamente
      if (action.kind === 'setSimulatedPlayers') {
        const simulatedPlayers: PlayerSummary[] = Array.from({ length: action.count }, (_, i) => ({
          id: `simulated-${i + 1}`,
          name: `Player ${i + 1}`,
          life: 40,
        }));
        return {
          ...state,
          simulatedPlayers,
        };
      }
      
      // Tratar setZoomedCard separadamente (não afeta o board)
      if (action.kind === 'setZoomedCard') {
        return {
          ...state,
          zoomedCard: action.cardId,
        };
      }
      
      // Atualizar posições se for moveLibrary ou moveCemetery
      let newCemeteryPositions = state.cemeteryPositions;
      let newLibraryPositions = state.libraryPositions;
      
      if (action.kind === 'moveCemetery' && 'playerName' in action && 'position' in action) {
        newCemeteryPositions = {
          ...state.cemeteryPositions,
          [action.playerName]: action.position,
        };
      } else if (action.kind === 'moveLibrary' && 'playerName' in action && 'position' in action) {
        // Para library, a posição vem absoluta, mas precisamos armazenar relativa
        // Por enquanto, vamos armazenar a absoluta e calcular a relativa no Board
        newLibraryPositions = {
          ...state.libraryPositions,
          [action.playerName]: action.position,
        };
      }
      
      // Aplicar ações de contadores
      const newCounters = applyCounterAction(state.counters, action);
      
      return {
        board: applyCardAction(state.board, action),
        counters: newCounters,
        cemeteryPositions: newCemeteryPositions,
        libraryPositions: newLibraryPositions,
      };
    });
    
    // Fazer broadcast para peers após aplicar a ação
    // IMPORTANTE: Sempre fazer broadcast, mesmo durante drag (skipEventSave = true)
    // O skipEventSave só afeta o salvamento no banco, não a sincronização com peers
    const stateAfter = get();
    if (stateAfter) {
      // Fazer broadcast para peers
      if (
        action.kind === 'setPlayerLife' ||
        action.kind === 'setCommanderDamage' ||
        action.kind === 'setSimulatedPlayers' ||
        action.kind === 'adjustCommanderDamage'
      ) {
        broadcastToPeers({ 
          type: 'PLAYER_STATE', 
          players: stateAfter.players,
          simulatedPlayers: stateAfter.simulatedPlayers,
        });
      } else {
        broadcastToPeers({ 
          type: 'BOARD_STATE', 
          board: stateAfter.board,
          counters: stateAfter.counters,
          cemeteryPositions: stateAfter.cemeteryPositions,
          libraryPositions: stateAfter.libraryPositions,
        });
      }
    }
    
    // Salvar evento no backend (event sourcing) - apenas se não for skip
    // Isso é feito DEPOIS do broadcast para não atrasar a sincronização
    if (stateAfter && stateAfter.roomId && !skipEventSave) {
      saveEvent(
        stateAfter.roomId,
        'CARD_ACTION',
        action,
        stateAfter.playerId,
        stateAfter.playerName
      ).catch((err) => {
        console.warn('[Store] Erro ao salvar evento (não crítico):', err);
      });
    }
  };

    const registerHostConn = (conn: DataConnection, playerId: string, playerName: string) => {
    conn.on('data', (raw: unknown) => {
      // Ignorar mensagens que não são objetos ou não têm tipo válido
      if (!raw || typeof raw !== 'object') return;
      
      const message = raw as IncomingMessage;
      // Filtrar apenas mensagens válidas do jogo
      if (message?.type === 'REQUEST_ACTION' && message.action && message.actorId) {
        if (message.actorId !== playerId) {
          debugLog('ignoring action with mismatched actorId', { claimedActor: message.actorId, connectionPlayerId: playerId });
          return;
        }
        if (message.action.kind === 'setCommanderDamage' || message.action.kind === 'adjustCommanderDamage') {
          const { targetPlayerId, attackerPlayerId } = message.action;
          if (playerId !== targetPlayerId && playerId !== attackerPlayerId) {
            debugLog('player attempted to modify commander damage without permission', { actor: playerId, target: targetPlayerId, attacker: attackerPlayerId });
            return;
          }
        }
        debugLog('host received action', message.actorId, message.action.kind, message.skipEventSave ? '(skipEventSave)' : '');
        
        // Log evento
        if (peerEventLogger) {
          const details: Record<string, unknown> = {
            actionKind: message.action.kind,
            actorId: message.actorId,
            playerName,
            skipEventSave: message.skipEventSave || false,
          };
          
          // Adicionar detalhes específicos por tipo de ação
          if ('id' in message.action) {
            details.cardId = (message.action as any).id;
          }
          if ('position' in message.action) {
            details.position = (message.action as any).position;
          }
          if ('zone' in message.action) {
            details.zone = (message.action as any).zone;
          }
          if ('playerId' in message.action) {
            details.targetPlayerId = (message.action as any).playerId;
          }
          if ('cards' in message.action) {
            details.cardsCount = Array.isArray((message.action as any).cards) ? (message.action as any).cards.length : 0;
          }
          if ('card' in message.action) {
            details.cardName = (message.action as any).card?.name;
          }
          
          peerEventLogger('RECEIVED', 'FROM_PEER', 'REQUEST_ACTION', message.action.kind, playerId, details);
        }
        
        handleHostAction(message.action, message.skipEventSave || false);
      } else if (message?.type) {
        // Log outros tipos de mensagens recebidas
        if (peerEventLogger) {
          peerEventLogger('RECEIVED', 'FROM_PEER', message.type, undefined, playerId, {
            messageType: message.type,
            playerName,
          });
        }
      }
    });

    const dropPlayer = () => {
      set((state) => {
        if (!state) return state;
        const { [playerId]: _, ...rest } = state.connections;
        const remainingPlayers = state.players.filter((player) => player.id !== playerId);
        return {
          connections: rest,
          players: remainingPlayers,
        };
      });

      // Se o host desconectou (não há mais conexões mas ainda há players), 
      // os clientes detectarão via disconnected() e se tornarão host automaticamente
      // Aqui apenas removemos o player da lista
    };

    conn.on('close', dropPlayer);
    conn.on('error', dropPlayer);

    // Registrar conexão e player
    // Validar que não há outro player com o mesmo nome ANTES de adicionar
    const currentState = get();
    const existingPlayerWithName = currentState.players.find((player) => player.name === playerName);
    if (existingPlayerWithName) {
      // Rejeitar conexão se já existe um player com esse nome
      conn.send({ type: 'ERROR', message: `Player name "${playerName}" is already taken. Please choose a different name.` });
      conn.close();
      return;
    }
    
    set((state) => {
      if (!state) return state;
      // Garantir que não há outro player com o mesmo ID
      const existingPlayers = state.players.filter((player) => player.id !== playerId);
      
      return {
        connections: { ...state.connections, [playerId]: conn },
        players: [...existingPlayers, { id: playerId, name: playerName, life: 40 }],
      };
    });

    // Enviar estado apenas quando a conexão estiver aberta
    const sendInitialState = () => {
      if (conn.open) {
        const currentState = get();
        conn.send({ 
          type: 'ROOM_STATE', 
          board: currentState.board,
          counters: currentState.counters,
          players: currentState.players,
          simulatedPlayers: currentState.simulatedPlayers,
          cemeteryPositions: currentState.cemeteryPositions,
          libraryPositions: currentState.libraryPositions,
        });
        debugLog('host registered connection', playerId, playerName);
        // Sync contínuo vai cuidar da sincronização
      }
    };

    if (conn.open) {
      sendInitialState();
    } else {
      conn.on('open', sendInitialState);
    }
  };

  const registerClientConn = (conn: DataConnection) => {
    conn.on('data', (raw: unknown) => {
      // Ignorar mensagens que não são objetos ou não têm tipo válido
      if (!raw || typeof raw !== 'object') return;
      
      const message = raw as IncomingMessage;
      if (!message || !message.type) return;
      
      // Filtrar apenas tipos de mensagem válidos do jogo
      const validTypes = ['ROOM_STATE', 'BOARD_STATE', 'PLAYER_STATE', 'ERROR', 'HOST_TRANSFER'];
      if (!validTypes.includes(message.type)) {
        return;
      }
      
      debugLog('client received', message.type);
      
      // Log evento
      if (peerEventLogger) {
        const details: Record<string, unknown> = {
          messageType: message.type,
          hasBoard: Array.isArray((message as any).board),
          hasPlayers: Array.isArray((message as any).players),
        };
        
        // Adicionar informações específicas por tipo de mensagem
        if (message.type === 'BOARD_STATE' && Array.isArray((message as any).board)) {
          details.boardSize = (message as any).board.length;
          details.cardsByZone = {
            battlefield: (message as any).board.filter((c: any) => c.zone === 'battlefield').length,
            hand: (message as any).board.filter((c: any) => c.zone === 'hand').length,
            library: (message as any).board.filter((c: any) => c.zone === 'library').length,
            cemetery: (message as any).board.filter((c: any) => c.zone === 'cemetery').length,
          };
        } else if (message.type === 'ROOM_STATE') {
          if (Array.isArray((message as any).board)) {
            details.boardSize = (message as any).board.length;
          }
          if (Array.isArray((message as any).players)) {
            details.playersCount = (message as any).players.length;
            details.playerNames = (message as any).players.map((p: any) => p.name);
          }
        } else if (message.type === 'PLAYER_STATE') {
          if (Array.isArray((message as any).players)) {
            details.playersCount = (message as any).players.length;
          }
          if (Array.isArray((message as any).simulatedPlayers)) {
            details.simulatedCount = (message as any).simulatedPlayers.length;
          }
        }
        
        peerEventLogger('RECEIVED', 'FROM_HOST', message.type, undefined, conn.peer, details);
      }
      
      switch (message.type) {
        case 'ROOM_STATE':
          if (Array.isArray(message.board) && Array.isArray(message.players)) {
            const currentState = get();
            // Verificar se o playerId do store está no array de players recebido
            // Se não estiver, significa que o playerId mudou (pode acontecer em reconexões)
            // Nesse caso, tentar encontrar o player correspondente pelo nome ou manter o playerId atual
            const currentPlayerId = currentState?.playerId;
            const playerExists = message.players.some(p => p.id === currentPlayerId);
            
            // Se o playerId atual não está no array, usar o primeiro player se for o host
            let newPlayerId = currentPlayerId;
            if (!playerExists && currentState?.isHost && message.players.length > 0) {
              // Se for host e não encontrar pelo ID, usar o primeiro player (geralmente o host)
              newPlayerId = message.players[0].id;
            }
            
            // Validar que não há nomes duplicados
            const nameCounts = new Map<string, number>();
            message.players.forEach(p => {
              nameCounts.set(p.name, (nameCounts.get(p.name) || 0) + 1);
            });
            const duplicateNames = Array.from(nameCounts.entries())
              .filter(([_, count]) => count > 1)
              .map(([name]) => name);
            
            if (duplicateNames.length > 0) {
              console.warn('[ROOM_STATE] Nomes duplicados detectados:', duplicateNames);
            }
            
            // Remover duplicatas por ID (manter apenas o primeiro de cada ID)
            const uniquePlayers = message.players.reduce((acc, player) => {
              if (!acc.find(p => p.id === player.id)) {
                acc.push(player);
              }
              return acc;
            }, [] as typeof message.players);
            
            const newState = {
              board: message.board,
              counters: message.counters || [],
              players: uniquePlayers,
              simulatedPlayers: message.simulatedPlayers || [],
              status: 'connected' as RoomStatus,
              error: undefined,
              // Atualizar playerId se necessário
              ...(newPlayerId !== currentPlayerId ? { playerId: newPlayerId } : {}),
            };
            set(newState);
            // Salvar estado quando conectar
            const stateAfter = get();
            if (stateAfter) {
              savePersistedState(stateAfter.roomId, stateAfter.roomPassword, stateAfter.playerName || '', stateAfter.isHost);
            }
            // Sync contínuo vai cuidar da sincronização
          }
          break;
        case 'PLAYER_STATE':
          if (Array.isArray(message.players)) {
            set((state) => {
              if (!state) return state;
              return {
                players: message.players,
                simulatedPlayers: message.simulatedPlayers || state.simulatedPlayers,
              };
            });
          }
          break;
        case 'BOARD_STATE':
          if (Array.isArray(message.board)) {
            const currentState = get();
            // Preservar posições locais se não vierem no BOARD_STATE ou se estivermos arrastando
            set({ 
              board: message.board,
              counters: message.counters || currentState?.counters || [],
              cemeteryPositions: message.cemeteryPositions || currentState?.cemeteryPositions || {},
              libraryPositions: message.libraryPositions || currentState?.libraryPositions || {},
            });
            // Sync contínuo vai cuidar da sincronização
          }
          break;
        case 'HOST_TRANSFER':
          if (message.newHostId === get().playerId && Array.isArray(message.board) && Array.isArray(message.players)) {
            // Este jogador foi escolhido como novo host
            debugLog('becoming new host');
            const state = get();
            destroyPeer();
            
            // Criar novo peer como host
            createPeerInstance(state.roomId).then((peer) => {
              const newState = {
              ...baseState(),
              peer,
              isHost: true,
              status: 'initializing' as RoomStatus,
              roomId: state.roomId,
              roomPassword: state.roomPassword,
              board: message.board,
              counters: message.counters || [],
              // Garantir que todos os players usam ID como nome
              players: message.players,
              playerId: state.playerId,
              playerName: state.playerName,
            };
            set(newState);

            peer.on('open', () => {
              set((s) => {
                if (!s) return s;
                const updatedState = {
                  status: 'connected' as RoomStatus,
                  players: s.players,
                };
                // Salvar estado quando conectar
                savePersistedState(s.roomId, s.roomPassword, s.playerName || '', s.isHost);
                return updatedState;
              });
            });

            peer.on('connection', (conn) => {
              const metadata = conn.metadata as { password?: string; name?: string; playerId?: string } | undefined;
              debugLog('incoming connection', metadata);
              if (!metadata || metadata.password !== get().roomPassword) {
                conn.send({ type: 'ERROR', message: 'Incorrect password' });
                conn.close();
                return;
              }
              const remoteId = metadata.playerId || randomId();
              const remoteName = metadata.name || 'Guest';
              registerHostConn(conn, remoteId, remoteName);
            });

              peer.on('error', (error) => {
                debugLog('peer host error', error);
                set({ status: 'error', error: error.message });
              });
            }).catch((error) => {
              console.error('[TURN] Erro ao criar peer:', error);
              set({ status: 'error', error: error.message });
            });
          } else if (Array.isArray(message.board) && Array.isArray(message.players)) {
            // Outro jogador se tornou host, atualizar estado e reconectar
            debugLog('new host assigned, reconnecting');
            const state = get();
            destroyPeer();
            
            // Reconectar ao novo host
            createPeerInstance().then((peer) => {
              set({
                ...baseState(),
                peer,
                status: 'initializing' as RoomStatus,
                roomId: state.roomId,
                roomPassword: state.roomPassword,
                board: message.board,
                players: message.players,
                isHost: false,
                playerId: state.playerId,
                playerName: state.playerName,
              });

              peer.on('open', () => {
                const connection = peer.connect(state.roomId, {
                  metadata: {
                    password: state.roomPassword,
                    name: state.playerName || 'Player',
                    playerId: state.playerId,
                  },
                });
                debugLog('client dialing new host', state.roomId);

                registerClientConn(connection);

                connection.on('open', () => {
                  debugLog('client connected to new host');
                  set({ status: 'waiting', hostConnection: connection });
                });
              });

              peer.on('error', (error) => {
                debugLog('peer client error', error);
                set({ status: 'error', error: error.message });
              });
            }).catch((error) => {
              console.error('[TURN] Erro ao criar peer:', error);
              set({ status: 'error', error: error.message });
            });
          }
          break;
        case 'ERROR':
          if (typeof message.message === 'string') {
            set({ status: 'error', error: message.message });
          }
          break;
        default:
          break;
      }
    });

    const disconnected = () => {
      const state = get();
      
      // Se não há mais players na sala, apenas marcar como erro
      if (state.players.length <= 1) {
        set((s) => {
          if (!s) return s;
          return {
            ...s,
            status: s.status === 'idle' ? s.status : 'error',
            error: s.error ?? 'Lost connection to host',
            hostConnection: undefined,
          };
        });
        return;
      }
      
      // Se o host desconectou e ainda há outros players, o primeiro player restante deve se tornar host
      // O host é sempre o primeiro player na lista, então removemos ele
      const hostPlayer = state.players[0];
      const remainingPlayers = state.players.filter((p) => p.id !== hostPlayer?.id);
      
      // Se este player não é o host que desconectou e ainda há players restantes
      if (hostPlayer && hostPlayer.id !== state.playerId && remainingPlayers.length > 0) {
        // Atualizar lista de players removendo o host
        set((s) => ({
          ...s,
          players: remainingPlayers,
        }));
        
        const stateAfter = get();
        // Se este player é o primeiro na lista agora, tornar-se host
        const firstPlayer = stateAfter.players[0];
        if (firstPlayer && firstPlayer.id === stateAfter.playerId && !stateAfter.isHost) {
          debugLog('host disconnected, becoming new host');
          
          // Destruir peer atual e criar um novo como host
          // O novo host usa o roomId como peerId, permitindo que outros players se conectem
          destroyPeer();
          
          // Aguardar um pouco para garantir que o peer antigo foi destruído
          // O PeerJS pode levar um tempo para liberar o ID
          const attemptCreateHostPeer = (retryCount = 0) => {
            const maxRetries = 3;
            const delay = retryCount * 1000; // 0s, 1s, 2s
            
            setTimeout(() => {
              // Criar novo peer como host usando o roomId como peerId
              // Isso permite que outros players se conectem usando o roomId
              createPeerInstance(stateAfter.roomId).then((peer) => {
                const newState = {
                  ...baseState(),
                  peer,
                  isHost: true,
                  status: 'initializing' as RoomStatus,
                  roomId: stateAfter.roomId,
                  roomPassword: stateAfter.roomPassword,
                  board: stateAfter.board,
                  counters: stateAfter.counters,
                  players: stateAfter.players,
                  cemeteryPositions: stateAfter.cemeteryPositions,
                  libraryPositions: stateAfter.libraryPositions,
                  playerId: stateAfter.playerId,
                  playerName: stateAfter.playerName,
                };
                set(newState);

                peer.on('open', () => {
                  set((s) => {
                    if (!s) return s;
                    const updatedState = {
                      status: 'connected' as RoomStatus,
                      players: s.players,
                    };
                    return updatedState;
                  });
                  
                  // Notificar outros players que este é o novo host
                  // Eles devem tentar se conectar ao roomId (que é o peerId deste host)
                  debugLog('new host peer opened, other players should connect to', stateAfter.roomId);
                });

                peer.on('connection', (conn) => {
                  const metadata = conn.metadata as { password?: string; name?: string; playerId?: string } | undefined;
                  debugLog('incoming connection from player', metadata);
                  if (!metadata || metadata.password !== get().roomPassword) {
                    conn.send({ type: 'ERROR', message: 'Incorrect password' });
                    conn.close();
                    return;
                  }
                  const remoteId = metadata.playerId || randomId();
                  registerHostConn(conn, remoteId, metadata.name || 'Guest');
                });

                peer.on('error', (error: any) => {
                  debugLog('peer host error', error);
                  const errorMsg = error?.message || error?.toString() || '';
                  const errorType = error?.type || '';
                  
                  // Se o erro for "ID taken", tentar novamente
                  if (errorType === 'peer-unavailable' || 
                      errorMsg.toLowerCase().includes('taken') || 
                      errorMsg.toLowerCase().includes('unavailable') ||
                      errorMsg.toLowerCase().includes('is taken')) {
                    if (retryCount < maxRetries) {
                      console.log(`[Store] Peer ID "${stateAfter.roomId}" is taken, retrying in ${(retryCount + 1) * 1000}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                      destroyPeer();
                      attemptCreateHostPeer(retryCount + 1);
                      return;
                    } else {
                      console.error(`[Store] Failed to create peer after ${maxRetries} retries. ID "${stateAfter.roomId}" is still taken.`);
                    }
                  }
                  set({ status: 'error', error: errorMsg || 'Failed to create host peer' });
                });
              }).catch((error: any) => {
                console.error('[TURN] Erro ao criar peer:', error);
                const errorMsg = error?.message || error?.toString() || '';
                const errorType = error?.type || '';
                
                // Se o erro for "ID taken", tentar novamente
                if (errorType === 'peer-unavailable' || 
                    errorMsg.toLowerCase().includes('taken') || 
                    errorMsg.toLowerCase().includes('unavailable') ||
                    errorMsg.toLowerCase().includes('is taken')) {
                  if (retryCount < maxRetries) {
                    console.log(`[Store] Peer ID "${stateAfter.roomId}" is taken, retrying in ${(retryCount + 1) * 1000}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                    destroyPeer();
                    attemptCreateHostPeer(retryCount + 1);
                    return;
                  } else {
                    console.error(`[Store] Failed to create peer after ${maxRetries} retries. ID "${stateAfter.roomId}" is still taken.`);
                  }
                }
                set({ status: 'error', error: errorMsg || 'Failed to create host peer' });
              });
            }, delay);
          };
          
          attemptCreateHostPeer();
          return;
        } else {
          // Este player não é o novo host, tentar se reconectar ao novo host
          // O novo host terá o roomId como peerId, então podemos nos conectar usando o roomId
          debugLog('host disconnected, attempting to reconnect to new host via roomId');
          
          // Pequeno delay para dar tempo do novo host criar seu peer
          setTimeout(() => {
            const currentState = get();
            if (!currentState.isHost && currentState.roomId) {
              // Tentar se conectar ao roomId (que é o peerId do novo host)
              const currentPeer = currentState.peer;
              if (currentPeer) {
                // Reutilizar o peer atual para conectar ao novo host
                try {
                  const connection = currentPeer.connect(currentState.roomId, {
                    metadata: {
                      password: currentState.roomPassword,
                      name: currentState.playerName || 'Player',
                      playerId: currentState.playerId,
                    },
                  });
                  
                  debugLog('reconnecting to new host', currentState.roomId);
                  
                  registerClientConn(connection);
                  
                  connection.on('open', () => {
                    debugLog('reconnected to new host');
                    set({ status: 'waiting', hostConnection: connection });
                  });
                  
                  connection.on('error', (error) => {
                    debugLog('failed to reconnect to new host', error);
                    // Tentar novamente após um delay
                    setTimeout(() => {
                      const state = get();
                      if (!state.isHost && state.roomId) {
                        try {
                          const retryConnection = state.peer?.connect(state.roomId, {
                            metadata: {
                              password: state.roomPassword,
                              name: state.playerName || 'Player',
                              playerId: state.playerId,
                            },
                          });
                          if (retryConnection) {
                            registerClientConn(retryConnection);
                            retryConnection.on('open', () => {
                              set({ status: 'waiting', hostConnection: retryConnection });
                            });
                          }
                        } catch (err) {
                          debugLog('retry connection failed', err);
                        }
                      }
                    }, 1000);
                  });
                } catch (error) {
                  debugLog('failed to create connection to new host', error);
                }
              }
            }
          }, 500);
        }
      }
      
      // Se não conseguiu se tornar host, marcar como erro
      set((s) => {
        if (!s) return s;
        return {
          ...s,
          status: s.status === 'idle' ? s.status : 'error',
          error: s.error ?? 'Lost connection to host',
          hostConnection: undefined,
        };
      });
    };

    conn.on('close', disconnected);
    conn.on('error', (error) => {
      debugLog('client connection error', error);
      disconnected();
    });
  };

  const destroyPeer = () => {
    debugLog('destroying peer and connections');
    const state = get();
    if (!state) return;
    state.hostConnection?.close();
    Object.values(state.connections).forEach((conn) => conn.close());
    state.peer?.destroy();
  };

  const requestAction = (action: CardAction, skipEventSave = false) => {
    const state = get();
    if (!state) return;
    if (state.isHost) {
      handleHostAction(action, skipEventSave);
      return;
    }

    if (state.hostConnection && state.hostConnection.open) {
      try {
        debugLog('request action via host', action.kind, skipEventSave ? '(skipEventSave)' : '');
        state.hostConnection.send({
          type: 'REQUEST_ACTION',
          action,
          actorId: state.playerId,
          skipEventSave,
        });
        
        // Log evento
        if (peerEventLogger) {
          const details: Record<string, unknown> = {
            actionKind: action.kind,
            actorId: state.playerId,
          };
          
          // Adicionar detalhes específicos por tipo de ação
          if ('id' in action) {
            details.cardId = (action as any).id;
          }
          if ('position' in action) {
            details.position = (action as any).position;
          }
          if ('zone' in action) {
            details.zone = (action as any).zone;
          }
          if ('playerId' in action) {
            details.targetPlayerId = (action as any).playerId;
          }
          if ('cards' in action) {
            details.cardsCount = Array.isArray((action as any).cards) ? (action as any).cards.length : 0;
          }
          if ('card' in action) {
            details.cardName = (action as any).card?.name;
          }
          
          peerEventLogger('SENT', 'TO_HOST', 'REQUEST_ACTION', action.kind, state.hostConnection.peer, details);
        }
        return;
      } catch (error) {
        debugLog('failed to send action', error);
        set({ error: 'Failed to send action. Connection may be lost.' });
        return;
      }
    }

    set({ error: 'You must join a room before interacting with the board.' });
  };
  
  const pendingMoveActions = new Map<string, Point>();
  let moveFlushHandle: number | null = null;
  const flushPendingMoves = () => {
    moveFlushHandle = null;
    if (pendingMoveActions.size === 0) return;
    const entries = Array.from(pendingMoveActions.entries());
    pendingMoveActions.clear();
    entries.forEach(([cardId, position]) => {
      requestAction({ kind: 'move', id: cardId, position });
    });
  };
  const scheduleMoveFlush = () => {
    if (moveFlushHandle !== null) return;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      moveFlushHandle = window.requestAnimationFrame(() => {
        flushPendingMoves();
      });
    } else {
      moveFlushHandle = setTimeout(() => {
        flushPendingMoves();
      }, 16) as unknown as number;
    }
  };
  const queueMoveAction = (cardId: string, position: Point) => {
    pendingMoveActions.set(cardId, position);
    scheduleMoveFlush();
  };

  // Estado inicial - não carregar mais de session
  const initialState = {
    playerId: randomId(),
    playerName: persisted.playerName,
    setPlayerName: (playerName: string) => {
      set({ playerName });
      const state = get();
      if (state) {
        savePersistedState(state.roomId, state.roomPassword, playerName, state.isHost);
      }
    },
    ...baseState(),
    savedDecks: loadLocalDecks(),
    turnConfig: loadTurnConfig(),
    user: null,
    publicDecks: [],
    setUser: (user: User | null) => {
      set({ user });
      if (user) {
        get().hydrateDecks();
      } else {
        // Carregar decks locais quando não logado
        set({ savedDecks: loadLocalDecks() });
      }
    },
    checkAuth: async () => {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      try {
        const response = await fetch(`${API_URL}/me`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          set({ user: data.user });
          get().hydrateDecks();
        } else {
          // Não autenticado é um estado normal, não um erro
          set({ user: null, savedDecks: loadLocalDecks() });
        }
      } catch (error) {
        // Silenciar erros de rede durante verificação de auth (servidor pode não estar rodando)
        if (error instanceof TypeError && error.message.includes('fetch')) {
          // Servidor não disponível, usar modo offline
          set({ user: null, savedDecks: loadLocalDecks() });
        } else {
          console.error('Auth check failed:', error);
          set({ user: null, savedDecks: loadLocalDecks() });
        }
      }
    },
    hydrateDecks: async () => {
      const state = get();
      if (!state.user) {
        // Usar localStorage quando não logado
        set({ savedDecks: loadLocalDecks() });
        return;
      }

      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      try {
        const response = await fetch(`${API_URL}/decks`, {
          credentials: 'include',
        });
        if (response.ok) {
          const decks = await response.json();
          set({ savedDecks: decks });
        } else if (response.status === 401) {
          // Não autenticado, voltar para modo local
          set({ user: null, savedDecks: loadLocalDecks() });
        }
      } catch (error) {
        // Silenciar erros de rede (servidor pode não estar disponível)
        if (error instanceof TypeError && error.message.includes('fetch')) {
          // Servidor não disponível, usar modo offline
          set({ savedDecks: loadLocalDecks() });
        } else {
          console.error('Failed to load decks:', error);
        }
      }
    },
    saveDeckDefinition: async (name: string, entries: DeckEntry[], rawText: string, isPublic = false) => {
      const state = get();
      if (!state.user) {
        // Salvar localmente quando não logado
        const newDecks = saveLocalDeck(name, entries, rawText, state.savedDecks);
        set({ savedDecks: newDecks });
        return;
      }

      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      try {
        const response = await fetch(`${API_URL}/decks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ name, entries, rawText, isPublic }),
        });

        if (!response.ok) {
          throw new Error('Failed to save deck');
        }

        const newDeck = await response.json();
        set((s) => ({
          savedDecks: [newDeck, ...s.savedDecks],
        }));
      } catch (error) {
        console.error('Failed to save deck:', error);
        throw error;
      }
    },
    deleteDeckDefinition: async (deckId: string) => {
      const state = get();
      if (!state.user) {
        // Deletar localmente quando não logado
        const newDecks = deleteLocalDeck(deckId, state.savedDecks);
        set({ savedDecks: newDecks });
        return;
      }

      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      try {
        const response = await fetch(`${API_URL}/decks/${deckId}`, {
          method: 'DELETE',
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Failed to delete deck');
        }

        set((s) => ({
          savedDecks: s.savedDecks.filter((deck) => deck.id !== deckId),
        }));
      } catch (error) {
        console.error('Failed to delete deck:', error);
        throw error;
      }
    },
    loadPublicDecks: async () => {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      try {
        const response = await fetch(`${API_URL}/decks/public`);
        if (response.ok) {
          const decks = await response.json();
          set({ publicDecks: decks });
        }
      } catch (error) {
        console.error('Failed to load public decks:', error);
      }
    },
    setTurnMode: (mode: TurnConfig['mode']) => {
      set((state) => {
        const next = { ...state.turnConfig, mode };
        persistTurnConfig(next);
        return { turnConfig: next };
      });
    },
    updateTurnCredentials: (credentials: Partial<Omit<TurnConfig, 'mode'>>) => {
      set((state) => {
        const next = { ...state.turnConfig, ...credentials };
        persistTurnConfig(next);
        return { turnConfig: next };
      });
    },
    resetTurnConfig: () => {
      const config = defaultTurnConfig();
      persistTurnConfig(config);
      set({ turnConfig: config });
    },
    createRoom: async (roomId: string, password: string) => {
      destroyPeer();
      const trimmedId = roomId?.trim() || `room-${randomId()}`;
      
      // Carregar estado do banco de dados
      const savedState = await loadRoomState(trimmedId);
      
      createPeerInstance(trimmedId).then((peer) => {
        debugLog('creating room', trimmedId);

      const currentState = get();
      const newState = {
        ...baseState(),
        peer,
        isHost: true,
        status: 'initializing' as RoomStatus,
        roomId: trimmedId,
        roomPassword: password,
        playerId: currentState.playerId,
        playerName: currentState.playerName || '',
        players: savedState?.players || [],
        board: savedState?.board || [],
        counters: savedState?.counters || [],
        cemeteryPositions: savedState?.cemeteryPositions || {},
        libraryPositions: savedState?.libraryPositions || {},
      };
      set(newState);
      savePersistedState(trimmedId, password, currentState.playerName || '', true);

      peer.on('open', () => {
        set((state) => {
          if (!state) return state;
          const newState = {
            status: 'connected' as RoomStatus,
            players: state.players.length > 0 
              ? state.players 
              : [{ id: state.playerId, name: state.playerName || state.playerId, life: 40 }],
          };
          // Salvar estado quando conectar
          savePersistedState(state.roomId, state.roomPassword, state.playerName || '', state.isHost);
          return newState;
        });
      });

      peer.on('connection', (conn) => {
        const metadata = conn.metadata as { password?: string; name?: string; playerId?: string } | undefined;
        debugLog('incoming connection', metadata);
        if (!metadata || metadata.password !== get().roomPassword) {
          conn.send({ type: 'ERROR', message: 'Incorrect password' });
          conn.close();
          return;
        }
        const remoteId = metadata.playerId || randomId();
        registerHostConn(conn, remoteId, metadata.name || 'Guest');
      });

        peer.on('error', (error) => {
          debugLog('peer host error', error);
          set({ status: 'error', error: error.message });
        });
      }).catch((error) => {
        console.error('[TURN] Erro ao criar peer:', error);
        set({ status: 'error', error: error.message });
      });
    },
    joinRoom: async (roomId: string, password: string) => {
      destroyPeer();
      
      // Carregar estado do banco de dados
      const savedState = await loadRoomState(roomId);
      
      createPeerInstance().then((peer) => {
        debugLog('joining room', roomId);

        const currentState = get();
        const newState = {
          ...baseState(),
          peer,
          status: 'initializing' as RoomStatus,
          roomId,
          roomPassword: password,
          isHost: false,
          playerId: currentState.playerId,
          playerName: currentState.playerName || '',
          board: savedState?.board || [],
          counters: savedState?.counters || [],
          cemeteryPositions: savedState?.cemeteryPositions || {},
          libraryPositions: savedState?.libraryPositions || {},
        };
        set(newState);
        savePersistedState(roomId, password, currentState.playerName || '', false);

        peer.on('open', () => {
          const connection = peer.connect(roomId, {
            metadata: {
              password,
              name: get().playerName || 'Player',
              playerId: get().playerId,
            },
          });
          debugLog('client dialing host', roomId);

          // Registrar handlers antes de definir hostConnection
          registerClientConn(connection);

          connection.on('open', () => {
            debugLog('client connected to host');
            const currentState = get();
            set({ status: 'waiting', hostConnection: connection });
            // Salvar estado quando conectar
            if (currentState) {
              savePersistedState(currentState.roomId, currentState.roomPassword, currentState.playerName || '', false);
            }
          });
        });

        peer.on('error', (error) => {
          debugLog('peer client error', error);
          set({ status: 'error', error: error.message });
        });
      }).catch((error) => {
        console.error('[TURN] Erro ao criar peer:', error);
        set({ status: 'error', error: error.message });
      });
    },
    leaveRoom: () => {
      const state = get();
      
      // Se for host e houver outros jogadores, transferir host antes de sair
      if (state.isHost && state.players.length > 1) {
        // Encontrar o primeiro jogador que não é o host atual
        const newHost = state.players.find((p) => p.id !== state.playerId);
        if (newHost) {
          debugLog('transferring host to', newHost.id);
          // Enviar mensagem de transferência para todos os clientes
          Object.values(state.connections).forEach((conn) => {
            if (conn && conn.open) {
              try {
                conn.send({
                  type: 'HOST_TRANSFER',
                  newHostId: newHost.id,
                  board: state.board,
                  counters: state.counters,
                  players: state.players.filter((p) => p.id !== state.playerId),
                });
              } catch (error) {
                debugLog('failed to send host transfer', error);
              }
            }
          });
          // Pequeno delay para garantir que as mensagens foram enviadas
          setTimeout(() => {
            destroyPeer();
            set((s) => {
              if (!s) return s;
              const newState = {
                ...baseState(),
                playerId: s.playerId,
                playerName: s.playerName,
                savedDecks: s.savedDecks,
              };
              // Limpar estado persistido ao sair da sala
              clearPersistedState();
              // Sync contínuo já foi parado acima
              return newState;
            });
          }, 100);
          return;
        }
      }
      
      // Se for cliente e o host desconectar, verificar se deve se tornar host
      if (!state.isHost && state.hostConnection) {
        // A desconexão será detectada pelo registerClientConn
        // Se o primeiro jogador na lista for este jogador, ele se tornará host
        const firstPlayer = state.players[0];
        if (firstPlayer && firstPlayer.id === state.playerId && state.players.length > 1) {
          debugLog('host disconnected, becoming new host');
          destroyPeer();
          
          // Criar novo peer como host
          createPeerInstance(state.roomId).then((peer) => {
            const newState = {
              ...baseState(),
              peer,
              isHost: true,
              status: 'initializing' as RoomStatus,
              roomId: state.roomId,
              roomPassword: state.roomPassword,
              board: state.board,
              players: state.players,
              playerId: state.playerId,
              playerName: state.playerName,
            };
            set(newState);

            peer.on('open', () => {
              set((s) => {
                if (!s) return s;
                const updatedState = {
                  status: 'connected' as RoomStatus,
                  players: s.players,
                };
                // Salvar estado quando conectar
                savePersistedState(s.roomId, s.roomPassword, s.playerName || '', s.isHost);
                return updatedState;
              });
            });

            peer.on('connection', (conn) => {
              const metadata = conn.metadata as { password?: string; name?: string; playerId?: string } | undefined;
              debugLog('incoming connection', metadata);
              if (!metadata || metadata.password !== get().roomPassword) {
                conn.send({ type: 'ERROR', message: 'Incorrect password' });
                conn.close();
                return;
              }
              const remoteId = metadata.playerId || randomId();
              const remoteName = metadata.name || 'Guest';
              registerHostConn(conn, remoteId, remoteName);
            });

            peer.on('error', (error) => {
              debugLog('peer host error', error);
              set({ status: 'error', error: error.message });
            });
          }).catch((error) => {
            console.error('[TURN] Erro ao criar peer:', error);
            set({ status: 'error', error: error.message });
          });
          return;
        }
      }
      
      destroyPeer();
      set((s) => {
        if (!s) return s;
        const newState = {
          ...baseState(),
          playerId: s.playerId,
          playerName: s.playerName,
          savedDecks: s.savedDecks,
        };
        // Limpar estado persistido ao sair da sala
        clearPersistedState();
        // Limpar sessão ao sair da sala
        if (typeof window !== 'undefined') {
          // Sync contínuo já foi parado acima
        }
        return newState;
      });
    },
    addCardToBoard: (payload: NewCardPayload) => {
      if (!payload.name) return;
      
      // Se não há posição especificada, usar uma posição especial que indica "centro da área"
      // O Board component ajustará para o centro real quando a carta for adicionada
      const position = payload.position ?? { x: -1, y: -1 }; // -1 indica "usar centro"
      
      const card: CardOnBoard = {
        id: randomId(),
        name: payload.name,
        oracleText: payload.oracleText,
        manaCost: payload.manaCost,
        typeLine: payload.typeLine,
        setName: payload.setName,
        imageUrl: payload.imageUrl,
        backImageUrl: payload.backImageUrl,
        ownerId: get().playerName,
        tapped: false,
        position,
        zone: 'battlefield',
      };
      requestAction({ kind: 'add', card });
    },
    addCardToLibrary: (payload: NewCardPayload) => {
      if (!payload.name) return;
      const card: CardOnBoard = {
        id: randomId(),
        name: payload.name,
        oracleText: payload.oracleText,
        manaCost: payload.manaCost,
        typeLine: payload.typeLine,
        setName: payload.setName,
        imageUrl: payload.imageUrl,
        backImageUrl: payload.backImageUrl,
        ownerId: get().playerName,
        tapped: false,
        position: { x: 0, y: 0 },
        zone: 'library',
      };
      requestAction({ kind: 'addToLibrary', card });
    },
    replaceLibrary: (cards: NewCardPayload[]) => {
      const playerName = get().playerName;
      // Apenas as top 5 cartas precisam ter posição inicial (0,0)
      // As outras não precisam de posição trackeada
      const libraryCards: CardOnBoard[] = cards.map((payload, index) => ({
        id: randomId(),
        name: payload.name,
        oracleText: payload.oracleText,
        manaCost: payload.manaCost,
        typeLine: payload.typeLine,
        setName: payload.setName,
        imageUrl: payload.imageUrl,
        backImageUrl: payload.backImageUrl,
        ownerId: playerName, // Usar playerName para consistência com addCardToLibrary e renderização
        tapped: false,
        // Apenas as top 5 cartas (últimas no array, maiores índices) têm posição inicial
        // As outras têm position (0,0) mas não serão renderizadas
        position: index >= cards.length - 5 ? { x: 0, y: 0 } : { x: 0, y: 0 },
        zone: 'library' as const,
        stackIndex: index,
      }));
      requestAction({ kind: 'replaceLibrary', cards: libraryCards, playerName: playerName });
    },
    drawFromLibrary: () => {
      requestAction({ kind: 'drawFromLibrary', playerName: get().playerName });
    },
    moveCard: (cardId: string, position: Point) => {
      queueMoveAction(cardId, position);
    },
    moveLibrary: (playerName: string, relativePosition: Point, absolutePosition: Point) => {
      const state = get();
      if (!state) return;
      
      // Armazenar posição relativa no store (para sincronização)
      set((s) => {
        if (!s) return s;
        return {
          ...s,
          libraryPositions: {
            ...s.libraryPositions,
            [playerName]: relativePosition,
          },
        };
      });
      
      // Passar posição absoluta para a ação (para atualizar as cartas)
      requestAction({ kind: 'moveLibrary', playerName, position: absolutePosition });
    },
    moveCemetery: (playerName: string, position: Point, skipEventSave = false) => {
      const state = get();
      if (!state) return;
      
      // Se for host, aplicar ação diretamente (sem requestAction)
      // O handleHostAction já atualiza o estado e faz broadcast para os peers
      if (state.isHost) {
        handleHostAction({ kind: 'moveCemetery', playerName, position }, skipEventSave);
      } else {
        // Se for cliente, atualizar localmente primeiro para feedback imediato
        set((s) => {
          if (!s) return s;
          return {
            ...s,
            cemeteryPositions: {
              ...s.cemeteryPositions,
              [playerName]: position,
            },
          };
        });
        
        // Sempre enviar para o host, mesmo durante drag
        // O host fará broadcast para os outros players, mas não salvará no banco se skipEventSave = true
        requestAction({ kind: 'moveCemetery', playerName, position }, skipEventSave);
      }
    },
    toggleTap: (cardId: string) => {
      requestAction({ kind: 'toggleTap', id: cardId });
    },
    removeCard: (cardId: string) => {
      requestAction({ kind: 'remove', id: cardId });
    },
    changeCardZone: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery', position: Point, libraryPlace?: 'top' | 'bottom' | 'random') => {
      requestAction({ kind: 'changeZone', id: cardId, zone, position, libraryPlace });
    },
    reorderHandCard: (cardId: string, newIndex: number) => {
      const state = get();
      if (!state) return;
      
      const card = state.board.find((c) => c.id === cardId);
      if (!card || card.zone !== 'hand' || card.ownerId !== state.playerName) return;
      
      // Usar requestAction para salvar e sincronizar
      requestAction({ kind: 'reorderHand', cardId, newIndex, playerName: state.playerName });
    },
    reorderLibraryCard: (cardId: string, newIndex: number) => {
      const state = get();
      if (!state) return;
      
      const card = state.board.find((c) => c.id === cardId);
      if (!card || card.zone !== 'library' || card.ownerId !== state.playerName) return;
      
      // Usar requestAction para salvar e sincronizar
      requestAction({ kind: 'reorderLibrary', cardId, newIndex, playerName: state.playerName });
    },
    shuffleLibrary: (playerName: string) => {
      requestAction({ kind: 'shuffleLibrary', playerName });
    },
    mulligan: (playerName: string) => {
      requestAction({ kind: 'mulligan', playerName });
    },
    createCounter: (ownerId: string, type: CounterType, position: Point) => {
      requestAction({ kind: 'createCounter', ownerId, type, position });
    },
    moveCounter: (counterId: string, position: Point) => {
      requestAction({ kind: 'moveCounter', counterId, position });
    },
    modifyCounter: (counterId: string, delta?: number, deltaX?: number, deltaY?: number, setValue?: number, setX?: number, setY?: number) => {
      requestAction({ kind: 'modifyCounter', counterId, delta, deltaX, deltaY, setValue, setX, setY });
    },
    removeCounterToken: (counterId: string) => {
      requestAction({ kind: 'removeCounterToken', counterId });
    },
    flipCard: (cardId: string) => {
      requestAction({ kind: 'flipCard', id: cardId });
    },
    setPlayerLife: (playerId: string, life: number) => {
      requestAction({ kind: 'setPlayerLife', playerId, life });
    },
    changePlayerLife: (playerId: string, delta: number) => {
      const state = get();
      if (!state) return;
      
      const player =
        state.players.find((p) => p.id === playerId) ||
        state.simulatedPlayers.find((p) => p.id === playerId);
      const currentLife = player?.life ?? 40;
      const newLife = Math.max(0, currentLife + delta);
      
      get().setPlayerLife(playerId, newLife);
    },
    setCommanderDamage: (targetPlayerId: string, attackerPlayerId: string, damage: number) => {
      requestAction({ kind: 'setCommanderDamage', targetPlayerId, attackerPlayerId, damage });
    },
    changeCommanderDamage: (targetPlayerId: string, attackerPlayerId: string, delta: number) => {
      const state = get();
      if (!state) return;
      const currentPlayerId = state.playerId;
      const isHost = state.isHost;
      if (!isHost && currentPlayerId !== targetPlayerId && currentPlayerId !== attackerPlayerId) {
        debugLog('ignoring changeCommanderDamage for unauthorized players', { actor: currentPlayerId, target: targetPlayerId, attacker: attackerPlayerId });
        return;
      }
      
      requestAction({ kind: 'adjustCommanderDamage', targetPlayerId, attackerPlayerId, delta });
    },
    resetBoard: () => {
      const state = get();
      if (!state || !state.playerName) return;
      
      // Remover apenas as cartas do jogador atual
      const myCards = state.board.filter((card) => card.ownerId === state.playerName);
      
      if (myCards.length === 0) return; // Nenhuma carta para remover
      
      // Se for host, remover as cartas diretamente usando requestAction para cada uma
      // Isso garante que os eventos sejam salvos no servidor
      myCards.forEach((card) => {
        requestAction({ kind: 'remove', id: card.id });
      });
    },
    setSimulatedPlayers: (count: number) => {
      requestAction({ kind: 'setSimulatedPlayers', count });
    },
    setPeerEventLogger: (logger: ((type: 'SENT' | 'RECEIVED', direction: 'TO_HOST' | 'TO_PEERS' | 'FROM_HOST' | 'FROM_PEER', messageType: string, actionKind?: string, target?: string, details?: Record<string, unknown>) => void) | null) => {
      peerEventLogger = logger;
    },
    setZoomedCard: (cardId: string | null) => {
      requestAction({ kind: 'setZoomedCard', cardId }, true); // skipEventSave = true pois é apenas UI state
    },
  };
  
  return initialState;
});

// Subscribe para salvar sessão automaticamente quando o estado mudar
// Usar setTimeout para garantir que o store está totalmente inicializado
// Usar debounce para evitar loops infinitos
if (typeof window !== 'undefined') {
}
