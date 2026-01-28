import { useEffect, useRef, useState, useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { CardOnBoard, PlayerSummary } from '../store/useGameStore';
import CardToken from './CardToken';
import Hand from './Hand';
import Library from './Library';
import Cemetery from './Cemetery';
import { BoardSeparated } from './BoardSeparated';
import { BoardIndividual } from './BoardIndividual';
import { BoardUnified } from './BoardUnified';
import type { BoardViewProps } from './BoardTypes';
import { BASE_BOARD_WIDTH, BASE_BOARD_HEIGHT, CARD_WIDTH, CARD_HEIGHT } from './BoardTypes';

type Point = { x: number; y: number };

// Constantes importadas de BoardTypes.ts
// CARD_WIDTH, CARD_HEIGHT, BASE_BOARD_WIDTH, BASE_BOARD_HEIGHT já estão importados
const LIBRARY_CARD_WIDTH = 100;
const LIBRARY_CARD_HEIGHT = 140;
const THROTTLE_MS = 8; // ~120fps para melhor responsividade durante drag
const DRAG_THRESHOLD = 5; // Pixels para distinguir clique de drag
const CLICK_BLOCK_DELAY = 300; // ms para bloquear cliques após drag

// Sistema centralizado de drag - apenas uma carta pode ser arrastada por vez
interface DragState {
  cardId: string;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  hasMoved: boolean;
}

interface ClickBlockState {
  cardId: string;
  timeoutId: number;
}

const Board = () => {
  const board = useGameStore((state) => state.board);
  const players = useGameStore((state) => state.players);
  const playerId = useGameStore((state) => state.playerId);
  const storeCemeteryPositions = useGameStore((state) => state.cemeteryPositions);
  const storeLibraryPositions = useGameStore((state) => state.libraryPositions);
  const moveCard = useGameStore((state) => state.moveCard);
  const moveLibrary = useGameStore((state) => state.moveLibrary);
  const moveCemetery = useGameStore((state) => state.moveCemetery);
  const toggleTap = useGameStore((state) => state.toggleTap);
  const removeCard = useGameStore((state) => state.removeCard);
  const changeCardZone = useGameStore((state) => state.changeCardZone);
  const drawFromLibrary = useGameStore((state) => state.drawFromLibrary);
  const reorderHandCard = useGameStore((state) => state.reorderHandCard);
  const shuffleLibrary = useGameStore((state) => state.shuffleLibrary);
  const status = useGameStore((state) => state?.status ?? 'idle');
  const peer = useGameStore((state) => state.peer);
  const connections = useGameStore((state) => state.connections);
  const hostConnection = useGameStore((state) => state.hostConnection);
  const isHost = useGameStore((state) => state.isHost);
  const roomId = useGameStore((state) => state.roomId);
  const setPeerEventLogger = useGameStore((state) => state.setPeerEventLogger);
  const boardRef = useRef<HTMLDivElement>(null);
  
  // Sistema centralizado de drag - apenas uma carta pode ser arrastada por vez
  const dragStateRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false); // Estado para forçar re-render do useEffect
  const dragUpdateRef = useRef<number>(0);
  const clickBlockTimeoutRef = useRef<ClickBlockState | null>(null);
  
  // Estados para library e hand (sincronizar com store)
  const [libraryPositions, setLibraryPositions] = useState<Record<string, Point>>({});
  const [draggingLibrary, setDraggingLibrary] = useState<{ playerId: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const [libraryMoved, setLibraryMoved] = useState(false);
  const libraryMovedRef = useRef<boolean>(false);
  const libraryClickExecutedRef = useRef<boolean>(false);
  
  // Estados para cemetery (sincronizar com store)
  const [cemeteryPositions, setCemeteryPositions] = useState<Record<string, Point>>({});
  
  // Sincronizar posições do store com estado local
  useEffect(() => {
    setCemeteryPositions(storeCemeteryPositions);
  }, [storeCemeteryPositions]);
  
  useEffect(() => {
    setLibraryPositions(storeLibraryPositions);
  }, [storeLibraryPositions]);
  const [draggingCemetery, setDraggingCemetery] = useState<{ playerId: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const [cemeteryMoved, setCemeteryMoved] = useState(false);
  const cemeteryMovedRef = useRef<boolean>(false);
  const [showHand, setShowHand] = useState(true);
  const [handButtonEnabled, setHandButtonEnabled] = useState(false);
  const [showDebugMode, setShowDebugMode] = useState(false);
  const [eventLogMinimized, setEventLogMinimized] = useState(false);
  const [simulatePlayers, setSimulatePlayers] = useState<number>(0);
  const [showSimulatePanel, setShowSimulatePanel] = useState(false);
  const [peerDebugMinimized, setPeerDebugMinimized] = useState(false);
  
  // Gerar players simulados
  const simulatedPlayers: PlayerSummary[] = Array.from({ length: simulatePlayers }, (_, i) => ({
    id: `simulated-${i + 1}`,
    name: `Player ${i + 1}`,
  }));

  // Combinar players reais com simulados
  const allPlayers = simulatePlayers > 0 
    ? [...players, ...simulatedPlayers]
    : players;
  
  // Modos de visualização: 'unified' (todos juntos), 'individual' (um por vez), 'separated' (boards separados)
  const [viewMode, setViewMode] = useState<'unified' | 'individual' | 'separated'>('unified');
  const [selectedPlayerIndex, setSelectedPlayerIndex] = useState(0); // Para modo individual
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    card: CardOnBoard;
  } | null>(null);
  const [contextSubmenu, setContextSubmenu] = useState<'moveZone' | 'libraryPlace' | null>(null);
  const [contextSubmenuLibrary, setContextSubmenuLibrary] = useState<boolean>(false);
  
  // Refs para compartilhar com Hand component
  const dragStartedFromHandRef = useRef<boolean>(false);
  const handCardPlacedRef = useRef<boolean>(false);
  
  // Refs para expor estados do Hand para debug
  const handDragStateRef = useRef<{
    draggingHandCard: string | null;
    handCardMoved: boolean;
    previewHandOrder: number | null;
    dragPosition: Point | null;
    dragStartPosition: Point | null;
  }>({
    draggingHandCard: null,
    handCardMoved: false,
    previewHandOrder: null,
    dragPosition: null,
    dragStartPosition: null,
  });
  
  // Estados para debug
  const [lastTouchedCard, setLastTouchedCard] = useState<CardOnBoard | null>(null);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number; boardX: number; boardY: number } | null>(null);
  
  // Sistema de log de eventos
  interface EventLog {
    id: string;
    timestamp: number;
    type: string;
    message: string;
    cardId?: string;
    cardName?: string;
    details?: Record<string, unknown>;
  }
  const [eventLogs, setEventLogs] = useState<EventLog[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedEvents, setRecordedEvents] = useState<EventLog[]>([]);
  const maxLogs = 50;
  
  // Sistema de log de eventos de peer
  interface PeerEventLog {
    id: string;
    timestamp: number;
    type: 'SENT' | 'RECEIVED';
    direction: 'TO_HOST' | 'TO_PEERS' | 'FROM_HOST' | 'FROM_PEER';
    messageType: string;
    actionKind?: string;
    target?: string;
    details?: Record<string, unknown>;
  }
  const [peerEventLogs, setPeerEventLogs] = useState<PeerEventLog[]>([]);
  const maxPeerLogs = 30;
  
  const addPeerEventLog = useCallback((type: 'SENT' | 'RECEIVED', direction: 'TO_HOST' | 'TO_PEERS' | 'FROM_HOST' | 'FROM_PEER', messageType: string, actionKind?: string, target?: string, details?: Record<string, unknown>) => {
    const log: PeerEventLog = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      type,
      direction,
      messageType,
      actionKind,
      target,
      details,
    };
    
    setPeerEventLogs((prev) => {
      const updated = [log, ...prev].slice(0, maxPeerLogs);
      return updated;
    });
  }, []);
  
  // Conectar o logger de eventos de peer ao store
  useEffect(() => {
    setPeerEventLogger(addPeerEventLog);
    return () => {
      setPeerEventLogger(null);
    };
  }, [setPeerEventLogger, addPeerEventLog]);
  
  const addEventLog = (type: string, message: string, cardId?: string, cardName?: string, details?: Record<string, unknown>) => {
    const log: EventLog = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      type,
      message,
      cardId,
      cardName,
      details,
    };
    
    // Se estiver gravando, adicionar ao array de eventos gravados
    if (isRecording) {
      setRecordedEvents((prev) => [...prev, log]);
    }
    
    setEventLogs((prev) => {
      // Se for MOVE_CARD, agrupar com eventos anteriores da mesma carta
      // MAS apenas se não houver DRAG_END entre eles
      if (type === 'MOVE_CARD' && cardId) {
        // Encontrar o primeiro evento MOVE_CARD da mesma carta (o mais recente na lista)
        const firstMoveIndex = prev.findIndex(
          (l) => l.type === 'MOVE_CARD' && l.cardId === cardId
        );
        
        if (firstMoveIndex !== -1) {
          // Verificar se há algum DRAG_END entre o primeiro MOVE_CARD e agora
          // Se houver, não agrupar (começar um novo grupo)
          const hasDragEndBetween = prev.slice(0, firstMoveIndex).some(
            (l) => l.type === 'DRAG_END' && l.cardId === cardId
          );
          
          if (!hasDragEndBetween) {
            // Se não há DRAG_END entre eles, pode agrupar
            const firstMove = prev[firstMoveIndex];
            const updatedLogs = [...prev];
            
            // Atualizar o evento existente com a posição final
            const moveCount = ((firstMove.details?.moveCount as number) || 1) + 1;
            updatedLogs[firstMoveIndex] = {
              ...firstMove,
              timestamp: firstMove.timestamp, // Manter timestamp original (primeiro movimento)
              message: `Movendo carta: ${cardName || cardId}${moveCount > 1 ? ` (${moveCount} movimentos)` : ''}`,
              details: {
                ...firstMove.details,
                from: firstMove.details?.from || firstMove.details?.position, // Manter posição inicial
                to: details?.to || details?.position, // Atualizar posição final
                moveCount: moveCount,
              },
            };
            
            // Retornar os logs atualizados sem adicionar o novo
            return updatedLogs.slice(0, maxLogs);
          }
          // Se há DRAG_END entre eles, não agrupar - adicionar como novo evento
        }
      }
      
      // Se for DRAG_END ou REORDER_HAND, verificar se já existe um evento idêntico muito recente (dentro de 500ms)
      // para evitar duplicatas de múltiplas chamadas
      if ((type === 'DRAG_END' || type === 'REORDER_HAND') && cardId) {
        const now = Date.now();
        // Verificar se há um evento do mesmo tipo da mesma carta muito recente
        const recentDuplicate = prev.find(
          (l) => 
            l.type === type && 
            l.cardId === cardId && 
            (now - l.timestamp) < 500 // Dentro de 500ms (aumentado para pegar mais casos)
        );
        
        if (recentDuplicate) {
          // Se encontrou um evento idêntico muito recente, não adicionar (evitar duplicata)
          console.log(`[EventLog] Ignorando ${type} duplicado para ${cardId} (dentro de 500ms)`);
          return prev;
        }
      }
      
      // Para outros tipos de eventos ou se não encontrou MOVE_CARD anterior, adicionar normalmente
      const newLogs = [log, ...prev].slice(0, maxLogs);
      return newLogs;
    });
  };
  
  const toggleRecording = async () => {
    if (isRecording) {
      // Parar gravação e copiar eventos gravados
      if (recordedEvents.length === 0) {
        setIsRecording(false);
        setRecordedEvents([]);
        return;
      }
      
      // Formatar eventos gravados em texto
      const logText = recordedEvents.map((log) => {
        const time = new Date(log.timestamp);
        const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}.${time.getMilliseconds().toString().padStart(3, '0')}`;
        
        let text = `${log.type} ${timeStr}\n${log.message}`;
        
        if (log.cardName) {
          text += `\nCarta: ${log.cardName}`;
          if (log.cardId) {
            text += ` (${log.cardId})`;
          }
        }
        
        if (log.details && Object.keys(log.details).length > 0) {
          text += `\nDetalhes: ${JSON.stringify(log.details, null, 2)}`;
        }
        
        return text;
      }).join('\n\n');
      
      // Adicionar cabeçalho
      const header = `=== SEQUÊNCIA DE EVENTOS GRAVADA ===\nTotal de eventos: ${recordedEvents.length}\nInício: ${new Date(recordedEvents[0].timestamp).toLocaleString()}\nFim: ${new Date(recordedEvents[recordedEvents.length - 1].timestamp).toLocaleString()}\n\n`;
      const fullText = header + logText;
      
      try {
        await navigator.clipboard.writeText(fullText);
        // Feedback visual
        const button = document.querySelector('[data-record-button]') as HTMLButtonElement;
        if (button) {
          const originalText = button.textContent;
          button.textContent = '✓ Copiado!';
          button.style.background = 'rgba(34, 197, 94, 0.3)';
          button.style.borderColor = '#22c55e';
          setTimeout(() => {
            button.textContent = originalText;
            button.style.background = 'rgba(239, 68, 68, 0.3)';
            button.style.borderColor = '#ef4444';
          }, 2000);
        }
      } catch (err) {
        console.error('Erro ao copiar eventos gravados:', err);
        // Fallback
        const textArea = document.createElement('textarea');
        textArea.value = fullText;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
        } catch (fallbackErr) {
          console.error('Erro no fallback de cópia:', fallbackErr);
        }
        document.body.removeChild(textArea);
      }
      
      setIsRecording(false);
      setRecordedEvents([]);
    } else {
      // Iniciar gravação
      setIsRecording(true);
      setRecordedEvents([]);
    }
  };
  
  const copyEventLogs = async () => {
    if (eventLogs.length === 0) {
      return;
    }
    
    // Formatar logs em texto
    const logText = eventLogs.map((log) => {
      const time = new Date(log.timestamp);
      const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}.${time.getMilliseconds().toString().padStart(3, '0')}`;
      
      let text = `${log.type} ${timeStr}\n${log.message}`;
      
      if (log.cardName) {
        text += `\nCarta: ${log.cardName}`;
        if (log.cardId) {
          text += ` (${log.cardId})`;
        }
      }
      
      if (log.details && Object.keys(log.details).length > 0) {
        text += `\nDetalhes: ${JSON.stringify(log.details, null, 2)}`;
      }
      
      return text;
    }).join('\n\n');
    
    try {
      await navigator.clipboard.writeText(logText);
      // Feedback visual temporário
      const button = document.querySelector('[data-copy-logs-button]') as HTMLButtonElement;
      if (button) {
        const originalText = button.textContent;
        button.textContent = '✓ Copiado!';
        button.style.background = 'rgba(34, 197, 94, 0.3)';
        button.style.borderColor = '#22c55e';
        setTimeout(() => {
          button.textContent = originalText;
          button.style.background = 'rgba(59, 130, 246, 0.3)';
          button.style.borderColor = '#3b82f6';
        }, 2000);
      }
    } catch (err) {
      console.error('Erro ao copiar logs:', err);
      // Fallback para navegadores mais antigos
      const textArea = document.createElement('textarea');
      textArea.value = logText;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        const button = document.querySelector('[data-copy-logs-button]') as HTMLButtonElement;
        if (button) {
          const originalText = button.textContent;
          button.textContent = '✓ Copiado!';
          button.style.background = 'rgba(34, 197, 94, 0.3)';
          button.style.borderColor = '#22c55e';
          setTimeout(() => {
            button.textContent = originalText;
            button.style.background = 'rgba(59, 130, 246, 0.3)';
            button.style.borderColor = '#3b82f6';
          }, 2000);
        }
      } catch (fallbackErr) {
        console.error('Erro no fallback de cópia:', fallbackErr);
      }
      document.body.removeChild(textArea);
    }
  };
  
  const battlefieldCards = board.filter((c) => c.zone === 'battlefield');
  const libraryCards = board.filter((c) => c.zone === 'library');
  const handCards = board.filter((c) => c.zone === 'hand');
  const cemeteryCards = board.filter((c) => c.zone === 'cemetery');
  
  // Ajustar posição de cartas recém-adicionadas para o centro da área do player
  const processedCardsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!boardRef.current) return;
    
    const cardsToCenter = battlefieldCards.filter(
      (card) => 
        card.ownerId === playerId && 
        card.position.x === -1 && 
        card.position.y === -1 &&
        !processedCardsRef.current.has(card.id)
    );
    
    if (cardsToCenter.length > 0) {
      const rect = boardRef.current.getBoundingClientRect();
      const playerArea = getPlayerArea(playerId);
      
      if (playerArea) {
        const CARD_WIDTH = 150;
        const CARD_HEIGHT = 210;
        const centerX = playerArea.x + (playerArea.width / 2) - (CARD_WIDTH / 2);
        const centerY = playerArea.y + (playerArea.height / 2) - (CARD_HEIGHT / 2);
        
        cardsToCenter.forEach((card) => {
          processedCardsRef.current.add(card.id);
          moveCard(card.id, { x: centerX, y: centerY });
        });
      }
    }
    
    // Limpar ref de cartas que não existem mais
    const currentCardIds = new Set(battlefieldCards.map(c => c.id));
    processedCardsRef.current.forEach((id) => {
      if (!currentCardIds.has(id)) {
        processedCardsRef.current.delete(id);
      }
    });
  }, [board, playerId, moveCard]);

  // Tamanho base do board em 1080p (importado de BoardTypes.ts)
  
  // Calcular scale baseado na resolução atual (para individual/unified)
  const getBoardScale = useCallback(() => {
    if (!boardRef.current) return 1;
    const rect = boardRef.current.getBoundingClientRect();
    const scaleX = rect.width / BASE_BOARD_WIDTH;
    const scaleY = rect.height / BASE_BOARD_HEIGHT;
    // Usar o menor scale para manter proporções e garantir que caiba
    return Math.min(scaleX, scaleY);
  }, []);

  // Função auxiliar para converter coordenadas do mouse no modo separated
  const convertMouseToSeparatedCoordinates = (
    mouseX: number,
    mouseY: number,
    playerId: string,
    rect: DOMRect
  ): { x: number; y: number } | null => {
    const windowInfo = getPlayerWindowAtPosition(mouseX, mouseY);
    if (!windowInfo || windowInfo.player.id !== playerId) {
      return null;
    }

    // Criar um rect virtual para a janela do player
    // O rect da janela do player é relativo ao board principal
    const windowRect = {
      left: rect.left + windowInfo.windowLeft,
      top: rect.top + windowInfo.windowTop,
      width: windowInfo.windowWidth,
      height: windowInfo.windowHeight,
    } as DOMRect;

    // Usar EXATAMENTE a mesma lógica do convertMouseToUnifiedCoordinates (individual)
    // mas aplicada ao rect da janela do player
    // Isso garante que o drag funcione da mesma forma que no individual
    let cursorX = mouseX - windowRect.left;
    let cursorY = mouseY - windowRect.top;

    // Converter coordenadas do mouse para o espaço base (1920x1080)
    // Usar o mesmo cálculo do individual: Math.min(scaleX, scaleY) para manter proporção
    const scaleX = windowRect.width / BASE_BOARD_WIDTH;
    const scaleY = windowRect.height / BASE_BOARD_HEIGHT;
    const scale = Math.min(scaleX, scaleY);
    
    const scaledWidth = BASE_BOARD_WIDTH * scale;
    const scaledHeight = BASE_BOARD_HEIGHT * scale;
    const offsetX = (windowRect.width - scaledWidth) / 2;
    const offsetY = (windowRect.height - scaledHeight) / 2;

    // Converter para coordenadas no espaço base
    cursorX = (cursorX - offsetX) / scale;
    cursorY = (cursorY - offsetY) / scale;

    return { x: cursorX, y: cursorY };
  };

  // Função auxiliar para converter coordenadas do mouse no modo individual/unified
  const convertMouseToUnifiedCoordinates = useCallback((
    mouseX: number,
    mouseY: number,
    rect: DOMRect
  ): { x: number; y: number } => {
    let cursorX = mouseX - rect.left;
    let cursorY = mouseY - rect.top;

    // Converter coordenadas do mouse para o espaço base (1920x1080)
    // Usar o mesmo cálculo do render para garantir consistência
    // Calcular scale usando o rect fornecido (mesmo usado no render)
    const scaleX = rect.width / BASE_BOARD_WIDTH;
    const scaleY = rect.height / BASE_BOARD_HEIGHT;
    const scale = Math.min(scaleX, scaleY);
    
    const scaledWidth = BASE_BOARD_WIDTH * scale;
    const scaledHeight = BASE_BOARD_HEIGHT * scale;
    const offsetX = (rect.width - scaledWidth) / 2;
    const offsetY = (rect.height - scaledHeight) / 2;

    // Converter para coordenadas no espaço base
    cursorX = (cursorX - offsetX) / scale;
    cursorY = (cursorY - offsetY) / scale;

    return { x: cursorX, y: cursorY };
  }, []);

  // Função para encontrar qual player window contém o cursor
  const getPlayerWindowAtPosition = (mouseX: number, mouseY: number) => {
    if (viewMode !== 'separated' || !boardRef.current) return null;
    
    const rect = boardRef.current.getBoundingClientRect();
    const boardWidth = rect.width;
    const boardHeight = rect.height;
    const cols = Math.ceil(Math.sqrt(allPlayers.length));
    const rows = Math.ceil(allPlayers.length / cols);
    
    // Converter coordenadas do mouse para coordenadas relativas ao board
    const relativeX = mouseX - rect.left;
    const relativeY = mouseY - rect.top;
    
    // Calcular porcentagens (mesmo cálculo do render)
    const widthPercent = 100 / cols;
    const heightPercent = 100 / rows;
    
    // Encontrar qual coluna e linha contém o cursor usando porcentagens
    // Isso deve corresponder exatamente ao cálculo do render
    const col = Math.min(Math.floor((relativeX / boardWidth) * cols), cols - 1);
    const row = Math.min(Math.floor((relativeY / boardHeight) * rows), rows - 1);
    
    // Verificar se está dentro dos limites
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    
    // Calcular posição e tamanho da janela usando porcentagens (igual ao render)
    const leftPercent = (col / cols) * 100;
    const topPercent = (row / rows) * 100;
    const windowLeft = (boardWidth * leftPercent) / 100;
    const windowTop = (boardHeight * topPercent) / 100;
    const windowWidth = (boardWidth * widthPercent) / 100;
    const windowHeight = (boardHeight * heightPercent) / 100;
    
    // Verificar se o cursor está dentro da janela (com tolerância para bordas)
    const tolerance = 1; // 1px de tolerância para bordas
    if (
      relativeX >= windowLeft - tolerance &&
      relativeX <= windowLeft + windowWidth + tolerance &&
      relativeY >= windowTop - tolerance &&
      relativeY <= windowTop + windowHeight + tolerance
    ) {
      // Calcular o índice do player (mesmo cálculo do render: index = row * cols + col)
      const playerIndex = row * cols + col;
      if (playerIndex >= 0 && playerIndex < allPlayers.length) {
        return {
          player: allPlayers[playerIndex],
          playerIndex,
          col,
          row,
          windowLeft,
          windowTop,
          windowWidth,
          windowHeight,
        };
      }
    }
    
    return null;
  };

  const getPlayerArea = (ownerId: string) => {
    if (!boardRef.current || allPlayers.length === 0) return null;
    const playerIndex = allPlayers.findIndex((p) => p.id === ownerId);
    if (playerIndex === -1) return null;

    // No modo separated, retornar tamanho base (1920x1080) já que o scale é aplicado no container
    if (viewMode === 'separated') {
      return {
        x: 0,
        y: 0,
        width: BASE_BOARD_WIDTH,
        height: BASE_BOARD_HEIGHT,
      };
    }
    
    // No modo individual ou unified, usar o espaço base
    return {
      x: 0,
      y: 0,
      width: BASE_BOARD_WIDTH,
      height: BASE_BOARD_HEIGHT,
    };
  };

  const getHandArea = (ownerId: string) => {
    if (!boardRef.current || allPlayers.length === 0 || !showHand) return null;
    const playerIndex = allPlayers.findIndex((p) => p.id === ownerId);
    if (playerIndex === -1) return null;

    const HAND_CARD_LEFT_SPACING = 120;
    const maxRenderCards = 9;
    
    const playerHandCards = board.filter((c) => c.zone === 'hand' && c.ownerId === ownerId);
    const totalCards = playerHandCards.length;
    
    // Usar o espaço base (1920x1080)
    if (totalCards === 0) {
      const handHeight = 168 + 20; // HAND_CARD_HEIGHT + margin
      const handY = BASE_BOARD_HEIGHT - handHeight;
      return {
        x: 0,
        y: handY,
        width: BASE_BOARD_WIDTH,
        height: handHeight,
      };
    }
    
    const visibleCardsCount = Math.min(maxRenderCards, totalCards);
    const handWidth = (visibleCardsCount * HAND_CARD_LEFT_SPACING) + 40;
    const handX = (BASE_BOARD_WIDTH - handWidth) / 2;
    
    const curveHeight = 8;
    const HOVER_LIFT_PX = 10;
    const baseHandHeight = 168 + curveHeight + HOVER_LIFT_PX + 10; // HAND_CARD_HEIGHT + extras
    const marginY = baseHandHeight * 0.1;
    const handHeight = baseHandHeight + (marginY * 2);
    const handY = BASE_BOARD_HEIGHT - handHeight;

    return {
      x: handX,
      y: handY,
      width: handWidth,
      height: handHeight,
    };
  };

  const getCemeteryPosition = (playerId: string): Point | null => {
    const area = getPlayerArea(playerId);
    if (!area) return null;
    
    const CEMETERY_CARD_WIDTH = 100;
    const CEMETERY_CARD_HEIGHT = 140;
    
    // Primeiro, verificar se há posição no store (sincronizada entre peers)
    // As posições no store já estão no espaço base
    if (storeCemeteryPositions[playerId]) {
      return storeCemeteryPositions[playerId];
    }
    
    // Segundo, verificar se há posição salva localmente
    if (cemeteryPositions[playerId]) {
      return cemeteryPositions[playerId];
    }
    
    // Terceiro, verificar se há cartas no board com posição (vindo dos peers)
    const playerCemeteryCards = cemeteryCards
      .filter((c) => c.ownerId === playerId)
      .sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0))
      .slice(0, 5);
    
    const topCard = playerCemeteryCards[0];
    if (topCard && topCard.position.x !== 0 && topCard.position.y !== 0) {
      // Usar a posição da carta do topo (que vem do board sincronizado)
      // As posições já estão no espaço base
      return {
        x: topCard.position.x,
        y: topCard.position.y,
      };
    }
    
    // Caso contrário, posição padrão no espaço base com offset baseado no índice do jogador
    const playerIndex = players.findIndex((p) => p.id === playerId);
    const offsetX = playerIndex * (CEMETERY_CARD_WIDTH + 20);
    return {
      x: area.x + (area.width / 2) - CEMETERY_CARD_WIDTH / 2 + offsetX,
      y: area.y + (area.height / 2) - CEMETERY_CARD_HEIGHT / 2,
    };
  };

  // Função para detectar em qual zona o cursor está
  const detectZoneAtPosition = (x: number, y: number): { zone: 'battlefield' | 'hand' | 'library' | 'cemetery' | null; ownerId?: string } => {
    if (!boardRef.current) return { zone: null };
    
    // Verificar cemitério
    const CEMETERY_CARD_WIDTH = 100;
    const CEMETERY_STACK_WIDTH = 120; // Área maior do stack
    const CEMETERY_STACK_HEIGHT = 160;
    
    // Verificar se está dentro da área do cemitério (considerando todos os players)
    for (const player of allPlayers) {
      const cemeteryPos = getCemeteryPosition(player.id);
      if (cemeteryPos) {
        if (
          x >= cemeteryPos.x - 10 &&
          x <= cemeteryPos.x + CEMETERY_STACK_WIDTH &&
          y >= cemeteryPos.y - 10 &&
          y <= cemeteryPos.y + CEMETERY_STACK_HEIGHT
        ) {
          return { zone: 'cemetery', ownerId: player.id };
        }
      }
    }
    
    // Verificar hand
    if (showHand) {
      const handArea = getHandArea(playerId);
      if (handArea) {
        if (
          x >= handArea.x &&
          x <= handArea.x + handArea.width &&
          y >= handArea.y &&
          y <= handArea.y + handArea.height
        ) {
          return { zone: 'hand', ownerId: playerId };
        }
      }
    }
    
    // Verificar library
    for (const player of allPlayers) {
      const libraryPos = getLibraryPosition(player.id);
      if (libraryPos) {
        const LIBRARY_CARD_WIDTH = 100;
        const LIBRARY_CARD_HEIGHT = 140;
        if (
          x >= libraryPos.x &&
          x <= libraryPos.x + LIBRARY_CARD_WIDTH &&
          y >= libraryPos.y &&
          y <= libraryPos.y + LIBRARY_CARD_HEIGHT
        ) {
          return { zone: 'library', ownerId: player.id };
        }
      }
    }
    
    // Se não está em nenhuma zona específica, é battlefield
    return { zone: 'battlefield' };
  };

  const getLibraryPosition = (ownerId: string) => {
    const area = getPlayerArea(ownerId);
    if (!area) return null;
    
    const playerLibraryCards = libraryCards
      .filter((c) => c.ownerId === ownerId)
      .sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0))
      .slice(0, 5);
    
    const topCard = playerLibraryCards[0];
    if (topCard && topCard.position.x !== 0 && topCard.position.y !== 0) {
      // As posições das cartas já estão no espaço base
      return {
        x: topCard.position.x,
        y: topCard.position.y,
      };
    }
    
    // Se há posição salva no store, usar ela (já está no espaço base)
    if (storeLibraryPositions[ownerId]) {
      return {
        x: storeLibraryPositions[ownerId].x,
        y: storeLibraryPositions[ownerId].y,
      };
    }
    
    // Posição padrão no espaço base
    return {
      x: area.x + (area.width / 2) - (LIBRARY_CARD_WIDTH / 2),
      y: area.y + (area.height / 2) - (LIBRARY_CARD_HEIGHT / 2),
    };
  };

  // Sistema centralizado de drag - apenas uma carta pode ser arrastada por vez
  useEffect(() => {
    const dragState = dragStateRef.current;
    if (!isDragging || !dragState || !boardRef.current) return;

    const handleMove = (event: PointerEvent) => {
      const now = Date.now();
      if (now - dragUpdateRef.current < THROTTLE_MS) return;
      dragUpdateRef.current = now;

      // Verificar se a carta ainda existe
      const currentBoard = useGameStore.getState().board;
      const card = currentBoard.find((c) => c.id === dragState.cardId);
      if (!card) {
        dragStateRef.current = null;
        setIsDragging(false);
        return;
      }

      // Permitir drag de qualquer zona agora

      // Verificar se moveu o suficiente para considerar um drag
      const deltaX = Math.abs(event.clientX - dragState.startX);
      const deltaY = Math.abs(event.clientY - dragState.startY);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        dragState.hasMoved = true;
      }

      // Calcular nova posição
      const rect = boardRef.current!.getBoundingClientRect();
      let cursorX = event.clientX - rect.left;
      let cursorY = event.clientY - rect.top;
      
      // Log: mouse real
      const realMouseX = event.clientX;
      const realMouseY = event.clientY;
      const relativeMouseX = cursorX;
      const relativeMouseY = cursorY;
      
    // Converter coordenadas do mouse baseado no modo
    if (viewMode === 'separated') {
      // Modo separated: usar função auxiliar específica
      const coords = convertMouseToSeparatedCoordinates(
        event.clientX,
        event.clientY,
        card.ownerId,
        rect
      );
      if (!coords) {
        // Se não está na janela do player correto, manter posição atual
        return;
      }
      cursorX = coords.x;
      cursorY = coords.y;
    } else {
      // Modo individual/unified: usar função auxiliar específica
      // Garantir que estamos usando o mesmo rect e scale do render
      const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
      cursorX = coords.x;
      cursorY = coords.y;
    }
      
    const x = cursorX - dragState.offsetX;
    const y = cursorY - dragState.offsetY;

    // Clamp dentro da área do player
    let clampedX = x;
    let clampedY = y;

    if (viewMode === 'separated') {
      // No modo separated, trabalhar com pixels no espaço base (1920x1080)
      const playerArea = getPlayerArea(card.ownerId);
      if (playerArea) {
        clampedX = Math.max(
          playerArea.x,
          Math.min(playerArea.x + playerArea.width - CARD_WIDTH, x)
        );
        clampedY = Math.max(
          playerArea.y,
          Math.min(playerArea.y + playerArea.height - CARD_HEIGHT, y)
        );
      } else {
        clampedX = Math.max(0, Math.min(BASE_BOARD_WIDTH - CARD_WIDTH, x));
        clampedY = Math.max(0, Math.min(BASE_BOARD_HEIGHT - CARD_HEIGHT, y));
      }
    } else {
      // No modo individual/unified, trabalhar com pixels no espaço base (1920x1080)
      const playerArea = getPlayerArea(card.ownerId);
      if (playerArea) {
        clampedX = Math.max(
          playerArea.x,
          Math.min(playerArea.x + playerArea.width - CARD_WIDTH, x)
        );
        clampedY = Math.max(
          playerArea.y,
          Math.min(playerArea.y + playerArea.height - CARD_HEIGHT, y)
        );
      } else {
        // Usar espaço base (1920x1080) como no modo separated
        clampedX = Math.max(0, Math.min(BASE_BOARD_WIDTH - CARD_WIDTH, x));
        clampedY = Math.max(0, Math.min(BASE_BOARD_HEIGHT - CARD_HEIGHT, y));
      }
    }

    // Mover a carta apenas se realmente moveu
    if (dragState.hasMoved) {
      const currentBoard = useGameStore.getState().board;
      const card = currentBoard.find((c) => c.id === dragState.cardId);
      if (card) {
        addEventLog('MOVE_CARD', `Movendo carta: ${card.name}`, card.id, card.name, {
          from: card.position,
          to: { x: clampedX, y: clampedY },
        });
      }
      moveCard(dragState.cardId, { x: clampedX, y: clampedY });
    }
    };

    const handleUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      // Ignorar se foi botão direito ou botão do meio
      if (event.button === 1 || event.button === 2) {
        console.log('[Board] handleUp: Ignorando porque foi botão direito ou do meio');
        dragStateRef.current = null;
        setIsDragging(false);
        return;
      }

      console.log('[Board] handleUp chamado:', {
        cardId: dragState.cardId,
        hasMoved: dragState.hasMoved,
        isDragging,
        button: event.button,
      });

      // Detectar zona ao soltar e mudar se necessário
      if (dragState.hasMoved && boardRef.current) {
        const currentBoard = useGameStore.getState().board;
        const card = currentBoard.find((c) => c.id === dragState.cardId);
        
        if (card && card.ownerId === playerId) {
          const rect = boardRef.current.getBoundingClientRect();
          
          // Converter coordenadas para o espaço base antes de detectar zona
          let baseX: number;
          let baseY: number;
          
          if (viewMode === 'separated') {
            const coords = convertMouseToSeparatedCoordinates(
              event.clientX,
              event.clientY,
              card.ownerId,
              rect
            );
            if (coords) {
              baseX = coords.x;
              baseY = coords.y;
            } else {
              // Se não está na janela do player, usar coordenadas relativas
              baseX = event.clientX - rect.left;
              baseY = event.clientY - rect.top;
            }
          } else {
            const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
            baseX = coords.x;
            baseY = coords.y;
          }
          
          const detectedZone = detectZoneAtPosition(baseX, baseY);
          
          // Se detectou uma zona diferente da atual, mudar
          if (detectedZone.zone && detectedZone.zone !== card.zone) {
            console.log('[Board] handleUp: Mudando zona da carta:', {
              cardId: card.id,
              cardName: card.name,
              from: card.zone,
              to: detectedZone.zone,
            });
            
            let position: Point = { x: 0, y: 0 };
            
            if (detectedZone.zone === 'battlefield') {
              // Posição onde soltou (já convertida para espaço base)
              position = {
                x: Math.max(0, Math.min(BASE_BOARD_WIDTH - CARD_WIDTH, baseX - dragState.offsetX)),
                y: Math.max(0, Math.min(BASE_BOARD_HEIGHT - CARD_HEIGHT, baseY - dragState.offsetY)),
              };
            } else if (detectedZone.zone === 'cemetery') {
              const cemeteryPos = getCemeteryPosition(detectedZone.ownerId || card.ownerId);
              position = cemeteryPos || { x: 0, y: 0 };
            } else if (detectedZone.zone === 'library') {
              const libraryPos = getLibraryPosition(detectedZone.ownerId || card.ownerId);
              position = libraryPos || { x: 0, y: 0 };
            }
            // hand não precisa de posição, será calculada automaticamente
            
            addEventLog('CHANGE_ZONE', `Mudando zona: ${card.name} (${card.zone} → ${detectedZone.zone})`, card.id, card.name, {
              from: card.zone,
              to: detectedZone.zone,
              position,
            });
            
            changeCardZone(card.id, detectedZone.zone, position);
            
            // Limpar estados de drag imediatamente
            dragStateRef.current = null;
            setIsDragging(false);
            
            // Bloquear cliques por um tempo após mudança de zona
            if (clickBlockTimeoutRef.current) {
              clearTimeout(clickBlockTimeoutRef.current.timeoutId);
            }
            const timeoutId = window.setTimeout(() => {
              clickBlockTimeoutRef.current = null;
            }, CLICK_BLOCK_DELAY);
            clickBlockTimeoutRef.current = { cardId: card.id, timeoutId };
            
            // Resetar todos os estados de drag
            requestAnimationFrame(() => {
              resetAllDragStates();
            });
            
            return;
          }
        }
      }

      // Limpar estado de drag
      const hadMoved = dragState.hasMoved;
      const cardId = dragState.cardId;
      
      // Log evento de drag end (se não foi para hand, que já loga)
      if (hadMoved) {
        const currentBoard = useGameStore.getState().board;
        const card = currentBoard.find((c) => c.id === cardId);
        if (card) {
          // Só logar se não foi para hand (já foi logado acima)
          const rect = boardRef.current?.getBoundingClientRect();
          if (rect) {
            const cursorX = event.clientX - rect.left;
            const cursorY = event.clientY - rect.top;
            const handArea = getHandArea(playerId);
            const isInHandArea = handArea && 
              cursorX >= handArea.x && 
              cursorX <= handArea.x + handArea.width &&
              cursorY >= handArea.y && 
              cursorY <= handArea.y + handArea.height;
            
            if (!isInHandArea) {
              // Atualizar o evento MOVE_CARD para marcar como final
              setEventLogs((prev) => {
                const moveIndex = prev.findIndex(
                  (l) => l.type === 'MOVE_CARD' && l.cardId === cardId
                );
                
                if (moveIndex !== -1) {
                  const updatedLogs = [...prev];
                  const moveEvent = updatedLogs[moveIndex];
                  const moveCount = (moveEvent.details?.moveCount as number) || 1;
                  updatedLogs[moveIndex] = {
                    ...moveEvent,
                    message: `Movendo carta: ${card.name}${moveCount > 1 ? ` (${moveCount} movimentos, final)` : ' (final)'}`,
                    details: {
                      ...moveEvent.details,
                      to: card.position, // Atualizar com posição final
                      final: true,
                    },
                  };
                  return updatedLogs;
                }
                
                return prev;
              });
              
              addEventLog('DRAG_END', `Finalizando drag: ${card.name}`, card.id, card.name, {
                zone: card.zone,
                hasMoved: hadMoved,
                finalPosition: card.position,
              });
            }
          }
        }
      }
      
      // Limpar estado imediatamente
      dragStateRef.current = null;
      setIsDragging(false);
      
      // Se não moveu, processar como clique (tap/untap)
      if (!hadMoved) {
        // Obter a carta atualizada do store
        const currentBoard = useGameStore.getState().board;
        const card = currentBoard.find((c) => c.id === cardId);
        
        console.log('[Board] handleUp: Não moveu, verificando se deve fazer tap:', {
          cardId,
          card: card ? { id: card.id, name: card.name, zone: card.zone, ownerId: card.ownerId, tapped: card.tapped } : null,
          playerId,
        });
        
        if (card && card.zone === 'battlefield' && card.ownerId === playerId) {
          console.log('[Board] handleUp: Fazendo tap na carta:', {
            cardId: card.id,
            cardName: card.name,
            currentTapped: card.tapped,
          });
          toggleTap(cardId);
        } else {
          console.log('[Board] handleUp: Não fez tap porque:', {
            cardExists: !!card,
            zone: card?.zone,
            ownerId: card?.ownerId,
            playerId,
            isBattlefield: card?.zone === 'battlefield',
            isOwner: card?.ownerId === playerId,
          });
        }
        
        if (clickBlockTimeoutRef.current) {
          clearTimeout(clickBlockTimeoutRef.current.timeoutId);
          clickBlockTimeoutRef.current = null;
        }
        console.log('[Board] handleUp: Não moveu, limpando estado imediatamente');
        return;
      }

      // Se moveu, bloquear cliques por um tempo apenas para esta carta
      if (clickBlockTimeoutRef.current) {
        clearTimeout(clickBlockTimeoutRef.current.timeoutId);
      }
      const timeoutId = window.setTimeout(() => {
        clickBlockTimeoutRef.current = null;
      }, CLICK_BLOCK_DELAY);
      clickBlockTimeoutRef.current = { cardId: dragState.cardId, timeoutId };
      console.log('[Board] handleUp: Moveu, bloqueando cliques por', CLICK_BLOCK_DELAY, 'ms');
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [isDragging, showHand, playerId, moveCard, changeCardZone, getPlayerArea, getHandArea, viewMode, players]);

  const startDrag = (card: CardOnBoard, event: ReactPointerEvent) => {
    // Ignorar botão direito e botão do meio
    if (event.button === 1 || event.button === 2) return;
    
    // Só pode mover suas próprias cartas
    if (card.ownerId !== playerId) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    if (!boardRef.current) return;
    
    // Se a carta está na hand, não iniciar drag aqui (deixar o Hand component gerenciar)
    if (card.zone === 'hand' && showHand) {
      return;
    }
    
    // Verificar se a carta ainda existe no board atualizado
    const currentBoard = useGameStore.getState().board;
    const currentCard = currentBoard.find((c) => c.id === card.id);
    if (!currentCard) {
      console.log('[Board] startDrag: Carta não encontrada no board, cancelando drag');
      return;
    }
    
    addEventLog('DRAG_START', `Iniciando drag: ${currentCard.name}`, currentCard.id, currentCard.name, {
      zone: currentCard.zone,
      position: currentCard.position,
    });

    // Cancelar qualquer drag anterior e limpar completamente
    dragStateRef.current = null;
    setIsDragging(false);
    if (clickBlockTimeoutRef.current) {
      clearTimeout(clickBlockTimeoutRef.current.timeoutId);
      clickBlockTimeoutRef.current = null;
    }
    
    // Limpar estados de drag do hand também
    if (dragStartedFromHandRef) {
      dragStartedFromHandRef.current = false;
    }

    const rect = boardRef.current.getBoundingClientRect();
    // Calcular offset: posição do cursor dentro da carta (relativo ao board)
    // Usar currentCard para garantir que temos a posição mais recente
    const cardX = currentCard.position.x;
    const cardY = currentCard.position.y;
    
    // Converter coordenadas do mouse baseado no modo ANTES de calcular offset
    let cursorX, cursorY;
    if (viewMode === 'separated') {
      // Modo separated: usar função auxiliar específica
      const coords = convertMouseToSeparatedCoordinates(
        event.clientX,
        event.clientY,
        currentCard.ownerId,
        rect
      );
      if (!coords) {
        // Se não está na janela do player correto, usar posição atual da carta
        cursorX = cardX;
        cursorY = cardY;
      } else {
        cursorX = coords.x;
        cursorY = coords.y;
      }
    } else {
      // Modo individual/unified: usar função auxiliar específica
      const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
      cursorX = coords.x;
      cursorY = coords.y;
    }
    
    // Ambos estão em pixels no espaço base (1920x1080)
    const offsetX = cursorX - cardX;
    const offsetY = cursorY - cardY;

    // Iniciar novo drag - apenas uma carta pode ser arrastada por vez
    // Usar currentCard.id para garantir que estamos usando o ID correto
    dragStateRef.current = {
      cardId: currentCard.id,
      offsetX,
      offsetY,
      startX: event.clientX,
      startY: event.clientY,
      hasMoved: false,
    };
    setIsDragging(true); // Forçar re-render para ativar o useEffect
  };

  const resetAllDragStates = () => {
    dragStateRef.current = null;
    setIsDragging(false);
    setDraggingLibrary(null);
    setLibraryMoved(false);
    // NÃO resetar draggingCemetery aqui - ele é gerenciado pelo seu próprio useEffect
    // setDraggingCemetery(null);
    // setCemeteryMoved(false);
    if (clickBlockTimeoutRef.current) {
      clearTimeout(clickBlockTimeoutRef.current.timeoutId);
      clickBlockTimeoutRef.current = null;
    }
    if (showHand) {
      dragStartedFromHandRef.current = false;
      handCardPlacedRef.current = false;
    }
  };

  const instruction =
    status === 'idle' ? 'Create or join a room to sync the battlefield.' : 'Drag cards, double-click to tap.';

  const ownerName = (card: CardOnBoard) => allPlayers.find((player) => player.id === card.ownerId)?.name ?? 'Unknown';

  const handleLibraryClick = (targetPlayerId: string) => {
    if (targetPlayerId === playerId) {
      addEventLog('DRAW_FROM_LIBRARY', 'Comprando carta da library', undefined, undefined, {
        playerId: targetPlayerId,
      });
      drawFromLibrary();
    }
  };

  const handleCardClick = (card: CardOnBoard, event: React.MouseEvent) => {
    // Registrar última carta tocada para debug
    setLastTouchedCard(card);
    
    addEventLog('CLICK', `Click em carta: ${card.name}`, card.id, card.name, {
      zone: card.zone,
      ownerId: card.ownerId,
      position: card.position,
      tapped: card.tapped,
    });
    
    console.log('[Board] handleCardClick chamado:', {
      cardId: card.id,
      cardName: card.name,
      zone: card.zone,
      ownerId: card.ownerId,
      playerId,
      isDragging,
      clickBlockTimeout: clickBlockTimeoutRef.current,
      dragStartedFromHand: dragStartedFromHandRef.current,
      dragStateRef: dragStateRef.current,
      eventType: event.type,
      target: (event.target as HTMLElement)?.className,
    });

    // Bloquear clique apenas se há um drag realmente ativo
    if (isDragging) {
      console.log('[Board] Bloqueado: isDragging = true');
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Bloquear clique apenas se acabou de fazer drag com movimento na mesma carta
    // (o timeout só é definido se houve movimento real)
    if (clickBlockTimeoutRef.current && clickBlockTimeoutRef.current.cardId === card.id) {
      console.log('[Board] Bloqueado: clickBlockTimeout ativo para esta carta');
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Bloquear se há drag da hand ativo
    if (showHand && dragStartedFromHandRef.current) {
      console.log('[Board] Bloqueado: dragStartedFromHand = true');
      event.preventDefault();
      event.stopPropagation();
      dragStartedFromHandRef.current = false;
      handCardPlacedRef.current = false;
      return;
    }

    // Verificar se a carta mudou de zona
    const currentBoard = useGameStore.getState().board;
    const currentCard = currentBoard.find((c) => c.id === card.id);
    if (currentCard && currentCard.zone !== card.zone) {
      console.log('[Board] Bloqueado: carta mudou de zona', {
        cardZone: card.zone,
        currentZone: currentCard.zone,
      });
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Bloquear clique se clicou na área da mão
    const target = event.target as HTMLElement;
    const clickedOnHandArea = target.closest('.hand-area, .hand-cards, .hand-card-wrapper');
    if (clickedOnHandArea && card.zone === 'battlefield') {
      console.log('[Board] Bloqueado: clicou na área da mão');
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Se a carta está no board, fazer tap/untap
    if (card.zone === 'battlefield' && card.ownerId === playerId) {
      console.log('[Board] Fazendo tap na carta:', {
        cardId: card.id,
        cardName: card.name,
        currentTapped: card.tapped,
      });
      addEventLog('TOGGLE_TAP', `Toggle tap: ${card.name} (${card.tapped ? 'tapped' : 'untapped'} → ${!card.tapped ? 'tapped' : 'untapped'})`, card.id, card.name, {
        from: card.tapped,
        to: !card.tapped,
      });
      toggleTap(card.id);
      return;
    }

    // Se está na mão, colocar no board
    if (card.zone === 'hand' && card.ownerId === playerId && showHand) {
      console.log('[Board] Colocando carta da mão no board:', card.id);
      const playerArea = getPlayerArea(playerId);
      if (playerArea) {
        const position = {
          x: playerArea.x + playerArea.width / 2 - CARD_WIDTH / 2,
          y: playerArea.y + playerArea.height / 2 - CARD_HEIGHT / 2,
        };
        addEventLog('CHANGE_ZONE', `Mudando zona: ${card.name} (hand → battlefield)`, card.id, card.name, {
          from: 'hand',
          to: 'battlefield',
          position,
        });
        changeCardZone(card.id, 'battlefield', position);
      }
      return;
    }

    console.log('[Board] Nenhuma ação tomada para o clique');
  };

  const handleCardContextMenu = (card: CardOnBoard, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Registrar última carta tocada para debug
    setLastTouchedCard(card);
    
    addEventLog('CONTEXT_MENU', `Context menu em: ${card.name}`, card.id, card.name, {
      zone: card.zone,
      ownerId: card.ownerId,
    });
    
    console.log('[Board] handleCardContextMenu chamado:', {
      cardId: card.id,
      cardName: card.name,
      zone: card.zone,
      ownerId: card.ownerId,
      playerId,
      isDragging,
    });
    
    // Não bloquear context menu por drag, apenas se está realmente arrastando
    if (isDragging) {
      console.log('[Board] handleCardContextMenu: Bloqueado porque isDragging = true');
      return;
    }
    
    // Mostrar menu de contexto
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      card,
    });
  };
  
  const handleContextMenuAction = (
    action: 'cemetery' | 'remove' | 'shuffle' | 'tap' | 'draw' | 'moveZone' | 'libraryPlace',
    targetZone?: 'hand' | 'battlefield' | 'library' | 'cemetery',
    libraryPlace?: 'top' | 'bottom' | 'random'
  ) => {
    if (!contextMenu) return;
    
    const { card } = contextMenu;
    
    if (action === 'shuffle') {
      // Shuffle apenas se for library e for do jogador
      if (card.zone === 'library' && card.ownerId === playerId) {
        addEventLog('SHUFFLE_LIBRARY', `Embaralhando library`, undefined, undefined, {
          playerId: card.ownerId,
        });
        shuffleLibrary(card.ownerId);
      }
    } else if (action === 'tap') {
      // Tap/Untap
    if (card.ownerId === playerId) {
        addEventLog('TOGGLE_TAP', `${card.tapped ? 'Untap' : 'Tap'}: ${card.name}`, card.id, card.name, {
          from: card.tapped ? 'tapped' : 'untapped',
          to: card.tapped ? 'untapped' : 'tapped',
        });
        toggleTap(card.id);
      }
    } else if (action === 'draw') {
      // Draw - apenas para library
      if (card.zone === 'library' && card.ownerId === playerId) {
        addEventLog('DRAW_FROM_LIBRARY', 'Comprando carta da library', undefined, undefined, {
          playerId: card.ownerId,
        });
        drawFromLibrary();
      }
    } else if (action === 'moveZone' && targetZone) {
      // Mover de zona (não inclui library aqui)
      if (card.ownerId === playerId && card.zone !== targetZone) {
        if (targetZone === 'cemetery') {
          // Cemitério = mover para cemitério (não remover)
          const cemeteryPos = getCemeteryPosition(card.ownerId);
          const position = cemeteryPos || { x: 0, y: 0 };
          
          addEventLog('CHANGE_ZONE', `Mudando para cemitério: ${card.name}`, card.id, card.name, {
            from: card.zone,
            to: 'cemetery',
            position,
          });
          changeCardZone(card.id, 'cemetery', position);
        } else {
          // Calcular posição baseada na zona de destino
          let position: Point = { x: 0, y: 0 };
          if (targetZone === 'battlefield' && boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            position = {
              x: rect.width / 2 - CARD_WIDTH / 2,
              y: rect.height / 2 - CARD_HEIGHT / 2,
            };
          }
          
          addEventLog('CHANGE_ZONE', `Mudando zona: ${card.name} (${card.zone} → ${targetZone})`, card.id, card.name, {
            from: card.zone,
            to: targetZone,
            position,
          });
          changeCardZone(card.id, targetZone, position);
        }
      }
    } else if (action === 'libraryPlace' && libraryPlace) {
      // Mover para library em posição específica
      if (card.ownerId === playerId) {
        const libraryPos = getLibraryPosition(card.ownerId);
        const position = libraryPos || { x: 0, y: 0 };
        
        addEventLog('CHANGE_ZONE', `Mudando para library (${libraryPlace}): ${card.name}`, card.id, card.name, {
          from: card.zone,
          to: 'library',
          libraryPlace,
        });
        changeCardZone(card.id, 'library', position, libraryPlace);
      }
    } else {
      // Cemitério ou Remover - ambos deletam
      if (card.ownerId === playerId) {
        const actionName = action === 'cemetery' ? 'Cemitério' : 'Remover';
        addEventLog('REMOVE_CARD', `${actionName}: ${card.name}`, card.id, card.name, {
          zone: card.zone,
          ownerId: card.ownerId,
          action,
        });
        removeCard(card.id);
      }
    }
    
    setContextMenu(null);
    setContextSubmenu(null);
  };
  
  // Fechar menu ao clicar fora
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu) {
        setContextMenu(null);
        setContextSubmenu(null);
      }
    };
    
    if (contextMenu) {
      window.addEventListener('click', handleClickOutside);
      return () => {
        window.removeEventListener('click', handleClickOutside);
      };
    }
  }, [contextMenu]);

  const startLibraryDrag = (targetPlayerId: string, event: ReactPointerEvent) => {
    if (targetPlayerId !== playerId) return;
    if ((event.target as HTMLElement).closest('button')) return;
    // Não iniciar drag com botão direito (button 2)
    if (event.button === 2) return;
    event.preventDefault();
    if (!boardRef.current) return;

    // Resetar flags ao iniciar novo drag
    libraryClickExecutedRef.current = false;
    libraryMovedRef.current = false;

    const rect = boardRef.current.getBoundingClientRect();
    const libraryPos = getLibraryPosition(targetPlayerId);
    if (!libraryPos) return;

    // Converter coordenadas do mouse baseado no modo
    let cursorX, cursorY;
    if (viewMode === 'separated') {
      // Modo separated: usar função auxiliar específica
      const coords = convertMouseToSeparatedCoordinates(
        event.clientX,
        event.clientY,
        targetPlayerId,
        rect
      );
      if (!coords) {
        // Se não está na janela do player correto, usar posição atual da library
        cursorX = libraryPos.x;
        cursorY = libraryPos.y;
      } else {
        cursorX = coords.x;
        cursorY = coords.y;
      }
    } else {
      // Modo individual/unified: usar função auxiliar específica
      const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
      cursorX = coords.x;
      cursorY = coords.y;
    }

    const offsetX = cursorX - libraryPos.x;
    const offsetY = cursorY - libraryPos.y;

    setLibraryMoved(false);
    setDraggingLibrary({
      playerId: targetPlayerId,
      offsetX,
      offsetY,
      startX: event.clientX,
      startY: event.clientY,
    });
  };

  const libraryDragUpdateRef = useRef<number>(0);

  useEffect(() => {
    if (!draggingLibrary || !boardRef.current) {
      if (libraryMoved) {
        setLibraryMoved(false);
      }
      return;
    }

    const handleMove = (event: PointerEvent) => {
      const now = Date.now();
      if (now - libraryDragUpdateRef.current < THROTTLE_MS) return;
      libraryDragUpdateRef.current = now;

      const deltaX = Math.abs(event.clientX - draggingLibrary.startX);
      const deltaY = Math.abs(event.clientY - draggingLibrary.startY);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        setLibraryMoved(true);
        libraryMovedRef.current = true; // Usar ref para garantir que está atualizado
        // Garantir que a flag seja setada imediatamente para evitar draw
        libraryClickExecutedRef.current = true;
      }

      const rect = boardRef.current!.getBoundingClientRect();
      let cursorX = event.clientX - rect.left;
      let cursorY = event.clientY - rect.top;
      
      // Log: mouse real
      const realMouseX = event.clientX;
      const realMouseY = event.clientY;
      const relativeMouseX = cursorX;
      const relativeMouseY = cursorY;
      
      // Converter coordenadas do mouse baseado no modo
      if (viewMode === 'separated') {
        // Modo separated: usar função auxiliar específica
        const coords = convertMouseToSeparatedCoordinates(
          event.clientX,
          event.clientY,
          draggingLibrary.playerId,
          rect
        );
        if (!coords) {
          // Se não está na janela do player correto, manter posição atual
          return;
        }
        cursorX = coords.x;
        cursorY = coords.y;
      } else {
        // Modo individual/unified: usar função auxiliar específica
        const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
        cursorX = coords.x;
        cursorY = coords.y;
      }
      
      const x = cursorX - draggingLibrary.offsetX;
      const y = cursorY - draggingLibrary.offsetY;

      // Clamp dentro da área
      const playerArea = getPlayerArea(draggingLibrary.playerId);
      let clampedX = x;
      let clampedY = y;
      
      if (playerArea) {
        clampedX = Math.max(
          playerArea.x,
          Math.min(playerArea.x + playerArea.width - LIBRARY_CARD_WIDTH, x)
        );
        clampedY = Math.max(
          playerArea.y,
          Math.min(playerArea.y + playerArea.height - LIBRARY_CARD_HEIGHT, y)
        );
      }
      
      // Atualizar posição
      if (playerArea) {
        const relativePosition = {
          x: clampedX - playerArea.x,
          y: clampedY - playerArea.y,
        };
        
        setLibraryPositions((prev) => ({
          ...prev,
          [draggingLibrary.playerId]: relativePosition,
        }));

        moveLibrary(draggingLibrary.playerId, relativePosition, { x: clampedX, y: clampedY });
      }
    };

    const stopDrag = (event?: PointerEvent) => {
      // CRÍTICO: Só fazer draw se NÃO moveu (foi apenas um clique)
      // Usar tanto o estado quanto a ref para garantir que detecta movimento
      const actuallyMoved = libraryMoved || libraryMovedRef.current;
      
      // Log movimento do library se realmente moveu
      if (actuallyMoved) {
        const player = allPlayers.find(p => p.id === draggingLibrary.playerId);
        const playerName = player?.name || draggingLibrary.playerId;
        addEventLog('MOVE_LIBRARY', `Movendo library: ${playerName}`, undefined, undefined, {
          playerId: draggingLibrary.playerId,
          playerName,
          position: libraryPositions[draggingLibrary.playerId],
        });
      }
      
      // Só fazer draw se NÃO moveu e não foi um clique executado anteriormente
      if (!actuallyMoved && !libraryClickExecutedRef.current && event && event.button !== 2 && !contextMenu) {
        const target = event.target as HTMLElement;
        const isInteractive = target.closest('button, .library-count');
        const isLibraryStack = target.closest('.library-stack');
        
        // Só fazer draw se:
        // - Clicou diretamente no library-stack
        // - Não foi em elementos interativos
        // - O draggingLibrary está setado (garantir que iniciou o drag no library)
        // - NÃO moveu (verificado com estado e ref)
        if (isLibraryStack && !isInteractive && draggingLibrary) {
          libraryClickExecutedRef.current = true;
          handleLibraryClick(draggingLibrary.playerId);
          // Resetar flag após um pequeno delay
          setTimeout(() => {
            libraryClickExecutedRef.current = false;
          }, 100);
        }
      }
      
      setDraggingLibrary(null);
      setLibraryMoved(false);
      libraryMovedRef.current = false;
    };

    const handleUp = (e: PointerEvent) => stopDrag(e);
    
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [draggingLibrary, moveLibrary, playerId, libraryMoved, viewMode, players]);

  // Sistema de drag para cemitério
  const startCemeteryDrag = (targetPlayerId: string, event: ReactPointerEvent) => {
    console.log('[Board] startCemeteryDrag chamado', { targetPlayerId, currentPlayerId: playerId, matches: targetPlayerId === playerId });
    
    if ((event.target as HTMLElement).closest('button')) {
      console.log('[Board] Bloqueado - botão');
      return;
    }
    // Não iniciar drag com botão direito (button 2)
    if (event.button === 2) {
      console.log('[Board] Bloqueado - botão direito');
      return;
    }
    // A verificação de permissão já é feita no componente Cemetery
    event.preventDefault();
    if (!boardRef.current) {
      console.log('[Board] Bloqueado - sem boardRef');
      return;
    }

    // Resetar flags ao iniciar novo drag
    cemeteryMovedRef.current = false;

    const rect = boardRef.current.getBoundingClientRect();
    let cemeteryPos = getCemeteryPosition(targetPlayerId);
    
    // Se não encontrou posição, calcular uma posição padrão
    if (!cemeteryPos) {
      const CEMETERY_CARD_WIDTH = 100;
      const CEMETERY_CARD_HEIGHT = 140;
      const playerIndex = allPlayers.findIndex((p) => p.id === targetPlayerId);
      const offsetX = playerIndex * (CEMETERY_CARD_WIDTH + 20);
      cemeteryPos = {
        x: rect.width / 2 - CEMETERY_CARD_WIDTH / 2 + offsetX,
        y: rect.height / 2 - CEMETERY_CARD_HEIGHT / 2,
      };
    }

    // Converter coordenadas do mouse baseado no modo
    let cursorX, cursorY;
    if (viewMode === 'separated') {
      // Modo separated: usar função auxiliar específica
      const coords = convertMouseToSeparatedCoordinates(
        event.clientX,
        event.clientY,
        targetPlayerId,
        rect
      );
      if (!coords) {
        // Se não está na janela do player correto, usar posição atual do cemetery
        cursorX = cemeteryPos.x;
        cursorY = cemeteryPos.y;
      } else {
        cursorX = coords.x;
        cursorY = coords.y;
      }
    } else {
      // Modo individual/unified: usar função auxiliar específica
      const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
      cursorX = coords.x;
      cursorY = coords.y;
    }
    
    // Ambos estão em pixels
    const offsetX = cursorX - cemeteryPos.x;
    const offsetY = cursorY - cemeteryPos.y;

    setCemeteryMoved(false);
    setDraggingCemetery({
      playerId: targetPlayerId,
      offsetX,
      offsetY,
      startX: event.clientX,
      startY: event.clientY,
    });
  };

  const cemeteryDragUpdateRef = useRef<number>(0);

  useEffect(() => {
    if (!draggingCemetery || !boardRef.current) {
      if (cemeteryMoved) {
        setCemeteryMoved(false);
      }
      return;
    }

    const handleMove = (event: PointerEvent) => {
      const now = Date.now();
      if (now - cemeteryDragUpdateRef.current < THROTTLE_MS) return;
      cemeteryDragUpdateRef.current = now;

      const deltaX = Math.abs(event.clientX - draggingCemetery.startX);
      const deltaY = Math.abs(event.clientY - draggingCemetery.startY);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        setCemeteryMoved(true);
        cemeteryMovedRef.current = true;
      }

      const rect = boardRef.current!.getBoundingClientRect();
      let cursorX = event.clientX - rect.left;
      let cursorY = event.clientY - rect.top;
      
      // Log: mouse real
      const realMouseX = event.clientX;
      const realMouseY = event.clientY;
      const relativeMouseX = cursorX;
      const relativeMouseY = cursorY;
      
      // Converter coordenadas do mouse baseado no modo
      if (viewMode === 'separated') {
        // Modo separated: usar função auxiliar específica
        const coords = convertMouseToSeparatedCoordinates(
          event.clientX,
          event.clientY,
          draggingCemetery.playerId,
          rect
        );
        if (!coords) {
          // Se não está na janela do player correto, manter posição atual
          return;
        }
        cursorX = coords.x;
        cursorY = coords.y;
      } else {
        // Modo individual/unified: usar função auxiliar específica
        const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
        cursorX = coords.x;
        cursorY = coords.y;
      }
      
      const x = cursorX - draggingCemetery.offsetX;
      const y = cursorY - draggingCemetery.offsetY;

      // Clamp dentro da área - se estiver fora, limitar aos limites
      const CEMETERY_CARD_WIDTH = 100;
      const CEMETERY_CARD_HEIGHT = 140;
      const playerArea = getPlayerArea(draggingCemetery.playerId);
      const maxX = playerArea ? playerArea.x + playerArea.width - CEMETERY_CARD_WIDTH : rect.width - CEMETERY_CARD_WIDTH;
      const maxY = playerArea ? playerArea.y + playerArea.height - CEMETERY_CARD_HEIGHT : rect.height - CEMETERY_CARD_HEIGHT;
      const minX = playerArea ? playerArea.x : 0;
      const minY = playerArea ? playerArea.y : 0;
      
      const clampedX = Math.max(minX, Math.min(maxX, x));
      const clampedY = Math.max(minY, Math.min(maxY, y));

      // Atualizar posição local imediatamente para feedback visual
      setCemeteryPositions((prev) => ({
        ...prev,
        [draggingCemetery.playerId]: { x: clampedX, y: clampedY },
      }));

      // Sincronizar com os peers - isso vai atualizar o store e enviar para outros players
      moveCemetery(draggingCemetery.playerId, { x: clampedX, y: clampedY });
    };

    const stopDrag = () => {
      // Log movimento do cemetery se realmente moveu
      if (cemeteryMovedRef.current) {
        const player = players.find(p => p.id === draggingCemetery.playerId);
        const playerName = player?.name || draggingCemetery.playerId;
        addEventLog('MOVE_CEMETERY', `Movendo cemetery: ${playerName}`, undefined, undefined, {
          playerId: draggingCemetery.playerId,
          playerName,
          position: cemeteryPositions[draggingCemetery.playerId],
        });
      }
      setDraggingCemetery(null);
      setCemeteryMoved(false);
      cemeteryMovedRef.current = false;
      setTimeout(() => setCemeteryMoved(false), 100);
    };

    const handleUp = () => stopDrag();
    
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [draggingCemetery, moveCemetery, playerId, cemeteryMoved, viewMode, players, getPlayerArea]);

  // Rastrear posição do mouse para debug
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!boardRef.current) return;
      const rect = boardRef.current.getBoundingClientRect();
      setMousePosition({
        x: event.clientX,
        y: event.clientY,
        boardX: event.clientX - rect.left,
        boardY: event.clientY - rect.top,
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  // Função para renderizar o conteúdo do board baseado no modo de visualização
  const renderBoardContent = () => {
    const boardViewProps: BoardViewProps = {
      boardRef,
      board,
      allPlayers,
      playerId,
      battlefieldCards,
      libraryCards,
      cemeteryCards,
      storeLibraryPositions,
      storeCemeteryPositions,
      showHand,
      dragStateRef,
      draggingLibrary,
      draggingCemetery,
      ownerName,
      handleCardClick,
      handleCardContextMenu,
      startDrag,
      startLibraryDrag,
      startCemeteryDrag,
      changeCardZone,
      detectZoneAtPosition,
      reorderHandCard,
      dragStartedFromHandRef,
      handCardPlacedRef,
      setContextMenu,
      setLastTouchedCard,
      getPlayerArea,
      getLibraryPosition,
      getCemeteryPosition,
      handDragStateRef,
      addEventLog,
      viewMode,
      convertMouseToSeparatedCoordinates,
      convertMouseToUnifiedCoordinates,
    };

    if (viewMode === 'individual') {
      return <BoardIndividual {...boardViewProps} selectedPlayerIndex={selectedPlayerIndex} />;
    } else if (viewMode === 'separated') {
      return <BoardSeparated {...boardViewProps} />;
    } else {
      return <BoardUnified {...boardViewProps} />;
    }
  };

  return (
    <div className="board-container">
      {/* Painel flutuante com status e controles */}
      <div
        style={{
          position: 'fixed',
          top: '16px',
          right: '16px',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          alignItems: 'flex-end',
        }}
      >
        {/* Status */}
        <div
          style={{
            padding: '0.4rem 0.8rem',
            borderRadius: '999px',
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            color: '#86efac',
            fontSize: '12px',
            fontWeight: '500',
          }}
        >
          Status: {status}
        </div>
        
        {/* Controles */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '8px',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(148, 163, 184, 0.3)',
            borderRadius: '8px',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}
        >
          {/* Controles de modo de visualização */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <button
              onClick={() => setViewMode('unified')}
              style={{
                padding: '6px 12px',
                backgroundColor: viewMode === 'unified' ? '#6366f1' : '#475569',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
              title="Todos os boards juntos"
            >
              🎯 Unificado
            </button>
            <button
              onClick={() => {
                setViewMode('individual');
                // Começar com o player atual
                const currentIndex = players.findIndex(p => p.id === playerId);
                setSelectedPlayerIndex(currentIndex >= 0 ? currentIndex : 0);
              }}
              style={{
                padding: '6px 12px',
                backgroundColor: viewMode === 'individual' ? '#6366f1' : '#475569',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
              title="Ver um player por vez"
            >
              👤 Individual
            </button>
            <button
              onClick={() => setViewMode('separated')}
              style={{
                padding: '6px 12px',
                backgroundColor: viewMode === 'separated' ? '#6366f1' : '#475569',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
              title="Boards separados"
            >
              📑 Separado
            </button>
          </div>
          
          {/* Navegação entre players (modo individual) */}
          {viewMode === 'individual' && allPlayers.length > 1 && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'center' }}>
              <button
                onClick={() => {
                  setSelectedPlayerIndex((prev) => (prev - 1 + allPlayers.length) % allPlayers.length);
                }}
                style={{
                  padding: '6px 10px',
                  backgroundColor: '#475569',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
                title="Player anterior"
              >
                ←
              </button>
              <span style={{ fontSize: '12px', color: '#fff', minWidth: '80px', textAlign: 'center' }}>
                {allPlayers[selectedPlayerIndex]?.name || 'N/A'}
              </span>
              <button
                onClick={() => {
                  setSelectedPlayerIndex((prev) => (prev + 1) % allPlayers.length);
                }}
                style={{
                  padding: '6px 10px',
                  backgroundColor: '#475569',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
                title="Próximo player"
              >
                →
              </button>
            </div>
          )}
          
          {/* Outros controles */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <button
              onClick={() => setShowDebugMode(!showDebugMode)}
              style={{
                padding: '6px 12px',
                backgroundColor: showDebugMode ? '#10b981' : '#475569',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              {showDebugMode ? '🔍 Debug ON' : '🔍 Debug OFF'}
            </button>
            <button
              onClick={() => {
                setShowHand(!showHand);
                setHandButtonEnabled(true);
              }}
              disabled={!handButtonEnabled && !showHand}
              style={{
                padding: '6px 12px',
                backgroundColor: showHand ? '#ef4444' : '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: (!handButtonEnabled && !showHand) ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                opacity: (!handButtonEnabled && !showHand) ? 0.5 : 1,
              }}
            >
              {showHand ? 'Esconder Hand' : 'Mostrar Hand'}
            </button>
          </div>
          
          {/* Controle de simulação de players */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button
              onClick={() => setShowSimulatePanel(!showSimulatePanel)}
              style={{
                padding: '6px 12px',
                backgroundColor: simulatePlayers > 0 ? '#10b981' : '#475569',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
              title="Simular múltiplos players"
            >
              {simulatePlayers > 0 ? `👥 Simular: ${simulatePlayers}` : '👥 Simular Players'}
            </button>
            {showSimulatePanel && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px', backgroundColor: 'rgba(0, 0, 0, 0.3)', borderRadius: '4px' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>Quantos players simular?</div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {[0, 1, 2, 3, 4, 5, 6].map((num) => (
                    <button
                      key={num}
                      onClick={() => {
                        setSimulatePlayers(num);
                        if (num === 0) setShowSimulatePanel(false);
                      }}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: simulatePlayers === num ? '#6366f1' : '#475569',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        minWidth: '32px',
                      }}
                    >
                      {num === 0 ? 'Off' : num}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div 
        className="board-surface" 
        ref={boardRef}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          const isInteractive = target.closest(
            `.card-token, button, .library-stack, .cemetery-stack, .player-area${showHand ? ', .hand-card-wrapper, .hand-area, .hand-cards' : ''}`
          );
          
          // Não resetar se estiver arrastando cemitério ou library
          if (!isInteractive && !draggingCemetery && !draggingLibrary) {
            resetAllDragStates();
          }
        }}
      >
        {/* Container escalado baseado em 1080p */}
        {boardRef.current && (() => {
          const rect = boardRef.current!.getBoundingClientRect();
          const scale = getBoardScale();
          const scaledWidth = BASE_BOARD_WIDTH * scale;
          const scaledHeight = BASE_BOARD_HEIGHT * scale;
          const offsetX = (rect.width - scaledWidth) / 2;
          const offsetY = (rect.height - scaledHeight) / 2;
          
          return (
            <div
              style={{
                position: 'absolute',
                left: `${offsetX}px`,
                top: `${offsetY}px`,
                width: `${BASE_BOARD_WIDTH}px`,
                height: `${BASE_BOARD_HEIGHT}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
            >
              {renderBoardContent()}
            </div>
          );
        })()}
        
        {/* Painel de Log de Eventos - Só mostra se debug mode estiver ativo */}
        {showDebugMode && (
          <div
            style={{
              position: 'fixed',
              bottom: '20px',
              left: '20px',
              width: '400px',
              maxHeight: '400px',
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              color: '#fff',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '11px',
              fontFamily: 'monospace',
              zIndex: 9999,
              overflow: 'auto',
              border: '1px solid #555',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
            }}
          >
          <div style={{ marginBottom: '8px', fontWeight: 'bold', borderBottom: '1px solid #555', paddingBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
            <span>📋 Event Log ({eventLogs.length}){isRecording && <span style={{ color: '#ef4444', marginLeft: '8px', animation: 'pulse 1s infinite' }}>● REC</span>}</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => setEventLogMinimized(!eventLogMinimized)}
                style={{
                  background: 'rgba(100, 100, 100, 0.3)',
                  border: '1px solid #666',
                  color: '#fff',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '10px',
                }}
                title={eventLogMinimized ? 'Expandir' : 'Minimizar'}
              >
                {eventLogMinimized ? '⬆️' : '⬇️'}
              </button>
              <button
                data-record-button
                onClick={toggleRecording}
                style={{
                  background: isRecording ? 'rgba(239, 68, 68, 0.5)' : 'rgba(100, 100, 100, 0.3)',
                  border: `1px solid ${isRecording ? '#ef4444' : '#666'}`,
                  color: '#fff',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '10px',
                  fontWeight: isRecording ? 'bold' : 'normal',
                }}
              >
                {isRecording ? '⏹️ Parar' : '🔴 Gravar'}
              </button>
              <button
                data-copy-logs-button
                onClick={copyEventLogs}
                disabled={eventLogs.length === 0}
                style={{
                  background: eventLogs.length === 0 ? 'rgba(100, 100, 100, 0.3)' : 'rgba(59, 130, 246, 0.3)',
                  border: `1px solid ${eventLogs.length === 0 ? '#666' : '#3b82f6'}`,
                  color: '#fff',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  cursor: eventLogs.length === 0 ? 'not-allowed' : 'pointer',
                  fontSize: '10px',
                  opacity: eventLogs.length === 0 ? 0.5 : 1,
                }}
              >
                📋 Copiar
              </button>
              <button
                onClick={() => {
                  setEventLogs([]);
                  if (isRecording) {
                    setIsRecording(false);
                    setRecordedEvents([]);
                  }
                }}
                style={{
                  background: 'rgba(239, 68, 68, 0.3)',
                  border: '1px solid #ef4444',
                  color: '#fff',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '10px',
                }}
              >
                Limpar
              </button>
            </div>
          </div>
          {!eventLogMinimized && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {eventLogs.length === 0 ? (
              <div style={{ opacity: 0.5, fontStyle: 'italic' }}>Nenhum evento ainda...</div>
            ) : (
              eventLogs.map((log) => {
                const time = new Date(log.timestamp);
                const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}.${time.getMilliseconds().toString().padStart(3, '0')}`;
                const typeColors: Record<string, string> = {
                  CLICK: '#60a5fa',
                  DRAG_START: '#fbbf24',
                  DRAG_END: '#f59e0b',
                  MOVE_CARD: '#34d399',
                  CHANGE_ZONE: '#a78bfa',
                  TOGGLE_TAP: '#fb7185',
                  REMOVE_CARD: '#ef4444',
                  REORDER_HAND: '#22d3ee',
                  CONTEXT_MENU: '#f472b6',
                  DRAW_FROM_LIBRARY: '#818cf8',
                };
                const color = typeColors[log.type] || '#94a3b8';
                
                return (
                  <div
                    key={log.id}
                    style={{
                      padding: '6px',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      borderRadius: '4px',
                      borderLeft: `3px solid ${color}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <span style={{ color, fontWeight: 'bold' }}>{log.type}</span>
                      <span style={{ opacity: 0.6, fontSize: '9px' }}>{timeStr}</span>
                    </div>
                    <div style={{ fontSize: '10px', marginBottom: '2px' }}>{log.message}</div>
                    {log.cardName && (
                      <div style={{ fontSize: '9px', opacity: 0.7, marginTop: '2px' }}>
                        Carta: {log.cardName} {log.cardId && `(${log.cardId.slice(0, 8)}...)`}
                      </div>
                    )}
                    {log.details && Object.keys(log.details).length > 0 && (
                      <details style={{ marginTop: '4px', fontSize: '9px', opacity: 0.8 }}>
                        <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Detalhes</summary>
                        <pre style={{ marginTop: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })
            )}
          </div>
          )}
          </div>
        )}

        {/* Painel de Debug de Peer - Só mostra se debug mode estiver ativo */}
        {showDebugMode && (
          <div
            style={{
              position: 'fixed',
              bottom: '20px',
              right: '20px',
              width: '400px',
              maxHeight: '500px',
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              color: '#fff',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '11px',
              fontFamily: 'monospace',
              zIndex: 9999,
              overflow: 'auto',
              border: '1px solid #555',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ marginBottom: '8px', fontWeight: 'bold', borderBottom: '1px solid #555', paddingBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span>🔌 Peer Debug</span>
              <button
                onClick={() => setPeerDebugMinimized(!peerDebugMinimized)}
                style={{
                  background: 'rgba(100, 100, 100, 0.3)',
                  border: '1px solid #666',
                  color: '#fff',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '10px',
                }}
                title={peerDebugMinimized ? 'Expandir' : 'Minimizar'}
              >
                {peerDebugMinimized ? '⬆️' : '⬇️'}
              </button>
            </div>
            {!peerDebugMinimized && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Status geral */}
              <div style={{ padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Status Geral</div>
                <div style={{ fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div>Status: <span style={{ color: status === 'playing' ? '#10b981' : status === 'waiting' ? '#f59e0b' : '#ef4444' }}>{status}</span></div>
                  <div>É Host: <span style={{ color: isHost ? '#10b981' : '#94a3b8' }}>{isHost ? 'Sim' : 'Não'}</span></div>
                  <div>Room ID: <span style={{ opacity: 0.7 }}>{roomId || 'N/A'}</span></div>
                  <div>Player ID: <span style={{ opacity: 0.7 }}>{playerId.slice(0, 8)}...</span></div>
                </div>
              </div>

              {/* Peer Instance */}
              <div style={{ padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Peer Instance</div>
                <div style={{ fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {peer ? (
                    <>
                      <div>ID: <span style={{ opacity: 0.7 }}>{peer.id || 'N/A'}</span></div>
                      <div>Open: <span style={{ color: peer.open ? '#10b981' : '#ef4444' }}>{peer.open ? 'Sim' : 'Não'}</span></div>
                      <div>Destroyed: <span style={{ color: peer.destroyed ? '#ef4444' : '#10b981' }}>{peer.destroyed ? 'Sim' : 'Não'}</span></div>
                      <div>Disconnected: <span style={{ color: peer.disconnected ? '#ef4444' : '#10b981' }}>{peer.disconnected ? 'Sim' : 'Não'}</span></div>
                    </>
                  ) : (
                    <div style={{ opacity: 0.5, fontStyle: 'italic' }}>Nenhum peer ativo</div>
                  )}
                </div>
              </div>

              {/* Host Connection */}
              {hostConnection && (
                <div style={{ padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Host Connection</div>
                  <div style={{ fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div>Peer: <span style={{ opacity: 0.7 }}>{hostConnection.peer || 'N/A'}</span></div>
                    <div>Open: <span style={{ color: hostConnection.open ? '#10b981' : '#ef4444' }}>{hostConnection.open ? 'Sim' : 'Não'}</span></div>
                    <div>Label: <span style={{ opacity: 0.7 }}>{hostConnection.label || 'N/A'}</span></div>
                    <div>Metadata: <span style={{ opacity: 0.7 }}>{hostConnection.metadata ? JSON.stringify(hostConnection.metadata).slice(0, 50) + '...' : 'N/A'}</span></div>
                  </div>
                </div>
              )}

              {/* Client Connections */}
              <div style={{ padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                  Client Connections ({Object.keys(connections).length})
                </div>
                <div style={{ fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {Object.keys(connections).length === 0 ? (
                    <div style={{ opacity: 0.5, fontStyle: 'italic' }}>Nenhuma conexão de cliente</div>
                  ) : (
                    Object.entries(connections).map(([peerId, conn]) => (
                      <div key={peerId} style={{ padding: '6px', backgroundColor: 'rgba(0, 0, 0, 0.3)', borderRadius: '4px', borderLeft: `3px solid ${conn.open ? '#10b981' : '#ef4444'}` }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>Peer: {peerId.slice(0, 8)}...</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '9px', opacity: 0.8 }}>
                          <div>Open: <span style={{ color: conn.open ? '#10b981' : '#ef4444' }}>{conn.open ? 'Sim' : 'Não'}</span></div>
                          <div>Label: <span style={{ opacity: 0.7 }}>{conn.label || 'N/A'}</span></div>
                          {conn.metadata && (
                            <div>Metadata: <span style={{ opacity: 0.7 }}>{JSON.stringify(conn.metadata).slice(0, 40) + '...'}</span></div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Players */}
              <div style={{ padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                  Players ({players.length})
                </div>
                <div style={{ fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {players.length === 0 ? (
                    <div style={{ opacity: 0.5, fontStyle: 'italic' }}>Nenhum jogador</div>
                  ) : (
                    players.map((player) => (
                      <div key={player.id} style={{ padding: '4px', backgroundColor: 'rgba(0, 0, 0, 0.3)', borderRadius: '4px' }}>
                        <div>
                          <span style={{ fontWeight: 'bold' }}>{player.name}</span>
                          {player.id === playerId && <span style={{ marginLeft: '4px', color: '#10b981' }}>(Você)</span>}
                        </div>
                        <div style={{ fontSize: '9px', opacity: 0.7 }}>ID: {player.id.slice(0, 8)}...</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Peer Event Logs */}
              <div style={{ padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                  Eventos de Peer ({peerEventLogs.length})
                </div>
                <div style={{ fontSize: '9px', display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '200px', overflowY: 'auto' }}>
                  {peerEventLogs.length === 0 ? (
                    <div style={{ opacity: 0.5, fontStyle: 'italic' }}>Nenhum evento ainda</div>
                  ) : (
                    peerEventLogs.map((log) => {
                      const time = new Date(log.timestamp).toLocaleTimeString();
                      const typeColor = log.type === 'SENT' ? '#10b981' : '#3b82f6';
                      const directionColor = 
                        log.direction === 'TO_HOST' ? '#f59e0b' :
                        log.direction === 'TO_PEERS' ? '#10b981' :
                        log.direction === 'FROM_HOST' ? '#3b82f6' : '#8b5cf6';
                      
                      return (
                        <div key={log.id} style={{ 
                          padding: '4px 6px', 
                          backgroundColor: 'rgba(0, 0, 0, 0.3)', 
                          borderRadius: '4px',
                          borderLeft: `3px solid ${typeColor}`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                            <span style={{ fontWeight: 'bold', color: typeColor }}>{log.type}</span>
                            <span style={{ opacity: 0.6, fontSize: '8px' }}>{time}</span>
                          </div>
                            <div style={{ fontSize: '8px', opacity: 0.8 }}>
                            <div>
                              <span style={{ color: directionColor }}>{log.direction}</span>
                              {' → '}
                              <span style={{ fontWeight: 'bold' }}>{log.messageType}</span>
                              {log.actionKind && (
                                <span style={{ marginLeft: '4px', opacity: 0.7 }}>({log.actionKind})</span>
                              )}
                            </div>
                            {log.target && (
                              <div style={{ opacity: 0.7, marginTop: '2px' }}>
                                Para: {log.target}
                              </div>
                            )}
                            {log.details && (
                              <div style={{ opacity: 0.7, marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '7px' }}>
                                {log.details.boardSize !== undefined && (
                                  <div>Board: {log.details.boardSize} cartas</div>
                                )}
                                {log.details.cardsByZone && (
                                  <div style={{ marginLeft: '4px' }}>
                                    {Object.entries(log.details.cardsByZone as Record<string, number>).map(([zone, count]) => (
                                      <span key={zone} style={{ marginRight: '6px' }}>
                                        {zone}: {count}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {log.details.playersCount !== undefined && (
                                  <div>Players: {log.details.playersCount} ({Array.isArray(log.details.playerNames) ? (log.details.playerNames as string[]).join(', ') : ''})</div>
                                )}
                                {log.details.cardName && (
                                  <div>Carta: {log.details.cardName as string}</div>
                                )}
                                {log.details.cardId && (
                                  <div>Card ID: {(log.details.cardId as string).slice(0, 8)}...</div>
                                )}
                                {log.details.position && (
                                  <div>Pos: ({Math.round((log.details.position as any).x)}, {Math.round((log.details.position as any).y)})</div>
                                )}
                                {log.details.zone && (
                                  <div>Zone: {log.details.zone as string}</div>
                                )}
                                {log.details.cardsCount !== undefined && (
                                  <div>Cards: {log.details.cardsCount as number}</div>
                                )}
                                {log.details.targetPlayerId && (
                                  <div>Player: {(log.details.targetPlayerId as string).slice(0, 8)}...</div>
                                )}
                                {Array.isArray(log.details.peerIds) && log.details.peerIds.length > 0 && (
                                  <div>Peers: {log.details.peerIds.length} ({log.details.peerIds.slice(0, 2).map((id: string) => id.slice(0, 6)).join(', ')}{log.details.peerIds.length > 2 ? '...' : ''})</div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
            )}
          </div>
        )}
        
        {/* Debug info que segue o mouse - Só mostra se debug mode estiver ativo */}
        {showDebugMode && mousePosition && boardRef.current && (() => {
          const rect = boardRef.current!.getBoundingClientRect();
          const isMouseOverBoard = 
            mousePosition.x >= rect.left && 
            mousePosition.x <= rect.right &&
            mousePosition.y >= rect.top && 
            mousePosition.y <= rect.bottom;
          
          if (!isMouseOverBoard) return null;
          
          return (
            <div
              style={{
                position: 'fixed',
                left: `${mousePosition.x + 15}px`,
                top: `${mousePosition.y + 15}px`,
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                color: '#fff',
                padding: '12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontFamily: 'monospace',
                pointerEvents: 'none',
                zIndex: 10000,
                maxWidth: '400px',
                maxHeight: '500px',
                overflow: 'auto',
                border: '1px solid #555',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
              }}
            >
            <div style={{ marginBottom: '8px', fontWeight: 'bold', borderBottom: '1px solid #555', paddingBottom: '4px' }}>
              🐭 Mouse Debug
            </div>
            
            <div style={{ marginBottom: '8px' }}>
              <div><strong>Posição:</strong></div>
              <div style={{ marginLeft: '8px' }}>
                Screen: ({mousePosition.x}, {mousePosition.y})
              </div>
              <div style={{ marginLeft: '8px' }}>
                Board: ({Math.round(mousePosition.boardX)}, {Math.round(mousePosition.boardY)})
              </div>
            </div>
            
            {lastTouchedCard && (
              <div style={{ marginBottom: '8px', borderTop: '1px solid #555', paddingTop: '8px' }}>
                <div><strong>📇 Última Carta Tocada:</strong></div>
                <div style={{ marginLeft: '8px', marginTop: '4px' }}>
                  <div>ID: {lastTouchedCard.id}</div>
                  <div>Nome: {lastTouchedCard.name}</div>
                  <div>Zona: {lastTouchedCard.zone}</div>
                  <div>Owner: {lastTouchedCard.ownerId}</div>
                  <div>Posição: ({Math.round(lastTouchedCard.position.x)}, {Math.round(lastTouchedCard.position.y)})</div>
                  <div>Tapped: {lastTouchedCard.tapped ? 'Sim' : 'Não'}</div>
                  {lastTouchedCard.handIndex !== undefined && (
                    <div>Hand Index: {lastTouchedCard.handIndex}</div>
                  )}
                  {lastTouchedCard.stackIndex !== undefined && (
                    <div>Stack Index: {lastTouchedCard.stackIndex}</div>
                  )}
                </div>
              </div>
            )}
            
            {/* Estado de Drag */}
            <div style={{ marginBottom: '8px', borderTop: '1px solid #555', paddingTop: '8px' }}>
              <div><strong>🖱️ Estado de Drag:</strong></div>
              <div style={{ marginLeft: '8px', marginTop: '4px' }}>
                <div>Board Drag Ativo: {isDragging ? '✅ Sim' : '❌ Não'}</div>
                {dragStateRef.current && (
                  <>
                    <div style={{ marginTop: '4px', paddingLeft: '8px', borderLeft: '2px solid #555' }}>
                      <div><strong>Board Drag:</strong></div>
                      <div>Carta ID: {dragStateRef.current.cardId}</div>
                      <div>Moveu: {dragStateRef.current.hasMoved ? '✅ Sim' : '❌ Não'}</div>
                      <div>Offset: ({Math.round(dragStateRef.current.offsetX)}, {Math.round(dragStateRef.current.offsetY)})</div>
                      <div>Start: ({Math.round(dragStateRef.current.startX)}, {Math.round(dragStateRef.current.startY)})</div>
                    </div>
                  </>
                )}
                <div style={{ marginTop: '4px' }}>
                  Veio da Hand: {dragStartedFromHandRef.current ? '✅ Sim' : '❌ Não'}
                </div>
                <div>
                  Hand Card Placed: {handCardPlacedRef.current ? '✅ Sim' : '❌ Não'}
                </div>
                {handDragStateRef.current.draggingHandCard && (
                  <div style={{ marginTop: '4px', paddingLeft: '8px', borderLeft: '2px solid #555', backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
                    <div><strong>Hand Drag:</strong></div>
                    <div>Carta ID: {handDragStateRef.current.draggingHandCard}</div>
                    <div>Moveu: {handDragStateRef.current.handCardMoved ? '✅ Sim' : '❌ Não'}</div>
                    {handDragStateRef.current.previewHandOrder !== null && (
                      <div>Preview Order: {handDragStateRef.current.previewHandOrder}</div>
                    )}
                    {handDragStateRef.current.dragPosition && (
                      <div>Posição: ({Math.round(handDragStateRef.current.dragPosition.x)}, {Math.round(handDragStateRef.current.dragPosition.y)})</div>
                    )}
                    {handDragStateRef.current.dragStartPosition && (
                      <div>Start: ({Math.round(handDragStateRef.current.dragStartPosition.x)}, {Math.round(handDragStateRef.current.dragStartPosition.y)})</div>
                    )}
                  </div>
                )}
                {clickBlockTimeoutRef.current && (
                  <div style={{ marginTop: '4px', paddingLeft: '8px', borderLeft: '2px solid #555' }}>
                    <div>Click Bloqueado: ✅ Sim</div>
                    <div>Carta: {clickBlockTimeoutRef.current.cardId}</div>
                  </div>
                )}
                {draggingLibrary && (
                  <div style={{ marginTop: '4px', paddingLeft: '8px', borderLeft: '2px solid #555' }}>
                    <div><strong>Library Drag:</strong></div>
                    <div>Player: {draggingLibrary.playerId}</div>
                    <div>Moveu: {libraryMoved ? '✅ Sim' : '❌ Não'}</div>
                  </div>
                )}
              </div>
            </div>
            
            <div style={{ marginBottom: '8px', borderTop: '1px solid #555', paddingTop: '8px' }}>
              <div><strong>⚔️ Battlefield:</strong></div>
              <div style={{ marginLeft: '8px', marginTop: '4px' }}>
                <div>Total: {battlefieldCards.length} cartas</div>
              </div>
            </div>
            
            <div style={{ borderTop: '1px solid #555', paddingTop: '8px' }}>
              <div><strong>🃏 Hand:</strong></div>
              <div style={{ marginLeft: '8px', marginTop: '4px' }}>
                <div>Total: {handCards.length} cartas</div>
                {playerId && (
                  <div>
                    Suas cartas: {handCards.filter(c => c.ownerId === playerId).length}
                  </div>
                )}
              </div>
            </div>
          </div>
          );
        })()}
        
        {/* Menu de Contexto */}
        {contextMenu && (
          <>
            <div
              style={{
                position: 'fixed',
                left: `${contextMenu.x}px`,
                top: `${contextMenu.y}px`,
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                borderRadius: '8px',
                padding: '4px',
                zIndex: 10001,
                minWidth: '180px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {contextMenu.card.ownerId === playerId && (
                <>
                  {/* Tap/Untap - apenas para battlefield */}
                  {contextMenu.card.zone === 'battlefield' && (
                    <button
                      onClick={() => handleContextMenuAction('tap')}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        textAlign: 'left',
                        background: 'transparent',
                        border: 'none',
                        color: '#f8fafc',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        fontSize: '14px',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      {contextMenu.card.tapped ? '↩️ Untap' : '↪️ Tap'}
                    </button>
                  )}
                  
                  {/* Draw - apenas para library */}
                  {contextMenu.card.zone === 'library' && (
                    <button
                      onClick={() => handleContextMenuAction('draw')}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        textAlign: 'left',
                        background: 'transparent',
                        border: 'none',
                        color: '#f8fafc',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        fontSize: '14px',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      🎴 Draw
                    </button>
                  )}
                  
                  {/* Shuffle - apenas para library */}
                  {contextMenu.card.zone === 'library' && (
                    <button
                      onClick={() => handleContextMenuAction('shuffle')}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        textAlign: 'left',
                        background: 'transparent',
                        border: 'none',
                        color: '#f8fafc',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        fontSize: '14px',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      🔀 Shuffle
                    </button>
                  )}
                  
                  {/* Move to - submenu */}
                  <div style={{ position: 'relative' }}>
                    <button
                      onMouseEnter={() => setContextSubmenu('moveZone')}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        textAlign: 'left',
                        background: 'transparent',
                        border: 'none',
                        color: '#f8fafc',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        fontSize: '14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>📍 Move to</span>
                      <span style={{ marginLeft: '8px' }}>▶</span>
                    </button>
                    
                    {/* Submenu de Mover de Zona */}
                    {contextSubmenu === 'moveZone' && (
                      <div
                        onMouseEnter={() => setContextSubmenu('moveZone')}
                        onMouseLeave={() => setContextSubmenu(null)}
                        style={{
                          position: 'absolute',
                          left: '100%',
                          top: '0',
                          marginLeft: '4px',
                          backgroundColor: 'rgba(15, 23, 42, 0.95)',
                          border: '1px solid rgba(148, 163, 184, 0.3)',
                          borderRadius: '8px',
                          padding: '4px',
                          minWidth: '180px',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                          zIndex: 10002,
                        }}
                      >
                        {contextMenu.card.zone !== 'hand' && (
                          <button
                            onClick={() => handleContextMenuAction('moveZone', 'hand')}
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              textAlign: 'left',
                              background: 'transparent',
                              border: 'none',
                              color: '#f8fafc',
                              cursor: 'pointer',
                              borderRadius: '4px',
                              fontSize: '14px',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                          >
                            🃏 Hand
                          </button>
                        )}
                        {contextMenu.card.zone !== 'battlefield' && (
                          <button
                            onClick={() => handleContextMenuAction('moveZone', 'battlefield')}
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              textAlign: 'left',
                              background: 'transparent',
                              border: 'none',
                              color: '#f8fafc',
                              cursor: 'pointer',
                              borderRadius: '4px',
                              fontSize: '14px',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                          >
                            ⚔️ Battlefield
                          </button>
                        )}
                        {contextMenu.card.zone !== 'library' && (
                          <div style={{ position: 'relative' }}>
                            <button
                              onMouseEnter={() => setContextSubmenuLibrary(true)}
                              style={{
                                width: '100%',
                                padding: '8px 12px',
                                textAlign: 'left',
                                background: 'transparent',
                                border: 'none',
                                color: '#f8fafc',
                                cursor: 'pointer',
                                borderRadius: '4px',
                                fontSize: '14px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                              onMouseLeave={(e) => {
                                // Não fechar se o mouse estiver no submenu
                                if (!e.relatedTarget || !(e.relatedTarget as HTMLElement).closest('.library-submenu')) {
                                  setContextSubmenuLibrary(false);
                                }
                              }}
                            >
                              <span>📚 Library</span>
                              <span style={{ marginLeft: '8px' }}>▶</span>
                            </button>
                            
                            {/* Submenu de Library */}
                            {contextSubmenuLibrary && (
                              <div
                                className="library-submenu"
                                onMouseEnter={() => setContextSubmenuLibrary(true)}
                                onMouseLeave={() => setContextSubmenuLibrary(false)}
                                style={{
                                  position: 'absolute',
                                  left: '100%',
                                  top: '0',
                                  marginLeft: '4px',
                                  backgroundColor: 'rgba(15, 23, 42, 0.95)',
                                  border: '1px solid rgba(148, 163, 184, 0.3)',
                                  borderRadius: '8px',
                                  padding: '4px',
                                  minWidth: '120px',
                                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                                  zIndex: 10003,
                                }}
                              >
                                <button
                                  onClick={() => handleContextMenuAction('libraryPlace', undefined, 'top')}
                                  style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    textAlign: 'left',
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#f8fafc',
                                    cursor: 'pointer',
                                    borderRadius: '4px',
                                    fontSize: '14px',
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                  }}
                                >
                                  ⬆️ Top
                                </button>
                                <button
                                  onClick={() => handleContextMenuAction('libraryPlace', undefined, 'random')}
                                  style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    textAlign: 'left',
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#f8fafc',
                                    cursor: 'pointer',
                                    borderRadius: '4px',
                                    fontSize: '14px',
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                  }}
                                >
                                  🎲 Random
                                </button>
                                <button
                                  onClick={() => handleContextMenuAction('libraryPlace', undefined, 'bottom')}
                                  style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    textAlign: 'left',
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#f8fafc',
                                    cursor: 'pointer',
                                    borderRadius: '4px',
                                    fontSize: '14px',
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                  }}
                                >
                                  ⬇️ Bottom
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        <button
                          onClick={() => handleContextMenuAction('moveZone', 'cemetery')}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            textAlign: 'left',
                            background: 'transparent',
                            border: 'none',
                            color: '#f8fafc',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            fontSize: '14px',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                        >
                          ⚰️ Cemitério
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {/* Separador */}
                  <div style={{ height: '1px', backgroundColor: 'rgba(148, 163, 184, 0.2)', margin: '4px 0' }} />
                  
                  {/* Remover */}
                  <button
                    onClick={() => handleContextMenuAction('remove')}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      color: '#f8fafc',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      fontSize: '14px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    🗑️ Remover
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Board;
