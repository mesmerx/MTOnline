import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { CardOnBoard } from '../store/useGameStore';
import CardToken from './CardToken';
import Hand from './Hand';
import Library from './Library';
import Cemetery from './Cemetery';

type Point = { x: number; y: number };

const CARD_WIDTH = 150;
const CARD_HEIGHT = 210;
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
  const moveCard = useGameStore((state) => state.moveCard);
  const moveLibrary = useGameStore((state) => state.moveLibrary);
  const toggleTap = useGameStore((state) => state.toggleTap);
  const removeCard = useGameStore((state) => state.removeCard);
  const changeCardZone = useGameStore((state) => state.changeCardZone);
  const drawFromLibrary = useGameStore((state) => state.drawFromLibrary);
  const reorderHandCard = useGameStore((state) => state.reorderHandCard);
  const shuffleLibrary = useGameStore((state) => state.shuffleLibrary);
  const status = useGameStore((state) => state.status);
  const boardRef = useRef<HTMLDivElement>(null);
  
  // Sistema centralizado de drag - apenas uma carta pode ser arrastada por vez
  const dragStateRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false); // Estado para forçar re-render do useEffect
  const dragUpdateRef = useRef<number>(0);
  const clickBlockTimeoutRef = useRef<ClickBlockState | null>(null);
  
  // Estados para library e hand
  const [libraryPositions, setLibraryPositions] = useState<Record<string, Point>>({});
  const [draggingLibrary, setDraggingLibrary] = useState<{ playerId: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const [libraryMoved, setLibraryMoved] = useState(false);
  const libraryMovedRef = useRef<boolean>(false);
  const libraryClickExecutedRef = useRef<boolean>(false);
  
  // Estados para cemetery
  const [cemeteryPosition, setCemeteryPosition] = useState<Point | null>(null);
  const [draggingCemetery, setDraggingCemetery] = useState<{ offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const [cemeteryMoved, setCemeteryMoved] = useState(false);
  const cemeteryMovedRef = useRef<boolean>(false);
  const [showHand, setShowHand] = useState(true);
  const [handButtonEnabled, setHandButtonEnabled] = useState(false);
  const [showDebugMode, setShowDebugMode] = useState(false);
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
  

  const getPlayerArea = (ownerId: string) => {
    if (!boardRef.current || players.length === 0) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const playerIndex = players.findIndex((p) => p.id === ownerId);
    if (playerIndex === -1) return null;

    return {
      x: 0,
      y: 0,
      width: rect.width,
      height: rect.height,
    };
  };

  const getHandArea = (ownerId: string) => {
    if (!boardRef.current || players.length === 0 || !showHand) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const playerIndex = players.findIndex((p) => p.id === ownerId);
    if (playerIndex === -1) return null;

    const HAND_CARD_LEFT_SPACING = 120;
    const maxRenderCards = 9;
    
    const playerHandCards = board.filter((c) => c.zone === 'hand' && c.ownerId === ownerId);
    const totalCards = playerHandCards.length;
    
    if (totalCards === 0) {
      const handHeight = 168 + 20; // HAND_CARD_HEIGHT + margin
      const handY = rect.height - handHeight;
      return {
        x: 0,
        y: handY,
        width: rect.width,
        height: handHeight,
      };
    }
    
    const visibleCardsCount = Math.min(maxRenderCards, totalCards);
    const handWidth = (visibleCardsCount * HAND_CARD_LEFT_SPACING) + 40;
    const handX = (rect.width - handWidth) / 2;
    
    const curveHeight = 8;
    const HOVER_LIFT_PX = 10;
    const baseHandHeight = 168 + curveHeight + HOVER_LIFT_PX + 10; // HAND_CARD_HEIGHT + extras
    const marginY = baseHandHeight * 0.1;
    const handHeight = baseHandHeight + (marginY * 2);
    const handY = rect.height - handHeight;

    return {
      x: handX,
      y: handY,
      width: handWidth,
      height: handHeight,
    };
  };

  const getCemeteryPosition = (): Point | null => {
    if (!boardRef.current) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const CEMETERY_CARD_WIDTH = 100;
    const CEMETERY_CARD_HEIGHT = 140;
    
    // Se há posição salva, usar ela
    if (cemeteryPosition) {
      return cemeteryPosition;
    }
    
    // Caso contrário, posição central do battlefield
    return {
      x: rect.width / 2 - CEMETERY_CARD_WIDTH / 2,
      y: rect.height / 2 - CEMETERY_CARD_HEIGHT / 2,
    };
  };

  // Função para detectar em qual zona o cursor está
  const detectZoneAtPosition = (x: number, y: number): { zone: 'battlefield' | 'hand' | 'library' | 'cemetery' | null; ownerId?: string } => {
    if (!boardRef.current) return { zone: null };
    
    // Verificar cemitério
    const cemeteryPos = getCemeteryPosition();
    if (cemeteryPos) {
      const CEMETERY_CARD_WIDTH = 100;
      const CEMETERY_CARD_HEIGHT = 140;
      const CEMETERY_STACK_WIDTH = 120; // Área maior do stack
      const CEMETERY_STACK_HEIGHT = 160;
      
      // Verificar se está dentro da área do cemitério (considerando todos os players)
      for (const player of players) {
        const playerIndex = players.findIndex((p) => p.id === player.id);
        const offsetX = playerIndex * (CEMETERY_CARD_WIDTH + 20);
        const cemeteryX = cemeteryPos.x + offsetX;
        const cemeteryY = cemeteryPos.y;
        
        if (
          x >= cemeteryX - 10 &&
          x <= cemeteryX + CEMETERY_STACK_WIDTH &&
          y >= cemeteryY - 10 &&
          y <= cemeteryY + CEMETERY_STACK_HEIGHT
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
    for (const player of players) {
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
      return {
        x: topCard.position.x,
        y: topCard.position.y,
      };
    }
    
    if (libraryPositions[ownerId]) {
      return {
        x: area.x + libraryPositions[ownerId].x,
        y: area.y + libraryPositions[ownerId].y,
      };
    }
    
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
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const x = cursorX - dragState.offsetX;
      const y = cursorY - dragState.offsetY;

      // Clamp dentro da área do player
      const playerArea = getPlayerArea(card.ownerId);
      let clampedX = x;
      let clampedY = y;

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
        clampedX = Math.max(0, Math.min(rect.width - CARD_WIDTH, x));
        clampedY = Math.max(0, Math.min(rect.height - CARD_HEIGHT, y));
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
          const cursorX = event.clientX - rect.left;
          const cursorY = event.clientY - rect.top;
          
          const detectedZone = detectZoneAtPosition(cursorX, cursorY);
          
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
              // Posição onde soltou
              position = {
                x: Math.max(0, Math.min(rect.width - CARD_WIDTH, cursorX - dragState.offsetX)),
                y: Math.max(0, Math.min(rect.height - CARD_HEIGHT, cursorY - dragState.offsetY)),
              };
            } else if (detectedZone.zone === 'cemetery') {
              const cemeteryPos = getCemeteryPosition();
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
  }, [isDragging, showHand, playerId, moveCard, changeCardZone, getPlayerArea, getHandArea]);

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
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
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

  const ownerName = (card: CardOnBoard) => players.find((player) => player.id === card.ownerId)?.name ?? 'Unknown';

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
          const cemeteryPos = getCemeteryPosition();
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

    const offsetX = event.clientX - rect.left - libraryPos.x;
    const offsetY = event.clientY - rect.top - libraryPos.y;

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
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const x = cursorX - draggingLibrary.offsetX;
      const y = cursorY - draggingLibrary.offsetY;

      const playerArea = getPlayerArea(draggingLibrary.playerId);
      if (playerArea) {
        const clampedX = Math.max(
          playerArea.x,
          Math.min(playerArea.x + playerArea.width - LIBRARY_CARD_WIDTH, x)
        );
        const clampedY = Math.max(
          playerArea.y,
          Math.min(playerArea.y + playerArea.height - LIBRARY_CARD_HEIGHT, y)
        );

        setLibraryPositions((prev) => ({
          ...prev,
          [draggingLibrary.playerId]: {
            x: clampedX - playerArea.x,
            y: clampedY - playerArea.y,
          },
        }));

        moveLibrary(draggingLibrary.playerId, { x: clampedX, y: clampedY });
      }
    };

    const stopDrag = (event?: PointerEvent) => {
      // Evitar múltiplas execuções
      if (libraryClickExecutedRef.current) {
        setDraggingLibrary(null);
        setLibraryMoved(false);
        libraryMovedRef.current = false;
        setTimeout(() => setLibraryMoved(false), 100);
        return;
      }
      
      // CRÍTICO: Só fazer draw se NÃO moveu (foi apenas um clique)
      // Usar tanto o estado quanto a ref para garantir que detecta movimento
      const actuallyMoved = libraryMoved || libraryMovedRef.current;
      
      if (!actuallyMoved && event && event.button !== 2 && !contextMenu) {
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
      setTimeout(() => setLibraryMoved(false), 100);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', (e) => stopDrag(e));
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopDrag);
    };
  }, [draggingLibrary, moveLibrary, playerId, libraryMoved]);

  // Sistema de drag para cemitério
  const startCemeteryDrag = (event: ReactPointerEvent) => {
    if ((event.target as HTMLElement).closest('button')) return;
    // Não iniciar drag com botão direito (button 2)
    if (event.button === 2) return;
    event.preventDefault();
    if (!boardRef.current) return;

    // Resetar flags ao iniciar novo drag
    cemeteryMovedRef.current = false;

    const rect = boardRef.current.getBoundingClientRect();
    const cemeteryPos = getCemeteryPosition();
    if (!cemeteryPos) return;

    const offsetX = event.clientX - rect.left - cemeteryPos.x;
    const offsetY = event.clientY - rect.top - cemeteryPos.y;

    setCemeteryMoved(false);
    setDraggingCemetery({
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
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const x = cursorX - draggingCemetery.offsetX;
      const y = cursorY - draggingCemetery.offsetY;

      // Clamp dentro da área do board
      const CEMETERY_CARD_WIDTH = 100;
      const CEMETERY_CARD_HEIGHT = 140;
      const clampedX = Math.max(0, Math.min(rect.width - CEMETERY_CARD_WIDTH, x));
      const clampedY = Math.max(0, Math.min(rect.height - CEMETERY_CARD_HEIGHT, y));

      setCemeteryPosition({ x: clampedX, y: clampedY });
    };

    const stopDrag = () => {
      setDraggingCemetery(null);
      setCemeteryMoved(false);
      cemeteryMovedRef.current = false;
      setTimeout(() => setCemeteryMoved(false), 100);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopDrag);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopDrag);
    };
  }, [draggingCemetery, cemeteryMoved]);

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

  return (
    <div className="board-container">
      <div className="board-toolbar">
        <div className="board-status">{instruction}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setShowDebugMode(!showDebugMode)}
            style={{
              padding: '8px 16px',
              backgroundColor: showDebugMode ? '#6366f1' : '#475569',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
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
            padding: '8px 16px',
            backgroundColor: showHand ? '#ef4444' : '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: (!handButtonEnabled && !showHand) ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            opacity: (!handButtonEnabled && !showHand) ? 0.5 : 1,
          }}
        >
          {showHand ? 'Esconder Hand' : 'Mostrar Hand'}
        </button>
        </div>
      </div>
      <div 
        className="board-surface" 
        ref={boardRef}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          const isInteractive = target.closest(
            `.card-token, button, .library-stack, .player-area${showHand ? ', .hand-card-wrapper, .hand-area, .hand-cards' : ''}`
          );
          
          console.log('[Board] board-surface onClick:', {
            target: target.className,
            isInteractive: !!isInteractive,
            isDragging,
            clickBlockTimeout: clickBlockTimeoutRef.current,
            dragStateRef: dragStateRef.current,
            dragStartedFromHand: dragStartedFromHandRef.current,
          });
          
          if (!isInteractive) {
            console.log('[Board] board-surface onClick: Chamando resetAllDragStates');
            resetAllDragStates();
          }
        }}
      >
        {board.length === 0 && <div className="empty-state">No cards yet. Add cards from the search or a deck.</div>}
        
        {players.length > 0 && players.map((player) => {
          const area = getPlayerArea(player.id);
          if (!area) return null;
          const isCurrentPlayer = player.id === playerId;
          
          return (
            <div key={player.id}>
              <div
                className={`player-area ${isCurrentPlayer ? 'current-player' : ''}`}
                style={{
                  left: `${area.x}px`,
                  top: `${area.y}px`,
                  width: `${area.width}px`,
                  height: `${area.height}px`,
                }}
              >
                <div className="player-area-label">{player.name}</div>
              </div>
            </div>
          );
        })}
        
        <Library
          boardRef={boardRef}
          playerId={playerId}
          libraryCards={libraryCards}
          players={players}
          getPlayerArea={getPlayerArea}
          getLibraryPosition={getLibraryPosition}
          ownerName={ownerName}
          onLibraryClick={handleLibraryClick}
          onLibraryContextMenu={(card, e) => {
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              card,
            });
          }}
          startLibraryDrag={startLibraryDrag}
          draggingLibrary={draggingLibrary}
          libraryMoved={libraryMoved}
          startDrag={startDrag}
        />
        
        <Cemetery
          boardRef={boardRef}
          playerId={playerId}
          cemeteryCards={cemeteryCards}
          players={players}
          getCemeteryPosition={getCemeteryPosition}
          ownerName={ownerName}
          onCemeteryContextMenu={(card, e) => {
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              card,
            });
          }}
          startDrag={startDrag}
          startCemeteryDrag={startCemeteryDrag}
          draggingCemetery={draggingCemetery}
          cemeteryMoved={cemeteryMoved}
        />
        
        {battlefieldCards.map((card) => {
          const isDragging = dragStateRef.current?.cardId === card.id;
          // Garantir que a posição seja válida
          const posX = isNaN(card.position.x) ? 0 : card.position.x;
          const posY = isNaN(card.position.y) ? 0 : card.position.y;
          
          return (
            <div
              key={card.id}
              className={`battlefield-card ${isDragging ? 'dragging' : ''}`}
              style={{
                position: 'absolute',
                left: `${posX}px`,
                top: `${posY}px`,
                zIndex: isDragging ? 1000 : 1,
              }}
            >
              <CardToken
                card={card}
                onPointerDown={(event) => {
                  setLastTouchedCard(card);
                  startDrag(card, event);
                }}
                onClick={(event) => handleCardClick(card, event)}
                onContextMenu={(event) => handleCardContextMenu(card, event)}
                ownerName={ownerName(card)}
                width={CARD_WIDTH}
                height={CARD_HEIGHT}
                showBack={false}
              />
            </div>
          );
        })}
        
        {showHand && (
          <Hand
            boardRef={boardRef}
            playerId={playerId}
            board={board}
            players={players}
            getPlayerArea={getPlayerArea}
            handleCardClick={handleCardClick}
            handleCardContextMenu={handleCardContextMenu}
            startDrag={startDrag}
            ownerName={ownerName}
            changeCardZone={changeCardZone}
            detectZoneAtPosition={detectZoneAtPosition}
            reorderHandCard={reorderHandCard}
            dragStartedFromHandRef={dragStartedFromHandRef}
            handCardPlacedRef={handCardPlacedRef}
            setDragStartedFromHand={(value: boolean) => {
              dragStartedFromHandRef.current = value;
            }}
            clearBoardDrag={() => {
              dragStateRef.current = null;
              setIsDragging(false);
            }}
            setLastTouchedCard={setLastTouchedCard}
            handDragStateRef={handDragStateRef}
            addEventLog={addEventLog}
            showDebugMode={showDebugMode}
          />
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
