import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useGameStore } from '../store/useGameStore';
import { fetchCardPrints } from '../lib/scryfall';
import type { CardOnBoard, PlayerSummary } from '../store/useGameStore';
import CardToken from './CardToken';
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
const THROTTLE_MS = 0; // Sem throttling durante drag para evitar stutters - atualizações imediatas
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

const createShallowCachedSelector = <T,>(selector: (state: ReturnType<typeof useGameStore.getState>) => T) => {
  let lastResult: T | null = null;
  return (state: ReturnType<typeof useGameStore.getState>) => {
    const nextResult = selector(state);
    if (lastResult && shallow(nextResult as any, lastResult as any)) {
      return lastResult;
    }
    lastResult = nextResult;
    return nextResult;
  };
};

const selectBoardState = createShallowCachedSelector((state: ReturnType<typeof useGameStore.getState>) => ({
  board: state.board,
  counters: state.counters,
  players: state.players,
  simulatedPlayers: state.simulatedPlayers,
  playerId: state.playerId,
  playerName: state.playerName,
  cemeteryPositions: state.cemeteryPositions,
  libraryPositions: state.libraryPositions,
  exilePositions: state.exilePositions,
  commanderPositions: state.commanderPositions,
  tokensPositions: state.tokensPositions,
  moveCard: state.moveCard,
  moveLibrary: state.moveLibrary,
  moveCemetery: state.moveCemetery,
  moveExile: state.moveExile,
  moveCommander: state.moveCommander,
  moveTokens: state.moveTokens,
  toggleTap: state.toggleTap,
  removeCard: state.removeCard,
  changeCardZone: state.changeCardZone,
  setCommander: state.setCommander,
  addCardToBoard: state.addCardToBoard,
  updateCard: state.updateCard,
  drawFromLibrary: state.drawFromLibrary,
  reorderHandCard: state.reorderHandCard,
  reorderLibraryCard: state.reorderLibraryCard,
  shuffleLibrary: state.shuffleLibrary,
  mulligan: state.mulligan,
  createCounter: state.createCounter,
  moveCounter: state.moveCounter,
  modifyCounter: state.modifyCounter,
  removeCounterToken: state.removeCounterToken,
  setZoomedCard: state.setZoomedCard,
  zoomedCard: state.zoomedCard ?? null,
  flipCard: state.flipCard,
  changePlayerLife: state.changePlayerLife,
  changeCommanderDamage: state.changeCommanderDamage,
  status: state.status,
  socket: state.socket,
  connections: state.connections,
  hostConnection: state.hostConnection,
  isHost: state.isHost,
  roomId: state.roomId,
  setPeerEventLogger: state.setPeerEventLogger,
  setSimulatedPlayers: state.setSimulatedPlayers,
}));

interface LifeDisplayProps {
  player: PlayerSummary;
  isCurrentPlayer: boolean;
  changePlayerLife: (playerId: string, delta: number) => void;
  changeCommanderDamage: (targetPlayerId: string, attackerPlayerId: string, delta: number) => void;
  allPlayers: PlayerSummary[];
  viewerPlayerId: string | null;
  isHost: boolean;
}

const LifeDisplay = ({
  player,
  isCurrentPlayer,
  changePlayerLife,
  changeCommanderDamage,
  allPlayers,
  viewerPlayerId,
  isHost,
}: LifeDisplayProps) => {
  const [showCountersDropdown, setShowCountersDropdown] = useState(false);
  const dropdownHideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleShowDropdown = useCallback(() => {
    if (dropdownHideTimeout.current) {
      clearTimeout(dropdownHideTimeout.current);
      dropdownHideTimeout.current = null;
    }
    setShowCountersDropdown(true);
  }, []);

  const handleHideDropdown = useCallback(() => {
    if (dropdownHideTimeout.current) {
      clearTimeout(dropdownHideTimeout.current);
    }
    dropdownHideTimeout.current = setTimeout(() => {
      setShowCountersDropdown(false);
      dropdownHideTimeout.current = null;
    }, 150);
  }, []);

  useEffect(() => {
    return () => {
      if (dropdownHideTimeout.current) {
        clearTimeout(dropdownHideTimeout.current);
      }
    };
  }, []);

  const life = player.life ?? 40;
  const otherPlayers = allPlayers.filter((p) => p.id !== player.id);
  const shouldShowDropdown = showCountersDropdown && otherPlayers.length > 0;

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: isCurrentPlayer ? 'rgba(99, 102, 241, 0.2)' : 'rgba(15, 23, 42, 0.9)',
        border: `1px solid ${isCurrentPlayer ? 'rgba(99, 102, 241, 0.5)' : 'rgba(148, 163, 184, 0.3)'}`,
        borderRadius: '8px',
        padding: '8px 12px',
        minWidth: '120px',
      }}
      onMouseEnter={handleShowDropdown}
      onMouseLeave={handleHideDropdown}
    >
      <span
        onMouseEnter={handleShowDropdown}
        style={{
          color: '#f8fafc',
          fontSize: '14px',
          fontWeight: '500',
          minWidth: '80px',
        }}
      >
        {player.name}
      </span>
      <div
        onMouseEnter={handleShowDropdown}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <button
          onClick={() => {
            changePlayerLife(player.id, -10);
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(220, 38, 38, 1)';
            handleShowDropdown();
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(220, 38, 38, 0.8)';
          }}
          style={{
            width: '32px',
            height: '24px',
            backgroundColor: 'rgba(220, 38, 38, 0.8)',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          -10
        </button>
        <button
          onClick={() => {
            changePlayerLife(player.id, -1);
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(220, 38, 38, 1)';
            handleShowDropdown();
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(220, 38, 38, 0.8)';
          }}
          style={{
            width: '24px',
            height: '24px',
            backgroundColor: 'rgba(220, 38, 38, 0.8)',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          −
        </button>
        <span
          onMouseEnter={handleShowDropdown}
          style={{
            color: life <= 0 ? '#ef4444' : life <= 5 ? '#fbbf24' : '#f8fafc',
            fontSize: '18px',
            fontWeight: 'bold',
            minWidth: '40px',
            textAlign: 'center',
          }}
        >
          {life}
        </span>
        <button
          onClick={() => {
            changePlayerLife(player.id, 1);
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(34, 197, 94, 1)';
            handleShowDropdown();
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(34, 197, 94, 0.8)';
          }}
          style={{
            width: '24px',
            height: '24px',
            backgroundColor: 'rgba(34, 197, 94, 0.8)',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          +
        </button>
        <button
          onClick={() => {
            changePlayerLife(player.id, 10);
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(34, 197, 94, 1)';
            handleShowDropdown();
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(34, 197, 94, 0.8)';
          }}
          style={{
            width: '32px',
            height: '24px',
            backgroundColor: 'rgba(34, 197, 94, 0.8)',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          +10
        </button>
      </div>

      {shouldShowDropdown && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '4px',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(148, 163, 184, 0.3)',
            borderRadius: '8px',
            padding: '8px',
            minWidth: '200px',
            zIndex: 10000,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
            pointerEvents: 'auto',
          }}
          onMouseEnter={handleShowDropdown}
          onMouseLeave={handleHideDropdown}
        >
          {otherPlayers.map((otherPlayer) => {
            const commanderDamage = Math.max(0, player.commanderDamage?.[otherPlayer.id] ?? 0);
            const canEditRow = isHost || (!!viewerPlayerId && otherPlayer.id === viewerPlayerId);
            const buttonBaseStyle = {
              width: '20px',
              height: '20px',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            } as const;
            const minusDisabled = !canEditRow || commanderDamage <= 0;
            const plusDisabled = !canEditRow;

            return (
              <div
                key={otherPlayer.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '4px 0',
                }}
                >
                  <span style={{ color: '#f8fafc', fontSize: '12px' }}>
                    {otherPlayer.name}:
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      disabled={minusDisabled}
                      onClick={() => {
                        if (minusDisabled) return;
                        changeCommanderDamage(player.id, otherPlayer.id, -1);
                      }}
                      style={{
                        ...buttonBaseStyle,
                        backgroundColor: 'rgba(220, 38, 38, 0.8)',
                        color: 'white',
                        cursor: minusDisabled ? 'default' : 'pointer',
                        opacity: minusDisabled ? 0.5 : 1,
                      }}
                    >
                      −
                    </button>
                    <span style={{ color: '#f8fafc', fontSize: '14px', minWidth: '30px', textAlign: 'center' }}>
                      {commanderDamage}
                    </span>
                    <button
                      disabled={plusDisabled}
                      onClick={() => {
                        if (plusDisabled) return;
                        changeCommanderDamage(player.id, otherPlayer.id, 1);
                      }}
                      style={{
                        ...buttonBaseStyle,
                        backgroundColor: 'rgba(34, 197, 94, 0.8)',
                        color: 'white',
                        cursor: plusDisabled ? 'default' : 'pointer',
                        opacity: plusDisabled ? 0.5 : 1,
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Board = () => {
  const {
    board,
    counters,
    players,
    simulatedPlayers,
    playerId,
    playerName,
    cemeteryPositions: storeCemeteryPositions,
    libraryPositions: storeLibraryPositions,
    exilePositions: storeExilePositions,
    commanderPositions: storeCommanderPositions,
    tokensPositions: storeTokensPositions,
    moveCard,
    moveLibrary,
    moveCemetery,
    moveExile,
    moveCommander,
    moveTokens,
    toggleTap,
    removeCard,
    changeCardZone,
    addCardToBoard,
    updateCard,
    setCommander,
    drawFromLibrary,
    reorderHandCard,
    reorderLibraryCard,
    shuffleLibrary,
    mulligan,
    createCounter,
    moveCounter,
    modifyCounter,
    removeCounterToken,
    setZoomedCard: setZoomedCardSync,
    zoomedCard: zoomedCardSync,
    flipCard,
    changePlayerLife,
    changeCommanderDamage,
    status,
    socket,
    connections,
    hostConnection,
    isHost,
    roomId,
    setPeerEventLogger,
    setSimulatedPlayers,
  } = useGameStore(selectBoardState);
  const currentStatus = status ?? 'idle';
  
  // Helper para verificar se um player é simulado
  const simulatedPlayerNames = useMemo(() => new Set(simulatedPlayers.map((p) => p.name)), [simulatedPlayers]);
  const isSimulatedPlayer = useCallback((ownerId: string) => simulatedPlayerNames.has(ownerId), [simulatedPlayerNames]);
  
  // Helper para verificar se pode interagir com uma carta
  const canInteractWithCard = useCallback((cardOwnerId: string) => {
    return cardOwnerId === playerName || isSimulatedPlayer(cardOwnerId);
  }, [playerName, isSimulatedPlayer]);
  const boardRef = useRef<HTMLDivElement>(null);
  const libraryContainerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const setLibraryContainerRef = useCallback((player: string, element: HTMLDivElement | null) => {
    libraryContainerRefs.current[player] = element;
  }, []);
  
  // Sistema centralizado de drag - apenas uma carta pode ser arrastada por vez
  const dragStateRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false); // Estado para forçar re-render do useEffect
  const clickBlockTimeoutRef = useRef<ClickBlockState | null>(null);
  
  // Estados para library e hand (sincronizar com store)
  const [libraryPositions, setLibraryPositions] = useState<Record<string, Point>>({});
  const [draggingLibrary, setDraggingLibrary] = useState<{ playerName: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const [libraryMoved, setLibraryMoved] = useState(false);
  const librarySyncLockRef = useRef<Record<string, Point>>({});
  const libraryMovedRef = useRef<boolean>(false);
  const libraryClickExecutedRef = useRef<boolean>(false);
  const librarySyncRafRef = useRef<number | null>(null);
  
  // Estados para cemetery (sincronizar com store)
  const [cemeteryPositions, setCemeteryPositions] = useState<Record<string, Point>>({});
  const [draggingCemetery, setDraggingCemetery] = useState<{ playerName: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const [draggingExile, setDraggingExile] = useState<{ playerName: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const [draggingCommander, setDraggingCommander] = useState<{ playerName: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const [draggingTokens, setDraggingTokens] = useState<{ playerName: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  
  // Sincronizar posições do store com estado local
  // IMPORTANTE: Ignorar atualizações do store durante o drag para evitar que sobrescreva mudanças locais
  useEffect(() => {
    // Se estamos arrastando o cemitério, não atualizar o estado local
    // para evitar que atualizações remotas (com latência) sobrescrevam o drag local
    if (draggingCemetery) {
      return;
    }
    setCemeteryPositions(storeCemeteryPositions);
  }, [storeCemeteryPositions, draggingCemetery]);
  
  useEffect(() => {
    // Se estamos arrastando o library, não atualizar o estado local
    // para evitar que atualizações remotas (com latência) sobrescrevam o drag local
    if (draggingLibrary) {
      return;
    }
    setLibraryPositions((prev) => {
      const next = { ...prev };
      const locks = { ...librarySyncLockRef.current };
      Object.entries(storeLibraryPositions).forEach(([player, position]) => {
        const lock = locks[player];
        if (lock) {
          const matches = Math.abs(lock.x - position.x) < 1 && Math.abs(lock.y - position.y) < 1;
          if (!matches) {
            return;
          }
          delete locks[player];
        }
        next[player] = position;
      });
      librarySyncLockRef.current = locks;
      return next;
    });
    if (librarySyncRafRef.current !== null) {
      cancelAnimationFrame(librarySyncRafRef.current);
      librarySyncRafRef.current = null;
    }
  }, [storeLibraryPositions, draggingLibrary]);

  const [cemeteryMoved, setCemeteryMoved] = useState(false);
  const cemeteryMovedRef = useRef<boolean>(false);
  const [showHand, setShowHand] = useState(true);
  const [handButtonEnabled, setHandButtonEnabled] = useState(false);
  const [showDebugMode, setShowDebugMode] = useState(false);
  const [eventLogMinimized, setEventLogMinimized] = useState(false);
  const [showSimulatePanel, setShowSimulatePanel] = useState(false);
  const [peerDebugMinimized, setPeerDebugMinimized] = useState(false);
  
  // Combinar players reais com simulados
  const allPlayers = useMemo(() => {
    return simulatedPlayers.length > 0
      ? [...players, ...simulatedPlayers]
      : players;
  }, [players, simulatedPlayers]);
  
  const simulatePlayers = simulatedPlayers.length;
  
  // Modos de visualização: 'individual' (um por vez), 'separated' (boards separados)
  const [viewMode, setViewMode] = useState<'individual' | 'separated'>('individual');
  const [selectedPlayerIndex, setSelectedPlayerIndex] = useState(0); // Para modo individual
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    card: CardOnBoard;
  } | null>(null);
  const [showPrintsMenu, setShowPrintsMenu] = useState(false);
  const [printsLoading, setPrintsLoading] = useState(false);
  const [printsError, setPrintsError] = useState<string | null>(null);
  const [printsOptions, setPrintsOptions] = useState<Array<{ id: string; label: string; imageUrl?: string; backImageUrl?: string; setName?: string }>>([]);
  const [printsSelection, setPrintsSelection] = useState<string | null>(null);
  const [printsCardId, setPrintsCardId] = useState<string | null>(null);
  const [printsMetaById, setPrintsMetaById] = useState<Record<string, { setCode?: string; collectorNumber?: string }>>({});

  const applyPrintSelection = useCallback(
    (selectionId?: string | null) => {
      if (!selectionId || !printsCardId) return;
      const selected = printsOptions.find((option) => option.id === selectionId);
      const meta = printsMetaById[selectionId];
      if (!selected) return;
      updateCard(printsCardId, {
        imageUrl: selected.imageUrl,
        backImageUrl: selected.backImageUrl,
        setName: selected.setName,
        setCode: meta?.setCode,
        collectorNumber: meta?.collectorNumber,
      });
    },
    [printsCardId, printsOptions, printsMetaById, updateCard]
  );
  const [boardContextMenu, setBoardContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [boardContextMenuPosition, setBoardContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [contextSubmenu, setContextSubmenu] = useState<'moveZone' | 'libraryPlace' | 'cascade' | null>(null);
  const [contextSubmenuLibrary, setContextSubmenuLibrary] = useState<boolean>(false);
  const [zoomedCard, setZoomedCard] = useState<string | null>(null);
  // Usar zoom sincronizado do store quando disponível (para cascade), senão usar o local
  const effectiveZoomedCard = zoomedCardSync ?? zoomedCard;
  
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
    dragOffset: Point | null;
  }>({
    draggingHandCard: null,
    handCardMoved: false,
    previewHandOrder: null,
    dragPosition: null,
    dragOffset: null,
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
  
  const schedulePeerLogUpdate = useRef<null | ((updater: () => void) => void)>(null);
  if (!schedulePeerLogUpdate.current) {
    schedulePeerLogUpdate.current = (updater: () => void) => {
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(updater);
      } else {
        Promise.resolve().then(updater);
      }
    };
  }

  const peerLogThrottleMap = useRef<Record<string, number>>({});
  const addPeerEventLog = useCallback((type: 'SENT' | 'RECEIVED', direction: 'TO_HOST' | 'TO_PEERS' | 'FROM_HOST' | 'FROM_PEER', messageType: string, actionKind?: string, target?: string, details?: Record<string, unknown>) => {
    const throttleKey = `${type}-${direction}-${messageType}`;
    const now = Date.now();
    const lastCall = peerLogThrottleMap.current[throttleKey] ?? 0;
    if (now - lastCall < 250) {
      return;
    }
    peerLogThrottleMap.current[throttleKey] = now;
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
    
    schedulePeerLogUpdate.current?.(() => {
      setPeerEventLogs((prev) => {
        const updated = [log, ...prev].slice(0, maxPeerLogs);
        return updated;
      });
    });
  }, []);
  
  // Usar ref para armazenar a função e evitar loops infinitos
  const addPeerEventLogRef = useRef(addPeerEventLog);
  addPeerEventLogRef.current = addPeerEventLog;
  
  // Conectar o logger de eventos de peer ao store
  useEffect(() => {
    const logger = (type: 'SENT' | 'RECEIVED', direction: 'TO_HOST' | 'TO_PEERS' | 'FROM_HOST' | 'FROM_PEER', messageType: string, actionKind?: string, target?: string, details?: Record<string, unknown>) => {
      addPeerEventLogRef.current(type, direction, messageType, actionKind, target, details);
    };
    setPeerEventLogger(logger);
    return () => {
      setPeerEventLogger(null);
    };
  }, [setPeerEventLogger]);
  
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
              message: `Moving card: ${cardName || cardId}${moveCount > 1 ? ` (${moveCount} moves)` : ''}`,
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
          text += `\nCard: ${log.cardName}`;
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
        text += `\nCard: ${log.cardName}`;
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
      }
      document.body.removeChild(textArea);
    }
  };
  
  // Memoizar filtros de cards para evitar recálculos desnecessários
  const battlefieldCards = useMemo(() => board.filter((c) => c.zone === 'battlefield'), [board]);
  const libraryCards = useMemo(() => board.filter((c) => c.zone === 'library'), [board]);
  const handCards = useMemo(() => board.filter((c) => c.zone === 'hand'), [board]);
  const cemeteryCards = useMemo(() => board.filter((c) => c.zone === 'cemetery'), [board]);
  const exileCards = useMemo(() => board.filter((c) => c.zone === 'exile'), [board]);
  const commanderCards = useMemo(() => board.filter((c) => c.zone === 'commander'), [board]);
  const tokensCards = useMemo(() => board.filter((c) => c.zone === 'tokens'), [board]);

  
  // Memoizar handCards do player atual para evitar recálculos
  const playerHandCards = useMemo(() => 
    handCards.filter((c) => c.ownerId === playerName), 
    [handCards, playerName]
  );
  
  // Ajustar posição de cards recém-adicionadas para o centro da área do player
  const processedCardsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!boardRef.current) return;
    
    const cardsToCenter = battlefieldCards.filter(
      (card) => 
        card.ownerId === playerName && 
        card.position.x === -1 && 
        card.position.y === -1 &&
        !processedCardsRef.current.has(card.id)
    );
    
    if (cardsToCenter.length > 0) {
      const playerArea = getPlayerArea(playerName);
      
      if (playerArea) {
        const CARD_WIDTH = 150;
        const CARD_HEIGHT = 210;
        const centerX = playerArea.x + (playerArea.width / 2) - (CARD_WIDTH / 2);
        const centerY = playerArea.y + (playerArea.height / 2) - (CARD_HEIGHT / 2);
        
        cardsToCenter.forEach((card) => {
          processedCardsRef.current.add(card.id);
          moveCard(card.id, { x: centerX, y: centerY }, { persist: true });
        });
      }
    }
    
    // Limpar ref de cards que não existem mais
    const currentCardIds = new Set(battlefieldCards.map(c => c.id));
    processedCardsRef.current.forEach((id) => {
      if (!currentCardIds.has(id)) {
        processedCardsRef.current.delete(id);
      }
    });
  }, [board, playerName, moveCard]);


  // Tamanho base do board em 1080p (importado de BoardTypes.ts)
  
  // Calcular scale baseado na resolução atual (para individual)
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
    playerName: string,
    rect: DOMRect
  ): { x: number; y: number } | null => {
    const windowInfo = getPlayerWindowAtPosition(mouseX, mouseY);
    if (!windowInfo || windowInfo.player.name !== playerName) {
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

  // Função auxiliar para converter coordenadas do mouse no modo individual
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

  const getPlayerArea = useCallback((ownerName: string) => {
    if (!boardRef.current) return null;
    const playerIndex = allPlayers.findIndex((p) => p.name === ownerName);
    if (playerIndex === -1) {
      return null;
    }

    // No modo separated, retornar tamanho base (1920x1080) já que o scale é aplicado no container
    if (viewMode === 'separated') {
    return {
      x: 0,
      y: 0,
        width: BASE_BOARD_WIDTH,
        height: BASE_BOARD_HEIGHT,
      };
    }
    
    // No modo individual, usar o espaço base
    return {
      x: 0,
      y: 0,
      width: BASE_BOARD_WIDTH,
      height: BASE_BOARD_HEIGHT,
    };
  }, [boardRef, allPlayers, viewMode]);

  const getHandArea = (ownerName: string) => {
    if (!boardRef.current || allPlayers.length === 0 || !showHand) return null;
    const playerIndex = allPlayers.findIndex((p) => p.name === ownerName);
    if (playerIndex === -1) return null;

    const HAND_CARD_LEFT_SPACING = 120;
    const maxRenderCards = 9;
    
    const playerHandCards = board.filter((c) => c.zone === 'hand' && c.ownerId === ownerName);
    const totalCards = playerHandCards.length;
    
    // Usar o espaço base (1920x1080)
    if (totalCards === 0) {
      const handHeight = 168 + 5; // HAND_CARD_HEIGHT + margem inferior pequena
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
    
    // Reduzir margens para evitar espaço vazio no topo
    // Margem inferior pequena (5px) e margem superior mínima (2px) apenas para o arco
    const handHeight = 168 + 5 + 2; // HAND_CARD_HEIGHT + margem inferior + margem superior mínima
    const handY = BASE_BOARD_HEIGHT - handHeight;

    return {
      x: handX,
      y: handY,
      width: handWidth,
      height: handHeight,
    };
  };

  const getCemeteryPosition = (playerName: string): Point | null => {
    const area = getPlayerArea(playerName);
    if (!area) return null;
    
    const CEMETERY_CARD_WIDTH = 100;
    const CEMETERY_CARD_HEIGHT = 140;
    
    // Primeiro, verificar se há posição no store (sincronizada entre peers)
    // As posições no store já estão no espaço base
    if (storeCemeteryPositions[playerName]) {
      return storeCemeteryPositions[playerName];
    }
    
    // Segundo, verificar se há posição salva localmente
    if (cemeteryPositions[playerName]) {
      return cemeteryPositions[playerName];
    }
    
    // Terceiro, verificar se há cards no board com posição (vindo dos peers)
    const playerCemeteryCards = cemeteryCards
      .filter((c) => c.ownerId === playerName)
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
    const playerIndex = players.findIndex((p) => p.name === playerName);
    const offsetX = playerIndex * (CEMETERY_CARD_WIDTH + 20);
    return {
      x: area.x + (area.width / 2) - CEMETERY_CARD_WIDTH / 2 + offsetX,
      y: area.y + (area.height / 2) - CEMETERY_CARD_HEIGHT / 2,
    };
  };

  // Função para detectar em qual zona o cursor está
  const detectZoneAtPosition = (x: number, y: number): { zone: 'battlefield' | 'hand' | 'library' | 'cemetery' | 'exile' | 'commander' | 'tokens' | null; ownerId?: string } => {
    if (!boardRef.current) return { zone: null };
    
    // Verificar cemitério
    const CEMETERY_STACK_WIDTH = 120; // Área maior do stack
    const CEMETERY_STACK_HEIGHT = 160;
    
    // Verificar se está dentro da área do cemitério (considerando todos os players)
    for (const player of allPlayers) {
      const cemeteryPos = getCemeteryPosition(player.name);
      if (cemeteryPos) {
        if (
          x >= cemeteryPos.x - 10 &&
          x <= cemeteryPos.x + CEMETERY_STACK_WIDTH &&
          y >= cemeteryPos.y - 10 &&
          y <= cemeteryPos.y + CEMETERY_STACK_HEIGHT
        ) {
          return { zone: 'cemetery', ownerId: player.name };
        }
      }
    }
    
    // Verificar exílio
    const EXILE_STACK_WIDTH = 120;
    const EXILE_STACK_HEIGHT = 160;
    for (const player of allPlayers) {
      const exilePos = getExilePosition(player.name);
      if (exilePos) {
        if (
          x >= exilePos.x - 10 &&
          x <= exilePos.x + EXILE_STACK_WIDTH &&
          y >= exilePos.y - 10 &&
          y <= exilePos.y + EXILE_STACK_HEIGHT
        ) {
          return { zone: 'exile', ownerId: player.name };
        }
      }
    }

    // Verificar commander
    const COMMANDER_STACK_WIDTH = 120;
    const COMMANDER_STACK_HEIGHT = 160;
    for (const player of allPlayers) {
      const commanderPos = getCommanderPosition(player.name);
      if (commanderPos) {
        if (
          x >= commanderPos.x - 10 &&
          x <= commanderPos.x + COMMANDER_STACK_WIDTH &&
          y >= commanderPos.y - 10 &&
          y <= commanderPos.y + COMMANDER_STACK_HEIGHT
        ) {
          return { zone: 'commander', ownerId: player.name };
        }
      }
    }

    // Verificar tokens
    const TOKENS_STACK_WIDTH = 120;
    const TOKENS_STACK_HEIGHT = 160;
    for (const player of allPlayers) {
      const tokensPos = getTokensPosition(player.name);
      if (tokensPos) {
        if (
          x >= tokensPos.x - 10 &&
          x <= tokensPos.x + TOKENS_STACK_WIDTH &&
          y >= tokensPos.y - 10 &&
          y <= tokensPos.y + TOKENS_STACK_HEIGHT
        ) {
          return { zone: 'tokens', ownerId: player.name };
        }
      }
    }
    
    // Verificar hand
    if (showHand) {
      const handArea = getHandArea(playerName);
      if (handArea) {
        if (
          x >= handArea.x &&
          x <= handArea.x + handArea.width &&
          y >= handArea.y &&
          y <= handArea.y + handArea.height
        ) {
          return { zone: 'hand', ownerId: playerName };
        }
      }
    }
    
    // Verificar library
    for (const player of allPlayers) {
      const libraryPos = getLibraryPosition(player.name);
      if (libraryPos) {
        const LIBRARY_CARD_WIDTH = 100;
        const LIBRARY_CARD_HEIGHT = 140;
        if (
          x >= libraryPos.x &&
          x <= libraryPos.x + LIBRARY_CARD_WIDTH &&
          y >= libraryPos.y &&
          y <= libraryPos.y + LIBRARY_CARD_HEIGHT
        ) {
          return { zone: 'library', ownerId: player.name };
        }
      }
    }
    
    // Se não está em nenhuma zona específica, é battlefield
    return { zone: 'battlefield' };
  };

  const getExilePosition = (ownerName: string): Point | null => {
    const area = getPlayerArea(ownerName);
    if (!area) return null;
    const EXILE_CARD_HEIGHT = 140;
    
    // Prefer local position while dragging/latency.
    if (exilePositions[ownerName]) {
      return {
        x: exilePositions[ownerName].x,
        y: exilePositions[ownerName].y,
      };
    }

    // Primeiro, verificar se há posição no store (sincronizada entre peers)
    if (storeExilePositions[ownerName]) {
      return storeExilePositions[ownerName];
    }
    
    // Segundo, verificar se há posição salva localmente
    if (exilePositions[ownerName]) {
      return exilePositions[ownerName];
    }
    
    // Segundo, verificar se há cards no board com posição
    const playerExileCards = exileCards
      .filter((c) => c.ownerId === ownerName)
      .sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0))
      .slice(0, 5);
    
    const topCard = playerExileCards[0];
    if (topCard && topCard.position.x !== 0 && topCard.position.y !== 0) {
      return {
        x: topCard.position.x,
        y: topCard.position.y,
      };
    }
    
    // Posição padrão no espaço base (ao lado do cemitério)
    return {
      x: area.x + area.width - 150 - 120, // À esquerda do cemitério
      y: area.y + (area.height / 2) - (EXILE_CARD_HEIGHT / 2),
    };
  };

  const getCommanderPosition = (ownerName: string): Point | null => {
    const area = getPlayerArea(ownerName);
    if (!area) return null;
    if (commanderPositions[ownerName]) {
      return {
        x: commanderPositions[ownerName].x,
        y: commanderPositions[ownerName].y,
      };
    }
    return {
      x: area.x + 20,
      y: area.y + 20,
    };
  };

  const getTokensPosition = (ownerName: string): Point | null => {
    const area = getPlayerArea(ownerName);
    if (!area) return null;
    if (tokensPositions[ownerName]) {
      return {
        x: tokensPositions[ownerName].x,
        y: tokensPositions[ownerName].y,
      };
    }
    return {
      x: area.x + 20,
      y: area.y + 200,
    };
  };

  useEffect(() => {
    const commanderPos = getCommanderPosition(playerName);
    if (commanderPos) {
      commanderCards
        .filter((card) => card.ownerId === playerName && card.position.x === 0 && card.position.y === 0)
        .forEach((card) => {
          moveCard(card.id, { x: commanderPos.x, y: commanderPos.y }, { persist: true });
        });
    }

    const tokensPos = getTokensPosition(playerName);
    if (tokensPos) {
      tokensCards
        .filter((card) => card.ownerId === playerName && card.position.x === 0 && card.position.y === 0)
        .forEach((card) => {
          moveCard(card.id, { x: tokensPos.x, y: tokensPos.y }, { persist: true });
        });
    }
  }, [commanderCards, tokensCards, playerName, getCommanderPosition, getTokensPosition, moveCard]);

  const getLibraryPosition = (ownerName: string) => {
    const area = getPlayerArea(ownerName);
    if (!area) return null;
    
    // Se há posição local, usar ela primeiro (sempre em coordenadas absolutas)
    if (libraryPositions[ownerName]) {
      return {
        x: libraryPositions[ownerName].x,
        y: libraryPositions[ownerName].y,
      };
    }
    
    // Se há posição salva no store, usar ela (já está no espaço base)
    if (storeLibraryPositions[ownerName]) {
      return {
        x: storeLibraryPositions[ownerName].x,
        y: storeLibraryPositions[ownerName].y,
      };
    }
    
    const playerLibraryCards = libraryCards
      .filter((c) => c.ownerId === ownerName)
      .sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0))
      .slice(0, 5);
    
    const topCard = playerLibraryCards[0];
    if (topCard && topCard.position.x !== 0 && topCard.position.y !== 0) {
      // As posições das cards já estão no espaço base
      return {
        x: topCard.position.x,
        y: topCard.position.y,
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
      // Durante o drag, pointermove acontece → envia cada posição

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
      // Modo individual: usar função auxiliar específica
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
      // No modo individual, trabalhar com pixels no espaço base (1920x1080)
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
        moveCard(dragState.cardId, { x: clampedX, y: clampedY });
      }
    };

    const handleUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      // Ignorar se foi botão direito ou botão do meio
      if (event.button === 1 || event.button === 2) {
        dragStateRef.current = null;
        setIsDragging(false);
        return;
      }

      // Detectar zona ao soltar e mudar se necessário
      if (dragState.hasMoved && boardRef.current) {
        const currentBoard = useGameStore.getState().board;
        const card = currentBoard.find((c) => c.id === dragState.cardId);
        
        if (card && card.ownerId === playerName) {
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
            let position: Point = { x: 0, y: 0 };
            
            if (detectedZone.zone === 'battlefield') {
              // Posição onde soltou (já convertida para espaço base)
              position = {
                x: Math.max(0, Math.min(BASE_BOARD_WIDTH - CARD_WIDTH, baseX - dragState.offsetX)),
                y: Math.max(0, Math.min(BASE_BOARD_HEIGHT - CARD_HEIGHT, baseY - dragState.offsetY)),
              };
            } else if (detectedZone.zone === 'hand') {
              // Para hand, usar posição { x: 0, y: 0 } - será reordenada automaticamente
              position = { x: 0, y: 0 };
            } else if (detectedZone.zone === 'cemetery') {
              const cemeteryPos = getCemeteryPosition(detectedZone.ownerId || card.ownerId);
              position = cemeteryPos || { x: 0, y: 0 };
            } else if (detectedZone.zone === 'library') {
              const libraryPos = getLibraryPosition(detectedZone.ownerId || card.ownerId);
              position = libraryPos || { x: 0, y: 0 };
            } else if (detectedZone.zone === 'exile') {
              const exilePos = getExilePosition(detectedZone.ownerId || card.ownerId);
              position = exilePos || { x: 0, y: 0 };
            }
            
            addEventLog('CHANGE_ZONE', `Mudando zona: ${card.name} (${card.zone} → ${detectedZone.zone})`, card.id, card.name, {
              from: card.zone,
              to: detectedZone.zone,
              position,
            });
            
            moveCard(card.id, position, { persist: true });
            
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
            resetAllDragStates();
              
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
            const handArea = getHandArea(playerName);
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
                    message: `Moving card: ${card.name}${moveCount > 1 ? ` (${moveCount} moves, final)` : ' (final)'}`,
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
          
          moveCard(cardId, card.position, { persist: true });
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
        
        if (card && card.zone === 'battlefield' && card.ownerId === playerName) {
          toggleTap(cardId);
        } else {
        }
        
        if (clickBlockTimeoutRef.current) {
          clearTimeout(clickBlockTimeoutRef.current.timeoutId);
          clickBlockTimeoutRef.current = null;
        }
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
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [isDragging, showHand, playerName, moveCard, changeCardZone, getPlayerArea, getHandArea, viewMode, players]);

  const startDrag = (card: CardOnBoard, event: ReactPointerEvent) => {
    // Ignorar botão direito e botão do meio
    if (event.button === 1 || event.button === 2) return;
    
    // Só pode mover suas próprias cards
    if (card.ownerId !== playerName) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    if (!boardRef.current) return;
    
    // Se a carta está na hand, não iniciar drag aqui (deixar o Hand component gerenciar)
    if (card.zone === 'hand' && showHand) {
      return;
    }
    if (card.zone === 'tokens') {
      return;
    }

    // Verificar se a carta ainda existe no board atualizado
    const currentBoard = useGameStore.getState().board;
    const currentCard = currentBoard.find((c) => c.id === card.id);
    if (!currentCard) {
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
      // Modo individual: usar função auxiliar específica
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
    const currentLibraryPlayer = draggingLibrary?.playerName;
    const currentLibraryPos = currentLibraryPlayer ? getLibraryPosition(currentLibraryPlayer) : null;
    dragStateRef.current = null;
    setIsDragging(false);
    setDraggingLibrary(null);
    setLibraryMoved(false);
    if (currentLibraryPlayer && currentLibraryPos) {
    setLibraryPositions((prev) => ({
      ...prev,
      [currentLibraryPlayer]: currentLibraryPos,
    }));
    }
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


  const ownerName = (card: CardOnBoard) => allPlayers.find((player) => player.name === card.ownerId)?.name ?? 'Unknown';

  const handleLibraryClick = (targetPlayerName: string) => {
    // targetPlayerName é o nome do player (não o ID)
    if (targetPlayerName === playerName) {
      addEventLog('DRAW_FROM_LIBRARY', 'Comprando carta da library', undefined, undefined, {
        playerName: targetPlayerName,
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

    // Bloquear clique apenas se há um drag realmente ativo
    if (isDragging) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Bloquear clique apenas se acabou de fazer drag com movimento na mesma carta
    // (o timeout só é definido se houve movimento real)
    if (clickBlockTimeoutRef.current && clickBlockTimeoutRef.current.cardId === card.id) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Bloquear se há drag da hand ativo
    if (showHand && dragStartedFromHandRef.current) {
      event.preventDefault();
      event.stopPropagation();
      dragStartedFromHandRef.current = false;
      handCardPlacedRef.current = false;
      return;
    }

    // O menu de contexto é tratado pelo onContextMenu, não pelo onClick
    // O clique normal na hand vai direto para o board (ver código abaixo)

    // Verificar se a carta mudou de zona
    const currentBoard = useGameStore.getState().board;
    const currentCard = currentBoard.find((c) => c.id === card.id);
    if (currentCard && currentCard.zone !== card.zone) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Bloquear clique se clicou na área da mão
    const target = event.target as HTMLElement;
    const clickedOnHandArea = target.closest('.hand-area, .hand-cards, .hand-card-wrapper');
    if (clickedOnHandArea && card.zone === 'battlefield') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Se a carta está no board, fazer tap/untap
    if (card.zone === 'battlefield' && canInteractWithCard(card.ownerId)) {
      addEventLog('TOGGLE_TAP', `Toggle tap: ${card.name} (${card.tapped ? 'tapped' : 'untapped'} → ${!card.tapped ? 'tapped' : 'untapped'})`, card.id, card.name, {
        from: card.tapped,
        to: !card.tapped,
      });
      toggleTap(card.id);
      return;
    }

    // Se está na mão, colocar no board
    if (card.zone === 'hand' && canInteractWithCard(card.ownerId) && showHand) {
      const playerArea = getPlayerArea(playerName);
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

  };

  const handleCardZoom = (card: CardOnBoard, event: React.PointerEvent) => {
    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      // Para zoom local (middle click), usar estado local
      if (zoomedCard === card.id) {
        setZoomedCard(null);
      } else {
        setZoomedCard(card.id);
      }
    }
  };

  // Calcular posição ajustada do menu do board quando ele é aberto
  useEffect(() => {
    if (!boardContextMenu) {
      setBoardContextMenuPosition(null);
      return;
    }
    
    // Definir posição inicial imediatamente
    setBoardContextMenuPosition({ x: boardContextMenu.x, y: boardContextMenu.y });
    
    // Ajustar posição após o menu ser renderizado
    const timeoutId = setTimeout(() => {
      const menuElement = document.querySelector('[data-board-context-menu]') as HTMLElement;
      if (menuElement) {
        const realMenuHeight = menuElement.scrollHeight;
        const realMenuWidth = menuElement.offsetWidth;
        const padding = 10;
        
        let adjustedX = boardContextMenu.x;
        let adjustedY = boardContextMenu.y;
        
        if (adjustedX + realMenuWidth > window.innerWidth - padding) {
          adjustedX = window.innerWidth - realMenuWidth - padding;
        }
        
        if (adjustedY + realMenuHeight > window.innerHeight - padding) {
          const spaceAbove = boardContextMenu.y - padding;
          const spaceBelow = window.innerHeight - boardContextMenu.y - padding;
          
          if (spaceAbove >= realMenuHeight) {
            adjustedY = boardContextMenu.y - realMenuHeight;
          } else if (spaceBelow >= realMenuHeight) {
            adjustedY = window.innerHeight - realMenuHeight - padding;
          } else {
            adjustedY = (spaceAbove > spaceBelow) ? padding : (window.innerHeight - realMenuHeight - padding);
          }
        }
        
        if (adjustedY < padding) adjustedY = padding;
        if (adjustedX < padding) adjustedX = padding;
        
        setBoardContextMenuPosition({ x: adjustedX, y: adjustedY });
      }
    }, 0);
    
    return () => clearTimeout(timeoutId);
  }, [boardContextMenu]);

  // Calcular posição ajustada do menu quando ele é aberto
  useEffect(() => {
    if (!contextMenu) {
      setContextMenuPosition(null);
      return;
    }
    
    // Calcular posição imediatamente com altura estimada, depois ajustar com altura real
    const estimatedMenuHeight = 600;
    const estimatedMenuWidth = 220;
    const padding = 10;
    
    let menuX = contextMenu.x;
    let menuY = contextMenu.y;
    
    // Ajustar posição horizontal se o menu sair da tela à direita
    if (menuX + estimatedMenuWidth > window.innerWidth - padding) {
      menuX = window.innerWidth - estimatedMenuWidth - padding;
    }
    
    // Calcular espaço disponível
    const spaceBelow = window.innerHeight - contextMenu.y - padding;
    const spaceAbove = contextMenu.y - padding;
    
    // Ajustar posição vertical
    if (spaceBelow < estimatedMenuHeight) {
      // Não cabe abaixo, tentar colocar acima
      if (spaceAbove >= estimatedMenuHeight) {
        // Cabe acima, colocar acima
        menuY = contextMenu.y - estimatedMenuHeight;
      } else {
        // Não cabe nem acima nem abaixo, usar o espaço disponível maior
        if (spaceAbove > spaceBelow) {
          menuY = padding;
        } else {
          menuY = window.innerHeight - estimatedMenuHeight - padding;
        }
      }
    }
    
    // Garantir que não fique acima da tela
    if (menuY < padding) {
      menuY = padding;
    }
    
    // Garantir que não fique à esquerda da tela
    if (menuX < padding) {
      menuX = padding;
    }
    
    // Definir posição inicial
    setContextMenuPosition({ x: menuX, y: menuY });
    
    // Ajustar com altura real após o menu ser renderizado
    const timeoutId = setTimeout(() => {
      const menuElement = document.querySelector('[data-context-menu]') as HTMLElement;
      if (menuElement) {
        const realMenuHeight = menuElement.scrollHeight;
        const realMenuWidth = menuElement.offsetWidth;
        
        let adjustedX = menuX;
        let adjustedY = menuY;
        
        // Reajustar horizontal se necessário
        if (adjustedX + realMenuWidth > window.innerWidth - padding) {
          adjustedX = window.innerWidth - realMenuWidth - padding;
        }
        
        // Reajustar vertical se necessário - garantir que o menu inteiro fique visível
        const spaceBelow = window.innerHeight - adjustedY - padding;
        const spaceAbove = adjustedY - padding;
        
        if (realMenuHeight > spaceBelow) {
          // Menu não cabe abaixo, tentar colocar acima
          if (spaceAbove >= realMenuHeight) {
            adjustedY = contextMenu.y - realMenuHeight;
          } else {
            // Não cabe nem acima nem abaixo, posicionar para maximizar visibilidade
            if (spaceAbove > spaceBelow) {
              adjustedY = padding;
            } else {
              adjustedY = window.innerHeight - realMenuHeight - padding;
            }
          }
        }
        
        // Garantir limites
        if (adjustedY < padding) adjustedY = padding;
        if (adjustedX < padding) adjustedX = padding;
        
        setContextMenuPosition({ x: adjustedX, y: adjustedY });
        
        // Remove overflow se o menu couber completamente na tela
        const finalSpaceBelow = window.innerHeight - adjustedY - padding;
        if (realMenuHeight <= finalSpaceBelow) {
          menuElement.style.overflowY = 'visible';
          menuElement.style.maxHeight = 'none';
        } else {
          menuElement.style.overflowY = 'auto';
          menuElement.style.maxHeight = `${finalSpaceBelow}px`;
        }
      }
    }, 0);
    
    return () => clearTimeout(timeoutId);
  }, [contextMenu]);

  const handleCardContextMenu = (card: CardOnBoard, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Registrar última carta tocada para debug
    setLastTouchedCard(card);
    
    addEventLog('CONTEXT_MENU', `Context menu em: ${card.name}`, card.id, card.name, {
      zone: card.zone,
      ownerId: card.ownerId,
    });
    
    // Não bloquear context menu por drag, apenas se está realmente arrastando
    if (isDragging) {
      return;
    }

    setShowPrintsMenu(false);
    setPrintsSelection(null);
    setPrintsOptions([]);
    setPrintsCardId(null);
    setPrintsError(null);
    
    // Mostrar menu de contexto (a posição será ajustada no useEffect)
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      card,
    });
  };
  
  // Função para converter manaCost string para número (CMC - Converted Mana Cost)
  const parseManaCost = (manaCost?: string): number => {
    if (!manaCost || manaCost.trim() === '') return 0;
    
    // Remove chaves e contar números e símbolos
    // Ex: "{2}{R}" -> 2 + 1 = 3, "{X}{R}{G}" -> 0 + 1 + 1 = 2 (X conta como 0)
    const matches = manaCost.match(/\{(\d+|[XWUBRGC]|W\/U|W\/B|U\/B|U\/R|B\/R|B\/G|R\/G|R\/W|G\/W|G\/U|2\/W|2\/U|2\/B|2\/R|2\/G)\}/g);
    if (!matches) return 0;
    
    let total = 0;
    for (const match of matches) {
      const content = match.slice(1, -1); // Remove { e }
      if (content === 'X') {
        // X conta como 0 no CMC
        continue;
      } else if (/^\d+$/.test(content)) {
        // Número
        total += parseInt(content, 10);
      } else {
        // Símbolo de mana (W, U, B, R, G, C, híbridos, etc) conta como 1
        total += 1;
      }
    }
    
    return total;
  };

  // Função para executar cascade
  const handleCascade = async (showEachCard: boolean) => {
    if (!contextMenu) return;
    
    const { card } = contextMenu;
    if (card.zone !== 'library' || !canInteractWithCard(card.ownerId)) return;
    
    // Fechar submenu
    setContextSubmenu(null);
    
    // Perguntar o valor do CMC maximo
    const cascadeValueStr = window.prompt('Enter the max CMC value:');
    if (!cascadeValueStr) {
      setContextMenu(null);
      setShowPrintsMenu(false);
      setShowPrintsMenu(false);
      return;
    }
    
    const cascadeValue = parseInt(cascadeValueStr, 10);
    if (isNaN(cascadeValue) || cascadeValue < 0) {
      alert('Invalid value. Enter a number greater than or equal to 0.');
      setContextMenu(null);
      setShowPrintsMenu(false);
      return;
    }
    
    setContextMenu(null);
    setShowPrintsMenu(false);
    setShowPrintsMenu(false);
    
    // Obter cards do library do jogador, ordenadas por stackIndex (descendente - topo primeiro)
    const currentBoard = useGameStore.getState().board;
    const libraryCards = currentBoard
      .filter((c) => c.zone === 'library' && c.ownerId === card.ownerId)
      .sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));
    
    if (libraryCards.length === 0) {
      alert('There are no cards in the deck.');
      return;
    }
    
    const revealedCards: CardOnBoard[] = [];
    
    // Revelar cards uma por uma até encontrar uma carta com CMC <= cascadeValue
    for (const libraryCard of libraryCards) {
      const cardMana = parseManaCost(libraryCard.manaCost);
      revealedCards.push(libraryCard);
      
      // Se mostrar cada carta, fazer zoom e pausa
      if (showEachCard) {
        // Mostrar carta temporariamente (sincronizado para todos os jogadores)
        setZoomedCardSync(libraryCard.id);
        addEventLog('CASCADE_REVEAL', `Cascade: Revelando ${libraryCard.name} (CMC: ${cardMana})`, libraryCard.id, libraryCard.name, {
          cardMana,
          cascadeValue,
        });
        
        // Pausa para ver a carta (1 segundo)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        // Apenas logar sem mostrar
        addEventLog('CASCADE_REVEAL', `Cascade: Revelando ${libraryCard.name} (CMC: ${cardMana})`, libraryCard.id, libraryCard.name, {
          cardMana,
          cascadeValue,
        });
      }
      
      // Se o CMC desta carta for <= cascadeValue, parar (jogar esta carta)
      if (cardMana <= cascadeValue) {
        break;
      }
    }
    
    // Fechar zoom se estava mostrando cards
    if (showEachCard) {
      setZoomedCardSync(null);
    }
    
    if (revealedCards.length === 0) {
      alert('No cards were revealed.');
      return;
    }
    
    // A última carta vai para o board
    const lastCard = revealedCards[revealedCards.length - 1];
    const otherCards = revealedCards.slice(0, -1);
    
    // Calcular posição no board (centro do board em coordenadas base)
    const position: Point = {
      x: BASE_BOARD_WIDTH / 2 - CARD_WIDTH / 2,
      y: BASE_BOARD_HEIGHT / 2 - CARD_HEIGHT / 2,
    };
    
    // Mover última carta para o board
    const lastCardMana = parseManaCost(lastCard.manaCost);
    addEventLog('CASCADE_PLAY', `Cascade: Jogando ${lastCard.name} no board (CMC: ${lastCardMana})`, lastCard.id, lastCard.name, {
      cardMana: lastCardMana,
      cascadeValue,
    });
    changeCardZone(lastCard.id, 'battlefield', position);
    
    // Mover outras cards para o fundo do deck
    for (const otherCard of otherCards) {
      const libraryPos = getLibraryPosition(card.ownerId);
      const libraryPosition = libraryPos || { x: 0, y: 0 };
      addEventLog('CASCADE_BOTTOM', `Cascade: ${otherCard.name} vai para o fundo do deck`, otherCard.id, otherCard.name);
      changeCardZone(otherCard.id, 'library', libraryPosition, 'bottom');
    }
    
    // Pequena pausa antes de finalizar
    await new Promise((resolve) => setTimeout(resolve, 500));
  };

  const handleShowToOthers = () => {
    if (!contextMenu) return;
    setZoomedCardSync(contextMenu.card.id);
    setContextMenu(null);
    setShowPrintsMenu(false);
    setShowPrintsMenu(false);
  };

  const handleContextMenuAction = async (
    action: 'cemetery' | 'remove' | 'shuffle' | 'tap' | 'draw' | 'moveZone' | 'libraryPlace' | 'flip' | 'createCounter' | 'cascade' | 'setCommander' | 'sendCommander' | 'createCopy' | 'changePrint',
    targetZone?: 'hand' | 'battlefield' | 'library' | 'cemetery' | 'exile' | 'commander' | 'tokens',
    libraryPlace?: 'top' | 'bottom' | 'random',
    counterType?: 'numeral' | 'plus'
  ) => {
    if (!contextMenu) return;
    
    const { card } = contextMenu;
    
    if (action === 'shuffle') {
      // Shuffle apenas se for library e for do jogador
      if (card.zone === 'library' && canInteractWithCard(card.ownerId)) {
        addEventLog('SHUFFLE_LIBRARY', `Embaralhando library`, undefined, undefined, {
          playerName: card.ownerId,
        });
        shuffleLibrary(card.ownerId);
      }
    } else if (action === 'tap') {
      // Tap/Untap
    if (canInteractWithCard(card.ownerId)) {
        addEventLog('TOGGLE_TAP', `${card.tapped ? 'Untap' : 'Tap'}: ${card.name}`, card.id, card.name, {
          from: card.tapped ? 'tapped' : 'untapped',
          to: card.tapped ? 'untapped' : 'tapped',
        });
        toggleTap(card.id);
      }
    } else if (action === 'draw') {
      // Draw - apenas para library
      if (card.zone === 'library' && canInteractWithCard(card.ownerId)) {
        addEventLog('DRAW_FROM_LIBRARY', 'Comprando carta da library', undefined, undefined, {
          playerName: card.ownerId,
        });
        drawFromLibrary();
      }
    } else if (action === 'setCommander') {
      if (card.ownerId === playerName) {
        const commanderPos = getCommanderPosition(card.ownerId);
        const position = commanderPos || { x: 0, y: 0 };
        addEventLog('SET_COMMANDER', `Set commander: ${card.name}`, card.id, card.name, {
          position,
        });
        setCommander(card.id, position);
      }
    } else if (action === 'sendCommander') {
      if (card.ownerId === playerName && card.isCommander && card.zone !== 'commander') {
        const commanderPos = getCommanderPosition(card.ownerId);
        const position = commanderPos || { x: 0, y: 0 };
        addEventLog('SEND_COMMANDER', `Send to commander zone: ${card.name}`, card.id, card.name, {
          from: card.zone,
          to: 'commander',
          position,
        });
        changeCardZone(card.id, 'commander', position);
      }
    } else if (action === 'moveZone' && targetZone) {
      // Mover de zona (não inclui library aqui)
      if (card.ownerId === playerName && card.zone !== targetZone) {
        if (targetZone === 'cemetery') {
          // Cemetery = mover para cemitério (não remover)
          const cemeteryPos = getCemeteryPosition(card.ownerId);
          const position = cemeteryPos || { x: 0, y: 0 };
          
          addEventLog('CHANGE_ZONE', `Mudando para cemitério: ${card.name}`, card.id, card.name, {
            from: card.zone,
            to: 'cemetery',
            position,
          });
          changeCardZone(card.id, 'cemetery', position);
        } else if (targetZone === 'exile') {
          const exilePos = getExilePosition(card.ownerId);
          const position = exilePos || { x: 0, y: 0 };
          
          addEventLog('CHANGE_ZONE', `Mudando para exílio: ${card.name}`, card.id, card.name, {
            from: card.zone,
            to: 'exile',
            position,
          });
          changeCardZone(card.id, 'exile', position);
        } else if (targetZone === 'commander') {
          const commanderPos = getCommanderPosition(card.ownerId);
          const position = commanderPos || { x: 0, y: 0 };
          addEventLog('CHANGE_ZONE', `Mudando para commander: ${card.name}`, card.id, card.name, {
            from: card.zone,
            to: 'commander',
            position,
          });
          changeCardZone(card.id, 'commander', position);
        } else if (targetZone === 'tokens') {
          const tokensPos = getTokensPosition(card.ownerId);
          const position = tokensPos || { x: 0, y: 0 };
          addEventLog('CHANGE_ZONE', `Mudando para tokens: ${card.name}`, card.id, card.name, {
            from: card.zone,
            to: 'tokens',
            position,
          });
          changeCardZone(card.id, 'tokens', position);
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
      if (canInteractWithCard(card.ownerId)) {
        const libraryPos = getLibraryPosition(card.ownerId);
        const position = libraryPos || { x: 0, y: 0 };
        
        addEventLog('CHANGE_ZONE', `Mudando para library (${libraryPlace}): ${card.name}`, card.id, card.name, {
          from: card.zone,
          to: 'library',
          libraryPlace,
        });
        changeCardZone(card.id, 'library', position, libraryPlace);
      }
    } else if (action === 'createCopy') {
      if (canInteractWithCard(card.ownerId)) {
        addEventLog('CREATE_COPY', `Creating copy: ${card.name}`, card.id, card.name, {
          zone: card.zone,
        });
        addCardToBoard({
          name: card.name,
          oracleText: card.oracleText,
          manaCost: card.manaCost,
          typeLine: card.typeLine,
          setName: card.setName,
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
          deckSection: card.deckSection,
          deckTag: card.deckTag,
          deckFlags: card.deckFlags,
          finishTags: card.finishTags,
          imageUrl: card.imageUrl,
          backImageUrl: card.backImageUrl,
          position: { x: card.position.x, y: card.position.y },
        });
      }
    } else if (action === 'changePrint') {
      if (!canInteractWithCard(card.ownerId)) return;
      setPrintsLoading(true);
      setPrintsError(null);
      setShowPrintsMenu(true);
      setPrintsCardId(card.id);
      try {
        const prints = await fetchCardPrints(card.name);
        const metaById: Record<string, { setCode?: string; collectorNumber?: string }> = {};
        const mapped = prints.map((print) => {
          const setCode = print.setCode?.toUpperCase() ?? '??';
          const collector = print.collectorNumber ?? '';
          const label = `${print.setName ?? setCode} ${collector ? `#${collector}` : ''}`.trim();
          const id = `${print.setCode ?? ''}:${print.collectorNumber ?? ''}:${print.setName ?? ''}:${print.imageUrl ?? ''}`;
          metaById[id] = { setCode: print.setCode, collectorNumber: print.collectorNumber };
          return {
            id,
            label,
            imageUrl: print.imageUrl,
            backImageUrl: print.backImageUrl,
            setName: print.setName,
          };
        });
        setPrintsOptions(mapped);
        setPrintsMetaById(metaById);
        setPrintsSelection(mapped[0]?.id ?? null);
      } catch (err) {
        setPrintsError(err instanceof Error ? err.message : 'Failed to load prints');
      } finally {
        setPrintsLoading(false);
      }
      return;
    } else if (action === 'flip') {
      // Transform card
      if (canInteractWithCard(card.ownerId)) {
        const newFlipped = !card.flipped;
        addEventLog('FLIP_CARD', `Transform card: ${card.name}`, card.id, card.name, {
          flipped: newFlipped,
        });
        flipCard(card.id);
      }
    } else if (action === 'createCounter' && counterType) {
      // Criar contador no board (posição do clique do menu de contexto)
      if (contextMenu && boardRef.current) {
        // Converter posição do menu (tela) para posição no board
        const boardRect = boardRef.current.getBoundingClientRect();
        const scale = getBoardScale();
        const offsetX = (boardRect.width - BASE_BOARD_WIDTH * scale) / 2;
        const offsetY = (boardRect.height - BASE_BOARD_HEIGHT * scale) / 2;
        
        // Converter coordenadas da tela para coordenadas do board escalado
        const boardX = (contextMenu.x - boardRect.left - offsetX) / scale;
        const boardY = (contextMenu.y - boardRect.top - offsetY) / scale;
        
        const position: Point = { x: boardX, y: boardY };
        addEventLog('CREATE_COUNTER', `Criando contador ${counterType}`, undefined, undefined, {
          counterType,
          position,
        });
        createCounter(playerName, counterType, position);
      }
    } else {
      // Cemetery ou Remove - ambos deletam
      if (canInteractWithCard(card.ownerId)) {
        const actionName = action === 'cemetery' ? 'Cemetery' : 'Remove';
        addEventLog('REMOVE_CARD', `${actionName}: ${card.name}`, card.id, card.name, {
        zone: card.zone,
          ownerId: card.ownerId,
          action,
      });
      removeCard(card.id);
      }
    }
    
    setContextMenu(null);
    setShowPrintsMenu(false);
    setContextSubmenu(null);
    setContextMenuPosition(null);
  };
  
  // Fechar menu ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Verificar se o clique foi fora do menu e submenu
      // Não fechar se o clique foi em um botão dentro do menu ou submenu
      const isInsideMenu = target.closest('[data-context-menu]');
      const isInsideSubmenu = target.closest('[data-context-submenu]');
      const isInsideBoardMenu = target.closest('[data-board-context-menu]');
      
      // Se está dentro do menu ou submenu, não fechar
      if (isInsideMenu || isInsideSubmenu || isInsideBoardMenu) {
        return;
      }
      
      // Verificar se o clique foi em um botão que está dentro do menu/submenu
      // Isso é necessário porque o botão pode estar em um submenu aninhado
      const clickedButton = target.closest('button');
      if (clickedButton) {
        const buttonInMenu = clickedButton.closest('[data-context-menu]');
        const buttonInSubmenu = clickedButton.closest('[data-context-submenu]');
        const buttonInBoardMenu = clickedButton.closest('[data-board-context-menu]');
        if (buttonInMenu || buttonInSubmenu || buttonInBoardMenu) {
          return;
        }
      }
      
      // Se clicou fora, fechar tudo
      if (contextMenu) {
        setContextMenu(null);
        setShowPrintsMenu(false);
        setContextSubmenu(null);
        setContextSubmenuLibrary(false);
        setContextMenuPosition(null);
      }
      
      if (boardContextMenu) {
        setBoardContextMenu(null);
        setBoardContextMenuPosition(null);
      }
    };
    
    if (contextMenu || boardContextMenu) {
      // Usar um pequeno delay para não fechar imediatamente quando abrir o submenu
      // Usar 'click' sem capture phase para dar tempo do evento do botão processar primeiro
      const timeoutId = setTimeout(() => {
        document.addEventListener('click', handleClickOutside, false);
      }, 200);
      
      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener('click', handleClickOutside, false);
      };
    }
  }, [contextMenu, boardContextMenu, contextSubmenu, contextSubmenuLibrary]);

  const startLibraryDrag = (targetPlayerName: string, event: ReactPointerEvent) => {
    if (targetPlayerName !== playerName) return;
    if ((event.target as HTMLElement).closest('button')) return;
    // Não iniciar drag com botão direito (button 2)
    if (event.button === 2) return;
    // Se Shift estiver pressionado, não iniciar drag do stack (deixar o Library component lidar com carta individual)
    if (event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (!boardRef.current) return;

    // Resetar flags ao iniciar novo drag
    libraryClickExecutedRef.current = false;
    libraryMovedRef.current = false;

    const rect = boardRef.current.getBoundingClientRect();
    const libraryPos = getLibraryPosition(targetPlayerName);
    if (!libraryPos) return;

    // Converter coordenadas do mouse baseado no modo
    let cursorX, cursorY;
    if (viewMode === 'separated') {
      // Modo separated: usar função auxiliar específica
      const coords = convertMouseToSeparatedCoordinates(
        event.clientX,
        event.clientY,
        targetPlayerName,
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
      // Modo individual: usar função auxiliar específica
      const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
      cursorX = coords.x;
      cursorY = coords.y;
    }

    const offsetX = cursorX - libraryPos.x;
    const offsetY = cursorY - libraryPos.y;

    setLibraryMoved(false);
    setDraggingLibrary({
      playerName: targetPlayerName,
      offsetX,
      offsetY,
      startX: event.clientX,
      startY: event.clientY,
    });
  };

  const pendingLibraryPositionRef = useRef<{
    playerName: string;
    relativePosition: Point;
    absolutePosition: Point;
  } | null>(null);

  useEffect(() => {
    if (!draggingLibrary || !boardRef.current) {
      if (libraryMoved) {
        setLibraryMoved(false);
      }
      return;
    }

    const handleMove = (event: PointerEvent) => {
      // Atualização imediata sem requestAnimationFrame para evitar atraso de 1 frame
      const deltaX = Math.abs(event.clientX - draggingLibrary.startX);
      const deltaY = Math.abs(event.clientY - draggingLibrary.startY);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        setLibraryMoved(true);
        libraryMovedRef.current = true; // Usar ref para garantir que está atualizado
        // Garantir que a flag seja setada imediatamente para evitar draw
        libraryClickExecutedRef.current = true;
      }

      const rect = boardRef.current!.getBoundingClientRect();
      if (!rect) return;
      
      let cursorX = event.clientX - rect.left;
      let cursorY = event.clientY - rect.top;
      
      // Converter coordenadas do mouse baseado no modo
      if (viewMode === 'separated') {
        // Modo separated: usar função auxiliar específica
        const coords = convertMouseToSeparatedCoordinates(
          event.clientX,
          event.clientY,
          draggingLibrary.playerName,
          rect
        );
        if (!coords) {
          // Se não está na janela do player correto, manter posição atual
          return;
        }
        cursorX = coords.x;
        cursorY = coords.y;
      } else {
        // Modo individual: usar função auxiliar específica
        const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
        cursorX = coords.x;
        cursorY = coords.y;
      }
      
      const x = cursorX - draggingLibrary.offsetX;
      const y = cursorY - draggingLibrary.offsetY;

      // Clamp dentro da área
      const playerArea = getPlayerArea(draggingLibrary.playerName);
      if (!playerArea) return;
      
      let clampedX = Math.max(
        playerArea.x,
        Math.min(playerArea.x + playerArea.width - LIBRARY_CARD_WIDTH, x)
      );
      let clampedY = Math.max(
        playerArea.y,
        Math.min(playerArea.y + playerArea.height - LIBRARY_CARD_HEIGHT, y)
      );

      const relativePosition = {
        x: clampedX - playerArea.x,
        y: clampedY - playerArea.y,
      };

      setLibraryPositions((prev) => ({
        ...prev,
        [draggingLibrary.playerName]: { x: clampedX, y: clampedY },
      }));
      librarySyncLockRef.current = {
        ...librarySyncLockRef.current,
        [draggingLibrary.playerName]: { x: clampedX, y: clampedY },
      };
      pendingLibraryPositionRef.current = {
        playerName: draggingLibrary.playerName,
        relativePosition,
        absolutePosition: { x: clampedX, y: clampedY },
      };
      moveLibrary(
        draggingLibrary.playerName,
        relativePosition,
        { x: clampedX, y: clampedY },
        true
      );
    };

    const stopDrag = (event?: PointerEvent) => {
      // CRÍTICO: Só fazer draw se NÃO moveu (foi apenas um clique)
      // Usar tanto o estado quanto a ref para garantir que detecta movimento
      const actuallyMoved = libraryMoved || libraryMovedRef.current;
      
      // Log movimento do library se realmente moveu
      if (actuallyMoved && draggingLibrary) {
        const playerName = draggingLibrary.playerName;
        const pending = pendingLibraryPositionRef.current;
        const absolutePosition =
          pending && pending.playerName === playerName
            ? pending.absolutePosition
            : libraryPositions[playerName];
        
        if (absolutePosition) {
          const playerArea = getPlayerArea(playerName);
          const relativePosition = {
            x: absolutePosition.x - (playerArea?.x || 0),
            y: absolutePosition.y - (playerArea?.y || 0),
          };
          
          // Garantir que a posição final seja aplicada localmente antes de salvar
          setLibraryPositions((prev) => ({
            ...prev,
            [playerName]: absolutePosition,
          }));
          librarySyncLockRef.current = {
            ...librarySyncLockRef.current,
            [playerName]: absolutePosition,
          };
          
          // Salvar posição final no banco (skipEventSave = false)
          moveLibrary(playerName, relativePosition, absolutePosition, false);
          
          addEventLog('MOVE_LIBRARY', `Moving library: ${playerName}`, undefined, undefined, {
            playerName,
            position: relativePosition,
          });
        }
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
        handleLibraryClick(draggingLibrary.playerName);
          // Resetar flag após um pequeno delay
          setTimeout(() => {
            libraryClickExecutedRef.current = false;
          }, 100);
      }
      }
      
      // Limpar estado de drag
      // Se não moveu, ainda precisamos limpar o rastreamento no store
      if (draggingLibrary && !actuallyMoved) {
        const playerName = draggingLibrary.playerName;
        const currentPosition = libraryPositions[playerName];
        if (currentPosition) {
          // Chamar moveLibrary com skipEventSave = false para limpar o rastreamento
          const playerArea = getPlayerArea(playerName);
          if (playerArea) {
            moveLibrary(playerName, currentPosition, {
              x: currentPosition.x + playerArea.x,
              y: currentPosition.y + playerArea.y,
            }, false);
          }
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
  }, [draggingLibrary, moveLibrary, playerName, libraryMoved, viewMode, players]);

  // Sistema de drag para cemitério
  const startCemeteryDrag = (targetPlayerName: string, event: ReactPointerEvent) => {
    
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    // Não iniciar drag com botão direito (button 2)
    if (event.button === 2) {
      return;
    }
    // A verificação de permissão já é feita no componente Cemetery
    event.preventDefault();
    if (!boardRef.current) {
      return;
    }

    // Resetar flags ao iniciar novo drag
    cemeteryMovedRef.current = false;

    const rect = boardRef.current.getBoundingClientRect();
    let cemeteryPos = getCemeteryPosition(targetPlayerName);
    
    // Se não encontrou posição, calcular uma posição padrão
    if (!cemeteryPos) {
      const CEMETERY_CARD_WIDTH = 100;
      const CEMETERY_CARD_HEIGHT = 140;
      const playerIndex = allPlayers.findIndex((p) => p.name === targetPlayerName);
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
        targetPlayerName,
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
      // Modo individual: usar função auxiliar específica
      const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
      cursorX = coords.x;
      cursorY = coords.y;
    }
    
    // Ambos estão em pixels
    const offsetX = cursorX - cemeteryPos.x;
    const offsetY = cursorY - cemeteryPos.y;

    setCemeteryMoved(false);
    setDraggingCemetery({
      playerName: targetPlayerName,
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
      
      // Converter coordenadas do mouse baseado no modo
      if (viewMode === 'separated') {
        // Modo separated: usar função auxiliar específica
        const coords = convertMouseToSeparatedCoordinates(
          event.clientX,
          event.clientY,
          draggingCemetery.playerName,
          rect
        );
        if (!coords) {
          // Se não está na janela do player correto, manter posição atual
          return;
        }
        cursorX = coords.x;
        cursorY = coords.y;
      } else {
        // Modo individual: usar função auxiliar específica
        const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
        cursorX = coords.x;
        cursorY = coords.y;
      }
      
      const x = cursorX - draggingCemetery.offsetX;
      const y = cursorY - draggingCemetery.offsetY;

      // Clamp dentro da área - se estiver fora, limitar aos limites
      const CEMETERY_CARD_WIDTH = 100;
      const CEMETERY_CARD_HEIGHT = 140;
      const playerArea = getPlayerArea(draggingCemetery.playerName);
      const maxX = playerArea ? playerArea.x + playerArea.width - CEMETERY_CARD_WIDTH : rect.width - CEMETERY_CARD_WIDTH;
      const maxY = playerArea ? playerArea.y + playerArea.height - CEMETERY_CARD_HEIGHT : rect.height - CEMETERY_CARD_HEIGHT;
      const minX = playerArea ? playerArea.x : 0;
      const minY = playerArea ? playerArea.y : 0;
      
      const clampedX = Math.max(minX, Math.min(maxX, x));
      const clampedY = Math.max(minY, Math.min(maxY, y));

      // Atualizar posição local imediatamente para feedback visual
      setCemeteryPositions((prev) => ({
        ...prev,
        [draggingCemetery.playerName]: { x: clampedX, y: clampedY },
      }));

      // Sincronizar com os peers durante o drag (sem salvar evento)
      // skipEventSave = true para não salvar eventos intermediários
      moveCemetery(draggingCemetery.playerName, { x: clampedX, y: clampedY }, true);
    };

    const stopDrag = () => {
      // Se realmente moveu, salvar a posição final no banco
      if (cemeteryMovedRef.current && draggingCemetery) {
        const playerName = draggingCemetery.playerName;
        const finalPosition = cemeteryPositions[playerName];
        
        if (finalPosition) {
          // Salvar posição final no banco (skipEventSave = false)
          moveCemetery(playerName, finalPosition, false);
          
          addEventLog('MOVE_CEMETERY', `Moving cemetery: ${playerName}`, undefined, undefined, {
            playerName,
            position: finalPosition,
          });
        }
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
  }, [draggingCemetery, moveCemetery, playerName, cemeteryMoved, viewMode, players, getPlayerArea, cemeteryPositions, addEventLog]);

  const exileMovedRef = useRef<boolean>(false);
  const [exilePositions, setExilePositions] = useState<Record<string, Point>>({});
  const commanderMovedRef = useRef<boolean>(false);
  const [commanderPositions, setCommanderPositions] = useState<Record<string, Point>>({});
  const tokensMovedRef = useRef<boolean>(false);
  const [tokensPositions, setTokensPositions] = useState<Record<string, Point>>({});

  useEffect(() => {
    if (draggingExile) {
      return;
    }
    setExilePositions(storeExilePositions);
  }, [storeExilePositions, draggingExile]);

  useEffect(() => {
    if (draggingCommander) {
      return;
    }
    setCommanderPositions(storeCommanderPositions);
  }, [storeCommanderPositions, draggingCommander]);

  useEffect(() => {
    if (draggingTokens) {
      return;
    }
    setTokensPositions(storeTokensPositions);
  }, [storeTokensPositions, draggingTokens]);

  // Sistema de drag para exílio
  const startExileDrag = (targetPlayerName: string, event: ReactPointerEvent) => {
    
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    if (event.button === 2) {
      return;
    }
    event.preventDefault();
    if (!boardRef.current) {
      return;
    }

    exileMovedRef.current = false;

    const rect = boardRef.current.getBoundingClientRect();
    let exilePos = getExilePosition(targetPlayerName);
    
    if (!exilePos) {
      const EXILE_CARD_HEIGHT = 140;
      const area = getPlayerArea(targetPlayerName);
      exilePos = area ? {
        x: area.x + area.width - 150 - 120,
        y: area.y + (area.height / 2) - (EXILE_CARD_HEIGHT / 2),
      } : { x: 0, y: 0 };
    }

    // Converter coordenadas do mouse baseado no modo
    let cursorX, cursorY;
    if (viewMode === 'separated') {
      const coords = convertMouseToSeparatedCoordinates(
        event.clientX,
        event.clientY,
        targetPlayerName,
        rect
      );
      if (coords) {
        cursorX = coords.x;
        cursorY = coords.y;
      } else {
        const fallback = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
        cursorX = fallback.x;
        cursorY = fallback.y;
      }
    } else {
      const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
      cursorX = coords.x;
      cursorY = coords.y;
    }

    const offsetX = cursorX - exilePos.x;
    const offsetY = cursorY - exilePos.y;

    setDraggingExile({
      playerName: targetPlayerName,
      offsetX,
      offsetY,
      startX: event.clientX,
      startY: event.clientY,
    });
  };

  // Sistema de drag para commander
  const startCommanderDrag = (targetPlayerName: string, event: ReactPointerEvent) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    if (event.button === 2) {
      return;
    }
    event.preventDefault();
    if (!boardRef.current) {
      return;
    }

    commanderMovedRef.current = false;

    const rect = boardRef.current.getBoundingClientRect();
    let commanderPos = getCommanderPosition(targetPlayerName);
    if (!commanderPos) {
      const area = getPlayerArea(targetPlayerName);
      commanderPos = area ? { x: area.x + 20, y: area.y + 20 } : { x: 0, y: 0 };
    }

    let cursorX: number;
    let cursorY: number;
    if (viewMode === 'separated') {
      const coords = convertMouseToSeparatedCoordinates(
        event.clientX,
        event.clientY,
        targetPlayerName,
        rect
      );
      if (coords) {
        cursorX = coords.x;
        cursorY = coords.y;
      } else {
        const fallback = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
        cursorX = fallback.x;
        cursorY = fallback.y;
      }
    } else {
      const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
      cursorX = coords.x;
      cursorY = coords.y;
    }

    const offsetX = cursorX - commanderPos.x;
    const offsetY = cursorY - commanderPos.y;

    setDraggingCommander({
      playerName: targetPlayerName,
      offsetX,
      offsetY,
      startX: event.clientX,
      startY: event.clientY,
    });
  };

  const startTokensDrag = (targetPlayerName: string, event: ReactPointerEvent) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    if (event.button === 2) {
      return;
    }
    event.preventDefault();
    if (!boardRef.current) {
      return;
    }

    tokensMovedRef.current = false;

    const rect = boardRef.current.getBoundingClientRect();
    let tokensPos = getTokensPosition(targetPlayerName);
    if (!tokensPos) {
      const area = getPlayerArea(targetPlayerName);
      tokensPos = area ? { x: area.x + 20, y: area.y + 200 } : { x: 0, y: 0 };
    }

    let cursorX: number;
    let cursorY: number;
    if (viewMode === 'separated') {
      const coords = convertMouseToSeparatedCoordinates(
        event.clientX,
        event.clientY,
        targetPlayerName,
        rect
      );
      if (coords) {
        cursorX = coords.x;
        cursorY = coords.y;
      } else {
        const fallback = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
        cursorX = fallback.x;
        cursorY = fallback.y;
      }
    } else {
      const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
      cursorX = coords.x;
      cursorY = coords.y;
    }

    const offsetX = cursorX - tokensPos.x;
    const offsetY = cursorY - tokensPos.y;

    setDraggingTokens({
      playerName: targetPlayerName,
      offsetX,
      offsetY,
      startX: event.clientX,
      startY: event.clientY,
    });
  };

  useEffect(() => {
    if (!draggingExile) return;

    const handleMove = (event: PointerEvent) => {
      if (!boardRef.current || !draggingExile) return;
      
      const rect = boardRef.current.getBoundingClientRect();
      let cursorX: number;
      let cursorY: number;

      if (viewMode === 'separated') {
        const coords = convertMouseToSeparatedCoordinates(event.clientX, event.clientY, draggingExile.playerName, rect);
        if (coords) {
          cursorX = coords.x;
          cursorY = coords.y;
        } else {
          const fallback = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
          cursorX = fallback.x;
          cursorY = fallback.y;
        }
      } else {
        const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
        cursorX = coords.x;
        cursorY = coords.y;
      }
      
      const x = cursorX - draggingExile.offsetX;
      const y = cursorY - draggingExile.offsetY;

      const EXILE_CARD_WIDTH = 100;
      const EXILE_CARD_HEIGHT = 140;
      const playerArea = getPlayerArea(draggingExile.playerName);
      const maxX = playerArea ? playerArea.x + playerArea.width - EXILE_CARD_WIDTH : rect.width - EXILE_CARD_WIDTH;
      const maxY = playerArea ? playerArea.y + playerArea.height - EXILE_CARD_HEIGHT : rect.height - EXILE_CARD_HEIGHT;
      const minX = playerArea ? playerArea.x : 0;
      const minY = playerArea ? playerArea.y : 0;
      
      const clampedX = Math.max(minX, Math.min(maxX, x));
      const clampedY = Math.max(minY, Math.min(maxY, y));

      const deltaX = Math.abs(event.clientX - draggingExile.startX);
      const deltaY = Math.abs(event.clientY - draggingExile.startY);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        exileMovedRef.current = true;
      }

      setExilePositions((prev) => ({
        ...prev,
        [draggingExile.playerName]: { x: clampedX, y: clampedY },
      }));

      moveExile(draggingExile.playerName, { x: clampedX, y: clampedY }, true);
    };

    const stopDrag = () => {
      if (exileMovedRef.current && draggingExile) {
        const finalPosition = exilePositions[draggingExile.playerName];
        if (finalPosition) {
          moveExile(draggingExile.playerName, finalPosition, false);
          addEventLog('MOVE_EXILE', `Moving exile: ${draggingExile.playerName}`, undefined, undefined, {
            playerName: draggingExile.playerName,
            position: finalPosition,
          });
        }
      }
      setDraggingExile(null);
      exileMovedRef.current = false;
    };

    const handleUp = () => stopDrag();
    
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [draggingExile, moveExile, playerName, viewMode, players, getPlayerArea, exilePositions, addEventLog, convertMouseToSeparatedCoordinates, convertMouseToUnifiedCoordinates]);

  useEffect(() => {
    if (!draggingCommander) return;

    const handleMove = (event: PointerEvent) => {
      if (!boardRef.current || !draggingCommander) return;
      const rect = boardRef.current.getBoundingClientRect();
      let cursorX: number;
      let cursorY: number;

      if (viewMode === 'separated') {
        const coords = convertMouseToSeparatedCoordinates(event.clientX, event.clientY, draggingCommander.playerName, rect);
        if (coords) {
          cursorX = coords.x;
          cursorY = coords.y;
        } else {
          const fallback = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
          cursorX = fallback.x;
          cursorY = fallback.y;
        }
      } else {
        const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
        cursorX = coords.x;
        cursorY = coords.y;
      }

      const x = cursorX - draggingCommander.offsetX;
      const y = cursorY - draggingCommander.offsetY;

      const COMMANDER_CARD_WIDTH = 100;
      const COMMANDER_CARD_HEIGHT = 140;
      const playerArea = getPlayerArea(draggingCommander.playerName);
      const maxX = playerArea ? playerArea.x + playerArea.width - COMMANDER_CARD_WIDTH : rect.width - COMMANDER_CARD_WIDTH;
      const maxY = playerArea ? playerArea.y + playerArea.height - COMMANDER_CARD_HEIGHT : rect.height - COMMANDER_CARD_HEIGHT;
      const minX = playerArea ? playerArea.x : 0;
      const minY = playerArea ? playerArea.y : 0;

      const clampedX = Math.max(minX, Math.min(maxX, x));
      const clampedY = Math.max(minY, Math.min(maxY, y));

      const deltaX = Math.abs(event.clientX - draggingCommander.startX);
      const deltaY = Math.abs(event.clientY - draggingCommander.startY);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        commanderMovedRef.current = true;
      }

      setCommanderPositions((prev) => ({
        ...prev,
        [draggingCommander.playerName]: { x: clampedX, y: clampedY },
      }));
      moveCommander(draggingCommander.playerName, { x: clampedX, y: clampedY }, true);
    };

    const stopDrag = () => {
      if (commanderMovedRef.current && draggingCommander) {
        const finalPosition = commanderPositions[draggingCommander.playerName];
        if (finalPosition) {
          moveCommander(draggingCommander.playerName, finalPosition, false);
          addEventLog('MOVE_COMMANDER', `Moving commander: ${draggingCommander.playerName}`, undefined, undefined, {
            playerName: draggingCommander.playerName,
            position: finalPosition,
          });
        }
      }
      setDraggingCommander(null);
      commanderMovedRef.current = false;
    };

    const handleUp = () => stopDrag();

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [draggingCommander, moveCommander, playerName, viewMode, players, getPlayerArea, commanderPositions, addEventLog, convertMouseToSeparatedCoordinates, convertMouseToUnifiedCoordinates]);

  useEffect(() => {
    if (!draggingTokens) return;

    const handleMove = (event: PointerEvent) => {
      if (!boardRef.current || !draggingTokens) return;
      const rect = boardRef.current.getBoundingClientRect();
      let cursorX: number;
      let cursorY: number;

      if (viewMode === 'separated') {
        const coords = convertMouseToSeparatedCoordinates(event.clientX, event.clientY, draggingTokens.playerName, rect);
        if (coords) {
          cursorX = coords.x;
          cursorY = coords.y;
        } else {
          const fallback = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
          cursorX = fallback.x;
          cursorY = fallback.y;
        }
      } else {
        const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
        cursorX = coords.x;
        cursorY = coords.y;
      }

      const x = cursorX - draggingTokens.offsetX;
      const y = cursorY - draggingTokens.offsetY;

      const TOKENS_CARD_WIDTH = 100;
      const TOKENS_CARD_HEIGHT = 140;
      const playerArea = getPlayerArea(draggingTokens.playerName);
      const maxX = playerArea ? playerArea.x + playerArea.width - TOKENS_CARD_WIDTH : rect.width - TOKENS_CARD_WIDTH;
      const maxY = playerArea ? playerArea.y + playerArea.height - TOKENS_CARD_HEIGHT : rect.height - TOKENS_CARD_HEIGHT;
      const minX = playerArea ? playerArea.x : 0;
      const minY = playerArea ? playerArea.y : 0;

      const clampedX = Math.max(minX, Math.min(maxX, x));
      const clampedY = Math.max(minY, Math.min(maxY, y));

      const deltaX = Math.abs(event.clientX - draggingTokens.startX);
      const deltaY = Math.abs(event.clientY - draggingTokens.startY);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        tokensMovedRef.current = true;
      }

      setTokensPositions((prev) => ({
        ...prev,
        [draggingTokens.playerName]: { x: clampedX, y: clampedY },
      }));
      moveTokens(draggingTokens.playerName, { x: clampedX, y: clampedY }, true);
    };

    const stopDrag = () => {
      if (tokensMovedRef.current && draggingTokens) {
        const finalPosition = tokensPositions[draggingTokens.playerName];
        if (finalPosition) {
          moveTokens(draggingTokens.playerName, finalPosition, false);
          addEventLog('MOVE_TOKENS', `Moving tokens: ${draggingTokens.playerName}`, undefined, undefined, {
            playerName: draggingTokens.playerName,
            position: finalPosition,
          });
        }
      }
      setDraggingTokens(null);
      tokensMovedRef.current = false;
    };

    const handleUp = () => stopDrag();

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [draggingTokens, moveTokens, playerName, viewMode, players, getPlayerArea, tokensPositions, addEventLog, convertMouseToSeparatedCoordinates, convertMouseToUnifiedCoordinates]);

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
  const renderBoardContent = useCallback(() => {
    const boardViewProps: BoardViewProps = {
      boardRef,
      board,
      allPlayers,
      playerId,
      playerName,
      battlefieldCards,
      libraryCards,
      cemeteryCards,
      exileCards,
      commanderCards,
      tokensCards,
      storeLibraryPositions,
      storeCemeteryPositions,
      storeExilePositions,
      storeCommanderPositions,
      storeTokensPositions,
      showHand,
      dragStateRef,
      draggingLibrary,
      draggingCemetery,
      draggingExile,
      draggingCommander,
      draggingTokens,
      ownerName,
      handleCardClick,
      handleCardContextMenu,
      handleCardZoom,
      startDrag,
      zoomedCard,
      setZoomedCard,
      setLibraryContainerRef,
      startLibraryDrag,
      startCemeteryDrag,
      startExileDrag,
      startCommanderDrag,
      startTokensDrag,
      changeCardZone,
      detectZoneAtPosition,
      reorderHandCard,
      reorderLibraryCard,
      dragStartedFromHandRef,
      handCardPlacedRef,
      setContextMenu,
      setLastTouchedCard,
      getPlayerArea,
      getLibraryPosition,
      getCemeteryPosition,
      getExilePosition,
      getCommanderPosition,
      getTokensPosition,
      handDragStateRef,
      addEventLog,
      viewMode,
      convertMouseToSeparatedCoordinates,
      convertMouseToUnifiedCoordinates,
      counters,
      moveCounter,
      modifyCounter,
      removeCounterToken,
      flipCard,
    };

    if (viewMode === 'individual') {
      return <BoardIndividual {...boardViewProps} selectedPlayerIndex={selectedPlayerIndex} />;
    } else if (viewMode === 'separated') {
      return <BoardSeparated {...boardViewProps} />;
    } else {
      return <BoardUnified {...boardViewProps} />;
    }
  }, [
    boardRef,
    board,
    allPlayers,
    playerId,
    battlefieldCards,
    libraryCards,
    cemeteryCards,
    exileCards,
    commanderCards,
    tokensCards,
    storeLibraryPositions,
    storeCemeteryPositions,
    storeExilePositions,
    storeCommanderPositions,
    storeTokensPositions,
    showHand,
    dragStateRef,
    draggingLibrary,
    draggingCemetery,
    draggingExile,
    draggingCommander,
    draggingTokens,
    ownerName,
    handleCardClick,
    handleCardContextMenu,
    handleCardZoom,
    startDrag,
    zoomedCard,
    setZoomedCard,
    setLibraryContainerRef,
    startLibraryDrag,
    startCemeteryDrag,
    startExileDrag,
    startCommanderDrag,
    startTokensDrag,
    changeCardZone,
    addCardToBoard,
    detectZoneAtPosition,
    reorderHandCard,
    reorderLibraryCard,
    dragStartedFromHandRef,
    handCardPlacedRef,
    setContextMenu,
    setLastTouchedCard,
    getPlayerArea,
    getLibraryPosition,
    getCemeteryPosition,
    getExilePosition,
    getCommanderPosition,
    getTokensPosition,
    handDragStateRef,
    addEventLog,
    viewMode,
    convertMouseToSeparatedCoordinates,
    convertMouseToUnifiedCoordinates,
    selectedPlayerIndex,
  ]);

  return (
    <div className="board-container">
      {/* Contador de vida dos jogadores no topo */}
      <div
        style={{
          position: 'fixed',
          top: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        {allPlayers.map((player) => {
          const isCurrentPlayer = player.id === playerId;
          return (
            <LifeDisplay
              key={player.id}
              player={player}
              isCurrentPlayer={isCurrentPlayer}
              changePlayerLife={changePlayerLife}
              changeCommanderDamage={changeCommanderDamage}
              allPlayers={allPlayers}
              viewerPlayerId={playerId}
              isHost={isHost}
            />
          );
        })}
      </div>
      
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
          Status: {currentStatus}
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
              onClick={() => {
                setViewMode('individual');
                // Começar com o player atual
                const currentIndex = players.findIndex(p => p.name === playerName);
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
              title="View one player at a time"
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
              title="View all players separately"
            >
              📑 Separated
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
                title="Next player"
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
          {showHand ? 'Hide Hand' : 'Show Hand'}
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
              title="Simulate multiple players"
            >
              {simulatePlayers > 0 ? `👥 Simulate: ${simulatePlayers}` : '👥 Simulate Players'}
            </button>
            {showSimulatePanel && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px', backgroundColor: 'rgba(0, 0, 0, 0.3)', borderRadius: '4px' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>Quantos players simular?</div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {[0, 1, 2, 3, 4, 5, 6].map((num) => (
                    <button
                      key={num}
                      onClick={() => {
                        setSimulatedPlayers(num);
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
        data-board-surface
        ref={boardRef}
        onContextMenu={(e) => {
          const target = e.target as HTMLElement;
          
          // Verificar se o clique foi em um elemento interativo
          const isInteractive = target.closest(
            `.card-token, .battlefield-card, button, .library-stack, .cemetery-stack, .player-area, .hand-card-wrapper, .hand-area, .hand-cards, [data-context-menu], [data-context-submenu], [data-board-context-menu]`
          );
          
          // Verificar se está arrastando
          const isDragging = dragStateRef.current !== null;
          
          // Se clicou em lugar vazio, abrir menu do board
          if (!isInteractive && !draggingCemetery && !draggingLibrary && !isDragging) {
            e.preventDefault();
            e.stopPropagation();
            setBoardContextMenu({ x: e.clientX, y: e.clientY });
          }
        }}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          const isInteractive = target.closest(
            `.card-token, button, .library-stack, .cemetery-stack, .player-area${showHand ? ', .hand-card-wrapper, .hand-area, .hand-cards' : ''}, [data-context-menu], [data-context-submenu], [data-board-context-menu]`
          );
          
          // Fechar menu do board se clicar no board (mas não em elementos interativos)
          if (!isInteractive && !draggingCemetery && !draggingLibrary) {
            if (boardContextMenu) {
              setBoardContextMenu(null);
              setBoardContextMenuPosition(null);
            }
            resetAllDragStates();
          }
        }}
      >
        {/* Container escalado baseado em 1080p (skip for separated view) */}
        {boardRef.current && (viewMode === 'separated'
          ? renderBoardContent()
          : (() => {
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
            })()
        )}
              
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
                        Card: {log.cardName} {log.cardId && `(${log.cardId.slice(0, 8)}...)`}
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
                  <div>Status: <span style={{ color: currentStatus === 'connected' ? '#10b981' : currentStatus === 'waiting' ? '#f59e0b' : '#ef4444' }}>{currentStatus}</span></div>
                  <div>Is Host: <span style={{ color: isHost ? '#10b981' : '#94a3b8' }}>{isHost ? 'Yes' : 'No'}</span></div>
                  <div>Room ID: <span style={{ opacity: 0.7 }}>{roomId || 'N/A'}</span></div>
                  <div>Player ID: <span style={{ opacity: 0.7 }}>{playerId.slice(0, 8)}...</span></div>
                </div>
              </div>

              {/* WebSocket */}
              <div style={{ padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>WebSocket</div>
                <div style={{ fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {socket ? (
                    <>
                      <div>State: <span style={{ opacity: 0.7 }}>{socket.readyState}</span></div>
                      <div>Open: <span style={{ color: socket.readyState === WebSocket.OPEN ? '#10b981' : '#ef4444' }}>{socket.readyState === WebSocket.OPEN ? 'Yes' : 'No'}</span></div>
                    </>
                  ) : (
                    <div style={{ opacity: 0.5, fontStyle: 'italic' }}>Nenhum websocket ativo</div>
                  )}
                </div>
              </div>

              {/* Host Connection */}
              {hostConnection && (
                <div style={{ padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Host Connection</div>
                  <div style={{ fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div>Peer: <span style={{ opacity: 0.7 }}>{hostConnection.peer || 'N/A'}</span></div>
                    <div>Open: <span style={{ color: hostConnection.open ? '#10b981' : '#ef4444' }}>{hostConnection.open ? 'Yes' : 'No'}</span></div>
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
                    <div style={{ opacity: 0.5, fontStyle: 'italic' }}>No client connections</div>
                  ) : (
                    Object.entries(connections).map(([peerId, conn]) => (
                      <div key={peerId} style={{ padding: '6px', backgroundColor: 'rgba(0, 0, 0, 0.3)', borderRadius: '4px', borderLeft: `3px solid ${conn.open ? '#10b981' : '#ef4444'}` }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>Peer: {peerId.slice(0, 8)}...</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '9px', opacity: 0.8 }}>
                          <div>Open: <span style={{ color: conn.open ? '#10b981' : '#ef4444' }}>{conn.open ? 'Yes' : 'No'}</span></div>
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
                                  <div>Board: {String(log.details.boardSize)} cards</div>
                                )}
                                {(() => {
                                  const cardsByZone = log.details.cardsByZone;
                                  return cardsByZone && typeof cardsByZone === 'object' && !Array.isArray(cardsByZone) ? (
                                    <div style={{ marginLeft: '4px' }}>
                                      {Object.entries(cardsByZone as Record<string, number>).map(([zone, count]) => (
                                        <span key={String(zone)} style={{ marginRight: '6px' }}>
                                          {String(zone)}: {String(count)}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null;
                                })()}
                                {(() => {
                                  const playersCount = log.details.playersCount;
                                  const playerNames = log.details.playerNames;
                                  return playersCount !== undefined && typeof playersCount === 'number' ? (
                                    <div>Players: {playersCount} ({Array.isArray(playerNames) ? (playerNames as string[]).join(', ') : ''})</div>
                                  ) : null;
                                })()}
                                {(() => {
                                  const cardName = log.details.cardName;
                                  return cardName && typeof cardName === 'string' ? (
                                    <div>Card: {cardName}</div>
                                  ) : null;
                                })()}
                                {(() => {
                                  const cardId = log.details.cardId;
                                  return cardId && typeof cardId === 'string' ? (
                                    <div>Card ID: {cardId.slice(0, 8)}...</div>
                                  ) : null;
                                })()}
                                {(() => {
                                  const position = log.details.position;
                                  return position && typeof position === 'object' && 'x' in position && 'y' in position ? (
                                    <div>Pos: ({Math.round((position as any).x)}, {Math.round((position as any).y)})</div>
                                  ) : null;
                                })()}
                                {(() => {
                                  const zone = log.details.zone;
                                  return zone && typeof zone === 'string' ? (
                                    <div>Zone: {zone}</div>
                                  ) : null;
                                })()}
                                {log.details.cardsCount !== undefined && typeof log.details.cardsCount === 'number' && (
                                  <div>Cards: {log.details.cardsCount}</div>
                                )}
                                {(() => {
                                  const targetPlayerId = log.details.targetPlayerId;
                                  return targetPlayerId && typeof targetPlayerId === 'string' ? (
                                    <div>Player: {targetPlayerId.slice(0, 8)}...</div>
                                  ) : null;
                                })()}
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
              <div><strong>Position:</strong></div>
              <div style={{ marginLeft: '8px' }}>
                Screen: ({mousePosition.x}, {mousePosition.y})
              </div>
              <div style={{ marginLeft: '8px' }}>
                Board: ({Math.round(mousePosition.boardX)}, {Math.round(mousePosition.boardY)})
              </div>
            </div>
            
            {lastTouchedCard && (
              <div style={{ marginBottom: '8px', borderTop: '1px solid #555', paddingTop: '8px' }}>
                <div><strong>📇 Last Touched Card:</strong></div>
                <div style={{ marginLeft: '8px', marginTop: '4px' }}>
                  <div>ID: {lastTouchedCard.id}</div>
                  <div>Nome: {lastTouchedCard.name}</div>
                  <div>Zona: {lastTouchedCard.zone}</div>
                  <div>Owner: {lastTouchedCard.ownerId}</div>
                  <div>Position: ({Math.round(lastTouchedCard.position.x)}, {Math.round(lastTouchedCard.position.y)})</div>
                  <div>Tapped: {lastTouchedCard.tapped ? 'Yes' : 'No'}</div>
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
                <div>Board Drag Active: {isDragging ? '✅ Yes' : '❌ No'}</div>
                {dragStateRef.current && (
                  <>
                    <div style={{ marginTop: '4px', paddingLeft: '8px', borderLeft: '2px solid #555' }}>
                      <div><strong>Board Drag:</strong></div>
                      <div>Card ID: {dragStateRef.current.cardId}</div>
                      <div>Moved: {dragStateRef.current.hasMoved ? '✅ Yes' : '❌ No'}</div>
                      <div>Offset: ({Math.round(dragStateRef.current.offsetX)}, {Math.round(dragStateRef.current.offsetY)})</div>
                      <div>Start: ({Math.round(dragStateRef.current.startX)}, {Math.round(dragStateRef.current.startY)})</div>
                    </div>
                  </>
                )}
                <div style={{ marginTop: '4px' }}>
                  Came from Hand: {dragStartedFromHandRef.current ? '✅ Yes' : '❌ No'}
                </div>
                <div>
                  Hand Card Placed: {handCardPlacedRef.current ? '✅ Yes' : '❌ No'}
                </div>
                {handDragStateRef.current.draggingHandCard && (
                  <div style={{ marginTop: '4px', paddingLeft: '8px', borderLeft: '2px solid #555', backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
                    <div><strong>Hand Drag:</strong></div>
                    <div>Card ID: {handDragStateRef.current.draggingHandCard}</div>
                    <div>Moved: {handDragStateRef.current.handCardMoved ? '✅ Yes' : '❌ No'}</div>
                    {handDragStateRef.current.previewHandOrder !== null && (
                      <div>Preview Order: {handDragStateRef.current.previewHandOrder}</div>
                    )}
                    {handDragStateRef.current.dragPosition && (
                      <div>Position: ({Math.round(handDragStateRef.current.dragPosition.x)}, {Math.round(handDragStateRef.current.dragPosition.y)})</div>
                    )}
                    {handDragStateRef.current.dragStartPosition && (
                      <div>Start: ({Math.round(handDragStateRef.current.dragStartPosition.x)}, {Math.round(handDragStateRef.current.dragStartPosition.y)})</div>
                    )}
                  </div>
                )}
                {clickBlockTimeoutRef.current && (
                  <div style={{ marginTop: '4px', paddingLeft: '8px', borderLeft: '2px solid #555' }}>
                    <div>Click Blocked: ✅ Sim</div>
                    <div>Card: {clickBlockTimeoutRef.current.cardId}</div>
                  </div>
                )}
                {draggingLibrary && (
                  <div style={{ marginTop: '4px', paddingLeft: '8px', borderLeft: '2px solid #555' }}>
                    <div><strong>Library Drag:</strong></div>
                    <div>Player: {draggingLibrary.playerName}</div>
                    <div>Moved: {libraryMoved ? '✅ Yes' : '❌ No'}</div>
                  </div>
                )}
              </div>
            </div>
            
            <div style={{ marginBottom: '8px', borderTop: '1px solid #555', paddingTop: '8px' }}>
              <div><strong>⚔️ Battlefield:</strong></div>
              <div style={{ marginLeft: '8px', marginTop: '4px' }}>
                <div>Total: {battlefieldCards.length} cards</div>
              </div>
            </div>
            
            <div style={{ borderTop: '1px solid #555', paddingTop: '8px' }}>
              <div><strong>🃏 Hand:</strong></div>
              <div style={{ marginLeft: '8px', marginTop: '4px' }}>
                <div>Total: {handCards.length} cards</div>
                {playerId && (
                  <div>
                    Your cards: {handCards.filter(c => c.ownerId === playerName).length}
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
                left: `${contextMenuPosition?.x ?? contextMenu.x}px`,
                top: `${contextMenuPosition?.y ?? contextMenu.y}px`,
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                borderRadius: '8px',
                padding: '4px',
                zIndex: 10001,
                minWidth: '180px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
              }}
              data-context-menu
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={handleShowToOthers}
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
                👁️ Show to other players
              </button>

              <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', margin: '4px 0' }} />

              {canInteractWithCard(contextMenu.card.ownerId) && (
                <>
                  <button
                    onClick={() => handleContextMenuAction('createCopy')}
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
                    📄 Create Copy
                  </button>
                  <button
                    onClick={() => handleContextMenuAction('changePrint')}
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
                    🎨 Change print
                  </button>
                  {showPrintsMenu && (
                    <div style={{ padding: '8px 12px' }}>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
                        Change print
                      </div>
                      {printsLoading ? (
                        <div style={{ color: '#f8fafc', fontSize: '13px' }}>Loading prints…</div>
                      ) : printsError ? (
                        <div style={{ color: '#f87171', fontSize: '13px' }}>{printsError}</div>
                      ) : printsOptions.length === 0 ? (
                        <div style={{ color: '#f8fafc', fontSize: '13px' }}>No prints found.</div>
                      ) : (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleContextMenuAction('changePrint');
                            }}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              marginBottom: '8px',
                              textAlign: 'left',
                              background: 'transparent',
                              border: '1px solid rgba(148, 163, 184, 0.3)',
                              color: '#f8fafc',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '13px',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                          >
                            🔄 Reload prints
                          </button>
                          <div
                            style={{
                              border: '1px solid rgba(148, 163, 184, 0.3)',
                              borderRadius: '6px',
                              maxHeight: '140px',
                              overflowY: 'auto',
                              marginBottom: '8px',
                            }}
                          >
                            {printsOptions.map((option) => {
                              const isSelected = printsSelection === option.id;
                              return (
                                <button
                                  key={option.id}
                                  onMouseEnter={() => setPrintsSelection(option.id)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPrintsSelection(option.id);
                                    applyPrintSelection(option.id);
                                  }}
                                  style={{
                                    width: '100%',
                                    padding: '6px 8px',
                                    textAlign: 'left',
                                    background: isSelected ? 'rgba(148, 163, 184, 0.2)' : 'transparent',
                                    border: 'none',
                                    color: '#f8fafc',
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                  }}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                          {printsSelection && (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
                              {(() => {
                                const selected = printsOptions.find((option) => option.id === printsSelection);
                                if (!selected?.imageUrl) return null;
                                return (
                                  <>
                                    <img
                                      src={selected.imageUrl}
                                      alt={selected.label}
                                      style={{
                                        width: '120px',
                                        borderRadius: '6px',
                                        border: '1px solid rgba(148, 163, 184, 0.3)',
                                      }}
                                    />
                                    {selected.backImageUrl && (
                                      <img
                                        src={selected.backImageUrl}
                                        alt={`${selected.label} (back)`}
                                        style={{
                                          width: '120px',
                                          borderRadius: '6px',
                                          border: '1px solid rgba(148, 163, 184, 0.3)',
                                        }}
                                      />
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          )}
                          <button
                            onClick={() => {
                              setShowPrintsMenu(false);
                              setPrintsSelection(null);
                              setPrintsOptions([]);
                              setPrintsCardId(null);
                              setPrintsError(null);
                            }}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              backgroundColor: 'transparent',
                              color: '#f8fafc',
                              border: '1px solid rgba(148, 163, 184, 0.3)',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '13px',
                            }}
                          >
                            Close
                          </button>
                        </>
                      )}
                      <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', marginTop: '8px' }} />
                    </div>
                  )}
                  <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', margin: '4px 0' }} />
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
                  
                  {/* Flip - apenas para battlefield */}
                  {contextMenu.card.zone === 'battlefield' && canInteractWithCard(contextMenu.card.ownerId) && (
                    <>
                      <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', margin: '4px 0' }} />
                      <button
                        onClick={() => handleContextMenuAction('flip')}
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
                        🔄 Transform Card
                      </button>
                    </>
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
                  
                  {/* Cascade - apenas para library */}
                  {contextMenu.card.zone === 'library' && (
                    <>
                      <button
                        onClick={() => {
                          setContextSubmenu(contextSubmenu === 'cascade' ? null : 'cascade');
                          setContextSubmenuLibrary(false);
                        }}
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
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <span>🌊 Reveal up to X CMC</span>
                        <span style={{ fontSize: '12px', opacity: 0.7 }}>▶</span>
                      </button>
                      
                      {/* Submenu de Cascade */}
                      {contextSubmenu === 'cascade' && (
                        <div
                          data-context-submenu
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            position: 'absolute',
                            left: '100%',
                            top: '0',
                            marginLeft: '4px',
                            backgroundColor: 'rgba(15, 23, 42, 0.95)',
                            border: '1px solid rgba(148, 163, 184, 0.3)',
                            borderRadius: '8px',
                            padding: '4px',
                            minWidth: '200px',
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                            zIndex: 10003,
                          }}
                        >
                          <button
                            onClick={() => handleCascade(true)}
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
                            👁️ Show each card
                          </button>
                          <button
                            onClick={() => handleCascade(false)}
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
                            ⚡ Run all at once
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  
                  {/* Mulligan - apenas para library */}
                  {contextMenu.card.zone === 'library' && (
                    <>
                      <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', margin: '4px 0' }} />
                      <button
                        onClick={() => {
                          if (playerHandCards.length > 0) {
                            addEventLog('MULLIGAN', `Mulligan: ${playerHandCards.length} cards from hand to the library`, undefined, undefined, {
                              playerId,
                              cardsCount: playerHandCards.length,
                            });
                            mulligan(playerName);
                          }
                          setContextMenu(null);
                          setShowPrintsMenu(false);
                        }}
                        disabled={playerHandCards.length === 0}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          textAlign: 'left',
                          background: 'transparent',
                          border: 'none',
                          color: playerHandCards.length > 0 ? '#f8fafc' : '#64748b',
                          cursor: playerHandCards.length > 0 ? 'pointer' : 'not-allowed',
                          borderRadius: '4px',
                          fontSize: '14px',
                          opacity: playerHandCards.length > 0 ? 1 : 0.5,
                        }}
                        onMouseEnter={(e) => {
                          if (playerHandCards.length > 0) {
                            e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        🔄 Mulligan
                      </button>
                    </>
                  )}

                  {/* Commander actions */}
                  {contextMenu.card.ownerId === playerName && (
                    <>
                      {!contextMenu.card.isCommander && (
                        <>
                          <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', margin: '4px 0' }} />
                          <button
                            onClick={() => handleContextMenuAction('setCommander')}
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
                            ⭐ Set Commander
                          </button>
                        </>
                      )}
                      {contextMenu.card.isCommander && contextMenu.card.zone !== 'commander' && (
                        <button
                          onClick={() => handleContextMenuAction('sendCommander')}
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
                          👑 Send to Commander Zone
                        </button>
                      )}
                    </>
                  )}
                  
                  {/* Move to - submenu */}
                  <div style={{ position: 'relative' }}>
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextSubmenu(contextSubmenu === 'moveZone' ? null : 'moveZone');
                        setContextSubmenuLibrary(false);
                      }}
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
                        data-context-submenu
                        onClick={(e) => e.stopPropagation()}
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
                            onClick={(e) => {
                              e.stopPropagation();
                              handleContextMenuAction('moveZone', 'hand');
                            }}
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
                            onClick={(e) => {
                              e.stopPropagation();
                              handleContextMenuAction('moveZone', 'battlefield');
                            }}
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
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setContextSubmenuLibrary(!contextSubmenuLibrary);
                                // Não fechar o submenu "Move to" pois o botão Library está dentro dele
                              }}
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
                              <span>📚 Library</span>
                              <span style={{ marginLeft: '8px' }}>▶</span>
                            </button>
                            
                            {/* Submenu de Library */}
                            {contextSubmenuLibrary && (
                              <div
                                data-context-submenu
                                className="library-submenu"
                                onClick={(e) => e.stopPropagation()}
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleContextMenuAction('libraryPlace', undefined, 'top');
                                  }}
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleContextMenuAction('libraryPlace', undefined, 'random');
                                  }}
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleContextMenuAction('libraryPlace', undefined, 'bottom');
                                  }}
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
                          onClick={(e) => {
                            e.stopPropagation();
                            handleContextMenuAction('moveZone', 'cemetery');
                          }}
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
                          ⚰️ Cemetery
                        </button>
                        {contextMenu.card.zone !== 'exile' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleContextMenuAction('moveZone', 'exile');
                            }}
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
                            🚫 Exile
                          </button>
                        )}
                        {contextMenu.card.zone !== 'commander' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleContextMenuAction('moveZone', 'commander');
                            }}
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
                            ⭐ Commander
                          </button>
                        )}
                        {contextMenu.card.zone !== 'tokens' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleContextMenuAction('moveZone', 'tokens');
                            }}
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
                            🎟️ Tokens
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Separador */}
                  <div style={{ height: '1px', backgroundColor: 'rgba(148, 163, 184, 0.2)', margin: '4px 0' }} />
                  
                  {/* Remove */}
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
                    🗑️ Remove
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      
      {/* Overlay de carta zoomada */}
      {effectiveZoomedCard && boardRef.current && (() => {
        const card = board.find((c) => c.id === effectiveZoomedCard);
        if (!card) return null;
        
        return (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
              cursor: 'pointer',
            }}
            onClick={() => {
              // Se for zoom sincronizado, usar função sincronizada, senão usar local
              if (zoomedCardSync === effectiveZoomedCard) {
                setZoomedCardSync(null);
              } else {
                setZoomedCard(null);
              }
            }}
            onPointerDown={(e) => {
              if (e.button === 1 || e.button === 0) {
                e.preventDefault();
                e.stopPropagation();
                // Se for zoom sincronizado, usar função sincronizada, senão usar local
                if (zoomedCardSync === effectiveZoomedCard) {
                  setZoomedCardSync(null);
                } else {
                  setZoomedCard(null);
                }
              }
            }}
          >
            <div
              style={{
                transform: 'scale(2.5)',
                transformOrigin: 'center',
                pointerEvents: 'none',
                position: 'relative',
              }}
            >
              <CardToken
                card={card}
                onPointerDown={() => {}}
                onClick={() => {}}
                onContextMenu={() => {}}
                ownerName={ownerName(card)}
                width={CARD_WIDTH}
                height={CARD_HEIGHT}
                showBack={false}
                forceShowFront
              />
            </div>
            </div>
          );
      })()}
      
      {/* Menu de contexto do board */}
      {boardContextMenu && boardContextMenuPosition && (
        <div
          data-board-context-menu
          style={{
            position: 'fixed',
            left: `${boardContextMenuPosition.x}px`,
            top: `${boardContextMenuPosition.y}px`,
            backgroundColor: 'rgba(30, 41, 59, 0.95)',
            border: '1px solid rgba(148, 163, 184, 0.3)',
            borderRadius: '8px',
            padding: '8px',
            zIndex: 1000,
            minWidth: '200px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div style={{ fontSize: '12px', color: '#94a3b8', padding: '4px 8px', marginBottom: '4px' }}>
            Ações do Board
          </div>
          
          {/* Criar Contador */}
          <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', margin: '4px 0' }} />
          <button
            onClick={() => {
              if (boardContextMenu && boardRef.current) {
                const boardRect = boardRef.current.getBoundingClientRect();
                const scale = getBoardScale();
                const offsetX = (boardRect.width - BASE_BOARD_WIDTH * scale) / 2;
                const offsetY = (boardRect.height - BASE_BOARD_HEIGHT * scale) / 2;
                
                const boardX = (boardContextMenu.x - boardRect.left - offsetX) / scale;
                const boardY = (boardContextMenu.y - boardRect.top - offsetY) / scale;
                
                const position: Point = { x: boardX, y: boardY };
                addEventLog('CREATE_COUNTER', `Criando contador numeral`, undefined, undefined, {
                  counterType: 'numeral',
                  position,
                });
                createCounter(playerName, 'numeral', position);
              }
              setBoardContextMenu(null);
              setBoardContextMenuPosition(null);
            }}
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
            🔢 Criar Contador Numeral
          </button>
          <button
            onClick={() => {
              if (boardContextMenu && boardRef.current) {
                const boardRect = boardRef.current.getBoundingClientRect();
                const scale = getBoardScale();
                const offsetX = (boardRect.width - BASE_BOARD_WIDTH * scale) / 2;
                const offsetY = (boardRect.height - BASE_BOARD_HEIGHT * scale) / 2;
                
                const boardX = (boardContextMenu.x - boardRect.left - offsetX) / scale;
                const boardY = (boardContextMenu.y - boardRect.top - offsetY) / scale;
                
                const position: Point = { x: boardX, y: boardY };
                addEventLog('CREATE_COUNTER', `Criando contador +X/+Y`, undefined, undefined, {
                  counterType: 'plus',
                  position,
                });
                createCounter(playerName, 'plus', position);
              }
              setBoardContextMenu(null);
              setBoardContextMenuPosition(null);
            }}
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
            ➕ Criar Contador +X/+Y
          </button>
          
          {/* Mulligan */}
        </div>
      )}
    </div>
  );
};

export default Board;
