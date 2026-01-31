import { create } from 'zustand';
import { randomId } from '../lib/id';
import type { DeckEntry, SavedDeck } from '../lib/deck';
import { loadDecks as loadLocalDecks, saveDeck as saveLocalDeck, deleteDeck as deleteLocalDeck } from '../lib/deck';
import { debugLog } from '../lib/debug';

type WsEnvelope<T = unknown> = {
  type: string;
  payload?: T;
};

class PseudoConnection {
  public open = true;
  public peer: string;
  public metadata?: Record<string, unknown>;
  private listeners = new Map<string, Array<(...args: any[]) => void>>();
  private sendFn: (message: unknown) => void;

  constructor(peer: string, sendFn: (message: unknown) => void, metadata?: Record<string, unknown>) {
    this.peer = peer;
    this.sendFn = sendFn;
    this.metadata = metadata;
  }

  on(event: string, handler: (...args: any[]) => void) {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
    return this;
  }

  emit(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach((handler) => handler(...args));
  }

  send(message: unknown) {
    if (!this.open) return;
    this.sendFn(message);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }
}

const resolveWsUrl = (): string => {
  const env = import.meta.env;
  if (env.VITE_API_URL) {
    return env.VITE_API_URL.replace(/^http/i, 'ws');
  }
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port, origin } = window.location;
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    const resolvedHost = hostname === 'localhost' || hostname === '::1' ? '127.0.0.1' : hostname;
    if (port === '5173' || port === '4173') {
      return `${wsProtocol}//${resolvedHost}:3000`;
    }
    if (hostname !== resolvedHost) {
      return `${wsProtocol}//${resolvedHost}${port ? `:${port}` : ''}`;
    }
    return origin.replace(/^http/i, 'ws');
  }
  return 'ws://localhost:3000';
};

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
  zone: 'battlefield' | 'library' | 'hand' | 'cemetery' | 'exile';
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
  backImageUrl?: string;
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
  | { kind: 'moveExile'; playerName: string; position: Point }
  | { kind: 'toggleTap'; id: string }
  | { kind: 'remove'; id: string }
  | { kind: 'addToLibrary'; card: CardOnBoard }
  | { kind: 'replaceLibrary'; cards: CardOnBoard[]; playerName: string }
  | { kind: 'drawFromLibrary'; playerName: string }
  | { kind: 'changeZone'; id: string; zone: 'battlefield' | 'library' | 'hand' | 'cemetery' | 'exile'; position: Point; libraryPlace?: 'top' | 'bottom' | 'random' }
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
  | { type: 'BOARD_STATE'; board: CardOnBoard[]; counters?: Counter[]; cemeteryPositions?: Record<string, Point>; libraryPositions?: Record<string, Point>; exilePositions?: Record<string, Point> }
  | { type: 'ROOM_STATE'; board: CardOnBoard[]; counters?: Counter[]; players: PlayerSummary[]; simulatedPlayers?: PlayerSummary[]; cemeteryPositions?: Record<string, Point>; libraryPositions?: Record<string, Point>; exilePositions?: Record<string, Point> }
  | { type: 'PLAYER_STATE'; players: PlayerSummary[]; simulatedPlayers?: PlayerSummary[]; zoomedCard?: string | null }
  | { type: 'HOST_TRANSFER'; newHostId: string; board: CardOnBoard[]; counters?: Counter[]; players: PlayerSummary[]; cemeteryPositions?: Record<string, Point>; libraryPositions?: Record<string, Point>; exilePositions?: Record<string, Point> }
  | { type: 'BOARD_PATCH'; cards: Array<{ id: string; position: Point }> }
  | { type: 'LIBRARY_POSITION'; playerName: string; position: Point }
  | { type: 'ERROR'; message: string };

type RoomStatus = 'idle' | 'initializing' | 'waiting' | 'connected' | 'error';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Funções para event sourcing - salvar e carregar eventos

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
  simulatedPlayers: PlayerSummary[];
  cemeteryPositions: Record<string, Point>;
  libraryPositions: Record<string, Point>;
  exilePositions: Record<string, Point>;
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
    let cemeteryPositions: Record<string, Point> = {};
    let libraryPositions: Record<string, Point> = {};
    let exilePositions: Record<string, Point> = {};
    
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
      
      // Atualizar posições de library, cemetery e exile
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
      } else if (action.kind === 'moveExile' && 'playerName' in action && 'position' in action) {
        exilePositions = {
          ...exilePositions,
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
      simulatedPlayers: [],
      cemeteryPositions,
      libraryPositions,
      exilePositions,
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
  simulatedPlayers: PlayerSummary[];
  cemeteryPositions: Record<string, Point>;
  libraryPositions: Record<string, Point>;
  exilePositions: Record<string, Point>;
  zoomedCard: string | null;
  savedDecks: SavedDeck[];
  socket?: WebSocket;
  connections: Record<string, PseudoConnection>;
  hostConnection?: PseudoConnection;
  user: User | null;
  setUser: (user: User | null) => void;
  checkAuth: () => Promise<void>;
  hydrateDecks: () => Promise<void>;
  saveDeckDefinition: (name: string, entries: DeckEntry[], rawText: string, isPublic?: boolean) => Promise<void>;
  deleteDeckDefinition: (deckId: string) => Promise<void>;
  publicDecks: SavedDeck[];
  loadPublicDecks: () => Promise<void>;
  createRoom: (roomId: string, password: string) => void;
  joinRoom: (roomId: string, password: string) => void;
  leaveRoom: () => void;
  addCardToBoard: (card: NewCardPayload) => void;
  addCardToLibrary: (card: NewCardPayload) => void;
  replaceLibrary: (cards: NewCardPayload[]) => void;
  drawFromLibrary: () => void;
  moveCard: (cardId: string, position: Point, options?: { persist?: boolean }) => void;
  moveLibrary: (playerName: string, relativePosition: Point, absolutePosition: Point, skipEventSave?: boolean) => void;
  moveCemetery: (playerName: string, position: Point, skipEventSave?: boolean) => void;
  moveExile: (playerName: string, position: Point, skipEventSave?: boolean) => void;
  toggleTap: (cardId: string) => void;
  removeCard: (cardId: string) => void;
  changeCardZone: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery' | 'exile', position: Point, libraryPlace?: 'top' | 'bottom' | 'random') => void;
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
      // IMPORTANTE: Apenas as top 5 cartas visíveis precisam ter posição trackeada
      // As outras cartas não precisam de posição (são apenas dados)
      // Isso economiza mensagens peer e processamento
      const libraryCards = board.filter((c) => c.zone === 'library' && c.ownerId === action.playerName);
      if (libraryCards.length === 0) return board;
      
      // Ordenar por stackIndex para pegar as top 5 cartas (maiores índices = topo)
      const sortedCards = [...libraryCards].sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));
      const top5Cards = sortedCards.slice(0, 5);
      const topCard = top5Cards[0];
      
      if (!topCard) return board;
      
      // Calcular offset baseado na carta do topo
      // Se a carta do topo não tiver posição (0,0), usar a posição da ação diretamente
      const currentX = topCard.position.x || 0;
      const currentY = topCard.position.y || 0;
      const offsetX = action.position.x - currentX;
      const offsetY = action.position.y - currentY;
      
      // Se não há offset, não precisa atualizar nada
      if (offsetX === 0 && offsetY === 0) return board;
      
      // Criar um Set com os IDs das top 5 cartas para lookup rápido
      const top5CardIds = new Set(top5Cards.map(c => c.id));
      
      return board.map((card) => {
        if (card.zone === 'library' && card.ownerId === action.playerName) {
          // Apenas atualizar posição das top 5 cartas visíveis
          if (top5CardIds.has(card.id)) {
            const cardIndex = top5Cards.findIndex((c) => c.id === card.id);
            const cardCurrentX = card.position.x || 0;
            const cardCurrentY = card.position.y || 0;
            // Calcular offset visual do stack (3px por carta)
            const stackOffsetX = cardIndex * 3;
            const stackOffsetY = cardIndex * 3;
            
            // Se a carta não tinha posição (0,0), usar a posição base + offset do stack
            if (cardCurrentX === 0 && cardCurrentY === 0) {
              return {
                ...card,
                position: {
                  x: action.position.x + stackOffsetX,
                  y: action.position.y + stackOffsetY,
                },
              };
            }
            
            // Se já tinha posição, aplicar offset
            return {
              ...card,
              position: {
                x: cardCurrentX + offsetX,
                y: cardCurrentY + offsetY,
              },
            };
          }
          // Cartas não visíveis (abaixo das top 5) mantêm posição (0,0) - não precisam ser atualizadas
          // Isso economiza mensagens peer e processamento
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
          
          // Se mudou para exile, calcular stackIndex (sempre no topo)
          if (action.zone === 'exile') {
            const exileCards = board.filter((c) => c.zone === 'exile' && c.ownerId === card.ownerId && c.id !== card.id);
            const maxStackIndex = exileCards.length > 0 
              ? Math.max(...exileCards.map((c) => c.stackIndex ?? 0))
              : -1;
            const stackIndex = maxStackIndex + 1;
            
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
    exilePositions: {} as Record<string, Point>,
    zoomedCard: null as string | null,
    socket: undefined as WebSocket | undefined,
    connections: {} as Record<string, PseudoConnection>,
    hostConnection: undefined as PseudoConnection | undefined,
  });

  const createSocket = () => {
    const url = new URL('/ws', resolveWsUrl()).toString();
    debugLog('connecting ws', url);
    return new WebSocket(url);
  };

  const sendWs = (socket: WebSocket | undefined, message: WsEnvelope) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  };
  
  const boardBroadcastQueue: Array<{ message: IncomingMessage; excludePlayerId?: string }> = [];
  let boardBroadcastHandle: number | null = null;
  const enqueueBoardBroadcast = (message: IncomingMessage, excludePlayerId?: string) => {
    boardBroadcastQueue.length = 0;
    boardBroadcastQueue.push({ message, excludePlayerId });
    if (boardBroadcastHandle === null) {
      boardBroadcastHandle = window.setTimeout(() => {
        boardBroadcastHandle = null;
        const queued = boardBroadcastQueue.shift();
        if (queued) {
          broadcastToPeersImmediate(queued.message, queued.excludePlayerId);
        }
      }, 0);
    }
  };

  // Throttle para mensagens peer - reduzido para 50ms para movimento mais responsivo
  const MESSAGE_THROTTLE_MS = 0;
  const messageThrottleQueue: IncomingMessage[] = [];
  let messageThrottleHandle: number | null = null;
  let lastMessageTime = 0;
  
  const flushMessageQueue = () => {
    if (messageThrottleQueue.length === 0) return;
    const state = get();
    if (!state || !state.isHost) {
      messageThrottleQueue.length = 0;
      return;
    }
    
    const connections = state.connections;
    const peerIds = Object.keys(connections);
    const openConnections = Object.values(connections).filter(conn => conn && conn.open);
    if (openConnections.length === 0) {
      messageThrottleQueue.length = 0;
      return;
    }
    
    // Enviar todas as mensagens na fila (ou apenas a última, dependendo do tipo)
    // Para BOARD_PATCH, enviar apenas a última (mais recente) e combinar cards
    // Para outras mensagens, enviar todas
    const messagesToSend: IncomingMessage[] = [];
    const boardPatchMessages = messageThrottleQueue.filter(m => m.type === 'BOARD_PATCH');
    const otherMessages = messageThrottleQueue.filter(m => m.type !== 'BOARD_PATCH');
    
    // Se há BOARD_PATCH, pegar apenas a última e combinar cards
    if (boardPatchMessages.length > 0) {
      const allCards: Array<{ id: string; position: Point }> = [];
      const cardMap = new Map<string, { id: string; position: Point }>();
      boardPatchMessages.forEach((msg: any) => {
        if (Array.isArray(msg.cards)) {
          msg.cards.forEach((card: { id: string; position: Point }) => {
            cardMap.set(card.id, card); // Última posição vence
          });
        }
      });
      allCards.push(...Array.from(cardMap.values()));
      if (allCards.length > 0) {
        messagesToSend.push({ type: 'BOARD_PATCH', cards: allCards });
      }
    }
    
    // Adicionar outras mensagens (manter todas)
    messagesToSend.push(...otherMessages);
    
    // Limpar fila
    messageThrottleQueue.length = 0;
    
    // Enviar mensagens
    messagesToSend.forEach((message) => {
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
          if ('zoomedCard' in (message as any)) {
            details.zoomedCard = (message as any).zoomedCard || null;
          }
        } else if (message.type === 'BOARD_PATCH') {
          if (Array.isArray((message as any).cards)) {
            details.cardsCount = (message as any).cards.length;
          }
        }
        
        peerEventLogger('SENT', 'TO_PEERS', message.type, actionKind, `${openConnections.length} peer(s)`, details);
      }
    });
    
    lastMessageTime = Date.now();
  };

  const sendToPeersDirect = (message: IncomingMessage, excludePlayerId?: string) => {
    const state = get();
    if (!state || !state.isHost) return;
    
    const connections = state.connections;
    Object.entries(connections).forEach(([playerId, conn]) => {
      if (excludePlayerId && playerId === excludePlayerId) return;
      if (conn && conn.open) {
        try {
        conn.send(message);
        } catch (error) {
          debugLog('failed to send message', error);
        }
      }
    });
  };

  const broadcastToPeersImmediate = (message: IncomingMessage, excludePlayerId?: string) => {
    if (excludePlayerId) {
      sendToPeersDirect(message, excludePlayerId);
      return;
    }
    const state = get();
    if (!state || !state.isHost) return;
    
    const now = Date.now();
    const timeSinceLastMessage = now - lastMessageTime;
    
    // Adicionar mensagem à fila
    messageThrottleQueue.push(message);
    
    // Se já passou o throttle time, enviar imediatamente
    if (timeSinceLastMessage >= MESSAGE_THROTTLE_MS) {
      flushMessageQueue();
    } else {
      // Agendar envio após o throttle time
      if (messageThrottleHandle === null) {
        const delay = MESSAGE_THROTTLE_MS - timeSinceLastMessage;
        messageThrottleHandle = window.setTimeout(() => {
          flushMessageQueue();
          messageThrottleHandle = null;
        }, delay);
      }
    }
  };
  const broadcastBoardPatch = (cards: Array<{ id: string; position: Point }>) => {
    if (cards.length === 0) return;
    broadcastToPeersImmediate({ type: 'BOARD_PATCH', cards });
  };
  const broadcastToPeers = (message: IncomingMessage, excludePlayerId?: string) => {
    if (message.type === 'BOARD_STATE') {
      enqueueBoardBroadcast(message, excludePlayerId);
    } else {
      broadcastToPeersImmediate(message, excludePlayerId);
    }
  };


  const handleHostAction = (action: CardAction, skipEventSave = false, excludePlayerId?: string) => {
    // Se for uma ação de move e a carta está sendo arrastada localmente (já foi aplicada),
    // não aplicar novamente - apenas fazer broadcast
    if (action.kind === 'move' && pendingMoveActions.has(action.id)) {
      // A ação já foi aplicada localmente via queueMoveAction, apenas fazer broadcast
      const stateAfter = get();
      if (stateAfter) {
        broadcastBoardPatch([{ id: action.id, position: action.position }]);
      }
      // Não salvar evento se skipEventSave (durante drag)
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
      return;
    }
    
    set((state) => {
      if (!state) return state;
      if (action.kind === 'moveLibrary' && skipEventSave) {
        return {
          ...state,
          libraryPositions: {
            ...state.libraryPositions,
            [action.playerName]: action.position,
          },
        };
      }
      
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
      if (action.kind === 'move') {
        broadcastBoardPatch([{ id: action.id, position: action.position }]);
      } else if (
        action.kind === 'setPlayerLife' ||
        action.kind === 'setCommanderDamage' ||
        action.kind === 'setSimulatedPlayers' ||
        action.kind === 'adjustCommanderDamage' ||
        action.kind === 'setZoomedCard'
      ) {
        broadcastToPeers({ 
          type: 'PLAYER_STATE', 
          players: stateAfter.players,
          simulatedPlayers: stateAfter.simulatedPlayers,
          zoomedCard: stateAfter.zoomedCard ?? null,
        });
      } else if (action.kind === 'moveLibrary' && skipEventSave) {
        broadcastToPeersImmediate(
          { type: 'LIBRARY_POSITION', playerName: action.playerName, position: action.position },
          excludePlayerId
        );
      } else {
        const shouldExclude =
          excludePlayerId &&
          skipEventSave &&
          (action.kind === 'moveLibrary' || action.kind === 'moveCemetery' || action.kind === 'moveExile');
        broadcastToPeers({ 
          type: 'BOARD_STATE', 
          board: stateAfter.board,
          counters: stateAfter.counters,
          cemeteryPositions: stateAfter.cemeteryPositions,
          libraryPositions: stateAfter.libraryPositions,
        }, shouldExclude ? excludePlayerId : undefined);
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

  const registerHostConn = (conn: PseudoConnection, playerId: string, playerName: string) => {
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
        
        handleHostAction(message.action, message.skipEventSave || false, playerId);
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

  const registerClientConn = (conn: PseudoConnection) => {
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
        case 'PLAYER_STATE': {
          const { players, simulatedPlayers, zoomedCard } = message;
          const current = get();
          if (!current) break;

          const updatedPlayers = Array.isArray(players) ? players : current.players;
          const updatedSimulated = Array.isArray(simulatedPlayers) ? simulatedPlayers : current.simulatedPlayers;
          const updatedZoomed = zoomedCard === undefined ? current.zoomedCard ?? null : zoomedCard ?? null;

          // Se nada mudou, não atualiza
          if (
            updatedPlayers === current.players &&
            updatedSimulated === current.simulatedPlayers &&
            updatedZoomed === (current.zoomedCard ?? null)
          ) {
            break;
          }

          set({
            ...current,
            players: updatedPlayers,
            simulatedPlayers: updatedSimulated,
            zoomedCard: updatedZoomed,
          });
          break;
        }
        case 'BOARD_STATE':
          if (Array.isArray(message.board)) {
            const currentState = get();
            set({ 
              board: message.board,
              counters: message.counters || currentState?.counters || [],
              cemeteryPositions: message.cemeteryPositions || currentState?.cemeteryPositions || {},
              libraryPositions: message.libraryPositions || currentState?.libraryPositions || {},
            });
            // Sync contínuo vai cuidar da sincronização
          }
          break;
        case 'BOARD_PATCH':
          if (Array.isArray(message.cards) && message.cards.length > 0) {
            // Usar o mesmo sistema de animação que o sender
            // Colapsa múltiplas atualizações e processa via requestAnimationFrame
            queueBoardPatch(message.cards);
          }
          break;
        case 'LIBRARY_POSITION': {
          const currentState = get();
          if (!currentState) break;
          set({
            libraryPositions: {
              ...currentState.libraryPositions,
              [message.playerName]: message.position,
            },
          });
          break;
        }
        case 'HOST_TRANSFER':
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
  };

  const destroyPeer = () => {
    debugLog('destroying socket and connections');
    const state = get();
    if (!state) return;
    state.hostConnection?.close();
    Object.values(state.connections).forEach((conn) => conn.close());
    state.socket?.close();
  };

  const handleWsMessage = (socket: WebSocket, raw: MessageEvent) => {
    let message: WsEnvelope | null = null;
    try {
      message = JSON.parse(raw.data as string);
    } catch (error) {
      debugLog('failed to parse ws message', error);
      return;
    }
    if (!message || typeof message.type !== 'string') return;

    const state = get();
    if (!state) return;

    switch (message.type) {
      case 'room:created': {
        const players = state.players.length
          ? state.players
          : [
              {
                id: state.playerId,
                name: state.playerName || 'Host',
                life: 20,
                commanderDamage: {},
              },
            ];
        set({ status: 'connected', players });
        break;
      }
      case 'room:joined':
        set({ status: 'waiting' });
        break;
      case 'room:error': {
        const errorMessage = (message.payload as any)?.message || 'Room error';
        set({ status: 'error', error: errorMessage });
        break;
      }
      case 'room:closed':
        set({ status: 'error', error: 'Room closed by host' });
        break;
      case 'room:client_joined': {
        if (!state.isHost) break;
        const payload = message.payload as any;
        if (!payload?.playerId || !payload?.socketId) break;
        const conn = new PseudoConnection(
          payload.socketId,
          (msg) =>
            sendWs(socket, {
              type: 'room:host_message',
              payload: { roomId: state.roomId, targetSocketId: payload.socketId, message: msg },
            }),
          { socketId: payload.socketId },
        );
        registerHostConn(conn, payload.playerId, payload.playerName || 'Guest');
        break;
      }
      case 'room:client_left': {
        if (!state.isHost) break;
        const payload = message.payload as any;
        const connection = payload?.playerId ? state.connections[payload.playerId] : undefined;
        connection?.close();
        break;
      }
      case 'room:client_message': {
        if (!state.isHost) break;
        const payload = message.payload as any;
        if (!payload?.playerId) break;
        const connection = state.connections[payload.playerId];
        const forwarded = payload?.message ?? payload;
        connection?.emit('data', forwarded);
        break;
      }
      case 'room:host_message': {
        if (state.isHost) break;
        const payload = message.payload as any;
        const forwarded = payload?.message ?? payload;
        state.hostConnection?.emit('data', forwarded);
        break;
      }
      default:
        break;
    }
  };

  const attachSocketHandlers = (socket: WebSocket) => {
    socket.onmessage = (event) => handleWsMessage(socket, event);
    socket.onerror = () => {
      set({ status: 'error', error: 'WebSocket error' });
    };
    socket.onclose = () => {
      const current = get();
      if (!current || current.status === 'idle') return;
      set({ status: 'error', error: 'WebSocket closed' });
    };
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
      }
    }
    
    // Se não há host nem conexão, processar localmente (útil para testes e modo offline)
    // Apenas para ações que não requerem sincronização com peers
    // Verificar se não há host E (não há conexão OU conexão não está aberta)
    const hasNoHost = !state.isHost;
    const hasNoConnection = !state.hostConnection || !state.hostConnection.open;
    
    if (hasNoHost && hasNoConnection) {
      // Processar localmente apenas ações de player life e commander damage
      // Outras ações requerem sincronização e não devem ser processadas sem host
      if (action.kind === 'setPlayerLife' || action.kind === 'setCommanderDamage' || action.kind === 'adjustCommanderDamage') {
        handleHostAction(action, skipEventSave);
        return;
      }
    }

    set({ error: 'You must join a room before interacting with the board.' });
  };

  // Sistema unificado de animação baseado em requestAnimationFrame
  // Funciona tanto para sender (quem arrasta) quanto para receiver (quem recebe BOARD_PATCH)
  type PendingMove = { position: Point; lastPersist: number; lastSent: number };
  type PendingPatch = { id: string; position: Point };
  
  const pendingMoveActions = new Map<string, PendingMove>();
  const pendingBoardPatches = new Map<string, PendingPatch>(); // Para receiver
  let animationFrameHandle: number | null = null;
  const ANIMATION_FPS = 30;
  const ANIMATION_INTERVAL = 1000 / ANIMATION_FPS; // ~33ms
  let lastAnimationTime = 0;
  
  // Função unificada que processa tanto moves pendentes (sender) quanto patches pendentes (receiver)
  const processAnimationFrame = (timestamp: number) => {
    animationFrameHandle = null;
    
    // Throttle: processar no máximo 30fps
    const timeSinceLastAnimation = timestamp - lastAnimationTime;
    if (timeSinceLastAnimation < ANIMATION_INTERVAL) {
      // Agendar para o próximo frame
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        animationFrameHandle = window.requestAnimationFrame(processAnimationFrame);
      } else {
        animationFrameHandle = setTimeout(() => {
          processAnimationFrame(Date.now());
        }, ANIMATION_INTERVAL - timeSinceLastAnimation) as unknown as number;
      }
      return;
    }
    
    lastAnimationTime = timestamp;
    
    // Limpar patches pendentes (receiver) - já foram aplicados visualmente em queueBoardPatch
    // Isso serve apenas para limpar o cache e garantir que não processamos patches antigos
    if (pendingBoardPatches.size > 0) {
      pendingBoardPatches.clear();
    }
    
    // Processar moves pendentes (sender) - enviar para peers
    if (pendingMoveActions.size > 0) {
      pendingMoveActions.forEach((entry, cardId) => {
        // Atualizar lastSent para evitar envios duplicados
        entry.lastSent = timestamp;
        requestAction({ kind: 'move', id: cardId, position: entry.position }, true);
      });
    }
    
    // Se ainda há trabalho pendente, agendar próximo frame
    if (pendingMoveActions.size > 0 || pendingBoardPatches.size > 0) {
      scheduleAnimationFrame();
    }
  };
  
  const scheduleAnimationFrame = () => {
    if (animationFrameHandle !== null) return;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      animationFrameHandle = window.requestAnimationFrame(processAnimationFrame);
    } else {
      animationFrameHandle = setTimeout(() => {
        processAnimationFrame(Date.now());
      }, 16) as unknown as number;
    }
  };
  const applyLocalMove = (cardId: string, position: Point) => {
    set((state) => {
      if (!state) return state;
  return {
        ...state,
        board: state.board.map((card) =>
          card.id === cardId ? { ...card, position } : card
        ),
      };
    });
  };

  // Função para receiver: enfileirar patches recebidos para processamento via requestAnimationFrame
  const queueBoardPatch = (cards: Array<{ id: string; position: Point }>) => {
    const state = get();
    if (!state) return;
    
    // Capturar o estado atual de pendingMoveActions de forma síncrona
    // Isso garante que não há race conditions quando verificamos dentro do set()
    const currentlyDragging = new Set(pendingMoveActions.keys());
    
    // Filtrar cartas que estão sendo arrastadas localmente (não aplicar patches delas)
    // Isso evita conflito quando o sender recebe seus próprios movimentos de volta
    // IMPORTANTE: Para peers, quando arrastam uma carta, ela está em pendingMoveActions
    // e não devemos aplicar patches dela até que o drag termine
    const cardsToApply = cards.filter((card) => {
      // Se a carta está em pendingMoveActions, significa que está sendo arrastada localmente
      // Ignorar patches para essa carta enquanto está sendo arrastada
      // Isso é especialmente importante para peers que enviam para o host e recebem de volta
      if (currentlyDragging.has(card.id)) {
        // NUNCA aplicar patches de cartas que estão sendo arrastadas localmente
        // Isso causa pulos porque o patch vem com delay e sobrescreve o movimento suave local
        return false;
      }
      
      // Verificar se a posição recebida é significativamente diferente da atual
      // Se for muito diferente, pode ser um patch antigo (devido ao delay de rede)
      // Aplicar apenas se a diferença for pequena (movimento suave) ou se não houver posição atual
      const currentCard = state.board.find((c) => c.id === card.id);
      if (currentCard) {
        const dx = Math.abs(currentCard.position.x - card.position.x);
        const dy = Math.abs(currentCard.position.y - card.position.y);
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Se a diferença for muito grande (>100px), pode ser um patch antigo - ignorar
        // Isso evita pulos causados por patches desatualizados devido ao delay de rede
        if (distance > 100) {
          return false;
        }
      }
      
      return true;
    });
    
    // Se não há cartas para aplicar, não fazer nada
    if (cardsToApply.length === 0) {
      return;
    }
    
    // Aplicar visualmente imediatamente (feedback visual suave, como o sender)
    // IMPORTANTE: Não aplicar patches de cartas que estão em pendingMoveActions
    // Isso garante que o movimento local suave não seja sobrescrito por patches com delay
    set((state) => {
      if (!state) return state;
      // Aplicar apenas a última posição de cada carta (colapsar N eventos em 1)
      // Mas NUNCA aplicar se a carta está sendo arrastada localmente
      // Usar o Set capturado anteriormente para evitar race conditions
      const updatedBoard = state.board.map((card) => {
        // Verificar novamente se não está sendo arrastada (double-check para evitar race conditions)
        if (currentlyDragging.has(card.id)) {
          return card; // Manter posição local, não aplicar patch
        }
        const patch = cardsToApply.find((c) => c.id === card.id);
        return patch ? { ...card, position: patch.position } : card;
      });
      return {
        ...state,
        board: updatedBoard,
      };
    });
    
    // Colapsar múltiplas atualizações: guardar apenas a última posição de cada carta
    // Isso é usado apenas para garantir que não processamos patches antigos
    cardsToApply.forEach((card) => {
      pendingBoardPatches.set(card.id, { id: card.id, position: card.position });
    });
    
    // Agendar processamento (será throttled para 30fps via requestAnimationFrame)
    // Mas como já aplicamos visualmente, isso serve apenas para limpar o cache
    scheduleAnimationFrame();
  };
  const commitMoveAction = (cardId: string | null, position?: Point) => {
    const state = get();
    if (!state) return;
    if (!cardId || !position) return;
    requestAction({ kind: 'move', id: cardId, position });
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
    createRoom: async (roomId: string, password: string) => {
      destroyPeer();
      const trimmedId = roomId?.trim() || `room-${randomId()}`;
      const currentState = get();
      const savedState = await loadRoomState(trimmedId);
      const socket = createSocket();

      set({
        ...baseState(),
        socket,
        isHost: true,
        status: 'initializing' as RoomStatus,
        roomId: trimmedId,
        roomPassword: password,
        playerId: currentState.playerId,
        playerName: currentState.playerName || '',
        board: savedState?.board || [],
        counters: savedState?.counters || [],
        players: savedState?.players || [],
        simulatedPlayers: savedState?.simulatedPlayers || [],
        cemeteryPositions: savedState?.cemeteryPositions || {},
        libraryPositions: savedState?.libraryPositions || {},
        exilePositions: savedState?.exilePositions || {},
      });

      savePersistedState(trimmedId, password, currentState.playerName || '', true);
      attachSocketHandlers(socket);
      socket.onopen = () => {
        sendWs(socket, {
          type: 'room:create',
          payload: {
            roomId: trimmedId,
            password,
            playerId: currentState.playerId,
            playerName: currentState.playerName || 'Host',
          },
        });
      };
    },
    joinRoom: async (roomId: string, password: string) => {
      destroyPeer();
      const trimmedId = roomId?.trim();
      const currentState = get();
      const savedState = await loadRoomState(trimmedId);
      const socket = createSocket();

      set({
        ...baseState(),
        socket,
        status: 'initializing' as RoomStatus,
        roomId: trimmedId,
        roomPassword: password,
        isHost: false,
        playerId: currentState.playerId,
        playerName: currentState.playerName || '',
        board: savedState?.board || [],
        counters: savedState?.counters || [],
        cemeteryPositions: savedState?.cemeteryPositions || {},
        libraryPositions: savedState?.libraryPositions || {},
        exilePositions: savedState?.exilePositions || {},
      });

      savePersistedState(trimmedId, password, currentState.playerName || '', false);

      const hostConnection = new PseudoConnection('host', (message) => {
        sendWs(socket, {
          type: 'room:client_message',
          payload: { roomId: trimmedId, message },
        });
      });
      registerClientConn(hostConnection);
      set({ hostConnection });

      attachSocketHandlers(socket);
      socket.onopen = () => {
        sendWs(socket, {
          type: 'room:join',
          payload: {
            roomId: trimmedId,
            password,
            playerId: currentState.playerId,
            playerName: currentState.playerName || 'Player',
          },
        });
      };
    },
    leaveRoom: () => {
      destroyPeer();
      set((s) => {
        if (!s) return s;
        const newState = {
        ...baseState(),
          playerId: s.playerId,
          playerName: s.playerName,
          savedDecks: s.savedDecks,
        };
        clearPersistedState();
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
    moveCard: (cardId: string, position: Point, options?: { persist?: boolean }) => {
      const state = get();
      if (!state) return;
      if (options?.persist) {
        commitMoveAction(cardId, position);
        return;
      }
      applyLocalMove(cardId, position);
      requestAction({ kind: 'move', id: cardId, position }, true);
    },
    moveLibrary: (playerName: string, _relativePosition: Point, absolutePosition: Point, skipEventSave = false) => {
      const state = get();
      if (!state) return;
      
      if (state.isHost) {
        handleHostAction({ kind: 'moveLibrary', playerName, position: absolutePosition }, skipEventSave);
      } else {
        requestAction({ kind: 'moveLibrary', playerName, position: absolutePosition }, skipEventSave);
      }
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
    moveExile: (playerName: string, position: Point, skipEventSave = false) => {
      const state = get();
      if (!state) return;
      
      // Se for host, aplicar ação diretamente (sem requestAction)
      if (state.isHost) {
        handleHostAction({ kind: 'moveExile', playerName, position }, skipEventSave);
      } else {
        // Se for cliente, atualizar localmente primeiro para feedback imediato
        set((s) => {
          if (!s) return s;
          return {
            ...s,
            exilePositions: {
              ...s.exilePositions,
              [playerName]: position,
            },
          };
        });
        
        // Sempre enviar para o host, mesmo durante drag
        requestAction({ kind: 'moveExile', playerName, position }, skipEventSave);
      }
    },
    toggleTap: (cardId: string) => {
      requestAction({ kind: 'toggleTap', id: cardId });
    },
    removeCard: (cardId: string) => {
      requestAction({ kind: 'remove', id: cardId });
    },
    changeCardZone: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery' | 'exile', position: Point, libraryPlace?: 'top' | 'bottom' | 'random') => {
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
      const hasNoConnection = !state.hostConnection || !state.hostConnection.open;
      
      // Se não há host nem conexão, permitir processamento local (para testes e modo offline)
      if (!isHost && hasNoConnection) {
        // Processar localmente sem verificação de autorização
        requestAction({ kind: 'adjustCommanderDamage', targetPlayerId, attackerPlayerId, delta });
        return;
      }
      
      // Verificar autorização apenas quando há host ou conexão
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
