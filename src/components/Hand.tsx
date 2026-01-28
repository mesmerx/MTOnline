import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { CardOnBoard } from '../store/useGameStore';
import CardToken from './CardToken';
import CounterToken from './CounterToken';
import type { Counter } from '../store/useGameStore';
import { BASE_BOARD_WIDTH, BASE_BOARD_HEIGHT } from './BoardTypes';

type Point = { x: number; y: number };

const HAND_CARD_WIDTH = 120;
const HAND_CARD_HEIGHT = 168;
const CARD_WIDTH = 150;
const CARD_HEIGHT = 210;
const HAND_CARD_LEFT_SPACING = 120; // Espaçamento em pixels para o left das cartas
const maxRenderCards = 9; // Máximo de cartas renderizadas (constante)
const THROTTLE_MS = 8; // ~120fps para melhor responsividade durante drag

interface HandProps {
  boardRef: React.RefObject<HTMLDivElement | null>;
  playerId: string;
  board: CardOnBoard[];
  players: Array<{ id: string; name: string }>;
  getPlayerArea: (ownerId: string) => { x: number; y: number; width: number; height: number } | null;
  handleCardClick: (card: CardOnBoard, event: React.MouseEvent) => void;
  handleCardContextMenu: (card: CardOnBoard, event: React.MouseEvent) => void;
  startDrag: (card: CardOnBoard, event: ReactPointerEvent) => void;
  ownerName: (card: CardOnBoard) => string;
  changeCardZone: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery', position: Point) => void;
  detectZoneAtPosition: (x: number, y: number) => { zone: 'battlefield' | 'hand' | 'library' | 'cemetery' | null; ownerId?: string };
  reorderHandCard: (cardId: string, newIndex: number) => void;
  dragStartedFromHandRef: React.MutableRefObject<boolean>;
  handCardPlacedRef: React.MutableRefObject<boolean>;
  setDragStartedFromHand: (value: boolean) => void;
  clearBoardDrag?: () => void;
  setLastTouchedCard: (card: CardOnBoard | null) => void;
  handDragStateRef: React.MutableRefObject<{
    draggingHandCard: string | null;
    handCardMoved: boolean;
    previewHandOrder: number | null;
    dragPosition: Point | null;
    dragStartPosition: Point | null;
  }>;
  addEventLog: (type: string, message: string, cardId?: string, cardName?: string, details?: Record<string, unknown>) => void;
  showDebugMode?: boolean;
  viewMode?: 'unified' | 'individual' | 'separated';
  convertMouseToSeparatedCoordinates?: (mouseX: number, mouseY: number, playerId: string, rect: DOMRect) => { x: number; y: number } | null;
  convertMouseToUnifiedCoordinates?: (mouseX: number, mouseY: number, rect: DOMRect) => { x: number; y: number };
  counters?: Counter[];
  moveCounter?: (counterId: string, position: Point) => void;
  modifyCounter?: (counterId: string, delta?: number, deltaX?: number, deltaY?: number, setValue?: number, setX?: number, setY?: number) => void;
  removeCounterToken?: (counterId: string) => void;
}

const Hand = ({
  boardRef,
  playerId,
  board,
  players,
  getPlayerArea,
  handleCardClick,
  handleCardContextMenu,
  startDrag,
  ownerName,
  changeCardZone,
  detectZoneAtPosition,
  reorderHandCard,
  dragStartedFromHandRef,
  handCardPlacedRef,
  setDragStartedFromHand,
  clearBoardDrag,
  setLastTouchedCard,
  handDragStateRef,
  addEventLog,
  showDebugMode = false,
  viewMode = 'unified',
  convertMouseToSeparatedCoordinates,
  convertMouseToUnifiedCoordinates,
  counters = [],
  moveCounter,
  modifyCounter,
  removeCounterToken,
}: HandProps) => {
  const [handCardMoved, setHandCardMoved] = useState(false);
  const [handScrollIndex, setHandScrollIndex] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const [draggingHandCard, setDraggingHandCard] = useState<string | null>(null);
  const [previewHandOrder, setPreviewHandOrder] = useState<number | null>(null);
  const [dragPosition, setDragPosition] = useState<Point | null>(null);
  const [dragStartPosition, setDragStartPosition] = useState<Point | null>(null);
  const [zoomedCard, setZoomedCard] = useState<string | null>(null);
  const [hoveredHandCard, setHoveredHandCard] = useState<string | null>(null);
  const [initialHoverIndex, setInitialHoverIndex] = useState<number | null>(null);
  const [originalHandOrder, setOriginalHandOrder] = useState<Record<string, number> | null>(null);
  const [pendingHandDrag, setPendingHandDrag] = useState<{ cardId: string; startX: number; startY: number } | null>(null);
  
  const dragUpdateRef = useRef<number>(0);
  const stopDragExecutedRef = useRef<boolean>(false); // Flag para evitar múltiplas execuções
  const activeDragCardIdRef = useRef<string | null>(null); // Ref para rastrear qual carta está sendo arrastada atualmente

  const handCards = useMemo(() => board.filter((c) => c.zone === 'hand'), [board]);

  const getHandArea = useCallback((ownerId: string) => {
    if (!boardRef.current || players.length === 0) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const playerIndex = players.findIndex((p) => p.id === ownerId);
    if (playerIndex === -1) return null;

    // Calcular área baseada no número real de cartas
    const playerHandCards = handCards.filter((c) => c.ownerId === ownerId);
    const totalCards = playerHandCards.length;
    
    if (totalCards === 0) {
      // Se não há cartas, retornar área padrão
      const handHeight = HAND_CARD_HEIGHT + 20; // Altura da carta + espaço extra
      const handY = rect.height - handHeight;
      return {
        x: 0,
        y: handY,
        width: rect.width,
        height: handHeight,
      };
    }
    
    // Calcular largura baseada no número de cartas * HAND_CARD_LEFT_SPACING + 20px
    const visibleCardsCount = Math.min(maxRenderCards, totalCards);
    const handWidth = (visibleCardsCount * HAND_CARD_LEFT_SPACING) + 40;
    
    // Centralizar o container
    const handX = (rect.width - handWidth) / 2;
    
    // Área Y: baseada na altura da carta + espaço para o arco + espaço para hover + 10% de margem
    const curveHeight = 8;
    const HOVER_LIFT_PX = 10;
    const baseHandHeight = HAND_CARD_HEIGHT + curveHeight + HOVER_LIFT_PX + 10; // Altura da carta + arco + hover + margem
    const marginY = baseHandHeight * 0.1; // 10% de margem
    const handHeight = baseHandHeight + (marginY * 2);
    const handY = rect.height - handHeight;

    return {
      x: handX,
      y: handY,
      width: handWidth,
      height: handHeight,
    };
  }, [boardRef, players, handCards]);

  const prepareHandDrag = (card: CardOnBoard, event: ReactPointerEvent) => {
    if (card.ownerId !== playerId) return;
    if ((event.target as HTMLElement).closest('button')) return;
    if (event.button === 1 || event.button === 2) return;
    if (!boardRef.current) return;
    
    const rect = boardRef.current.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    
    setPendingHandDrag({ cardId: card.id, startX: cursorX, startY: cursorY });
  };
  
  const startHandDrag = (card: CardOnBoard, startX: number, startY: number) => {
    // Resetar flag de execução quando iniciar um novo drag
    stopDragExecutedRef.current = false;
    
    const playerHandCards = board.filter((c) => c.zone === 'hand' && c.ownerId === playerId);
    const sortedCards = [...playerHandCards].sort((a, b) => {
      if (a.handIndex !== undefined && b.handIndex !== undefined) {
        return a.handIndex - b.handIndex;
      }
      if (a.handIndex !== undefined) return -1;
      if (b.handIndex !== undefined) return 1;
      return a.id.localeCompare(b.id);
    });
    
    const originalOrder: Record<string, number> = {};
    sortedCards.forEach((c, idx) => {
      originalOrder[c.id] = c.handIndex ?? idx;
    });
    setOriginalHandOrder(originalOrder);
    
    if (hoveredHandCard) {
      const hoveredIndex = originalOrder[hoveredHandCard] ?? 
        sortedCards.findIndex((c) => c.id === hoveredHandCard);
      setInitialHoverIndex(hoveredIndex >= 0 ? hoveredIndex : null);
    }
    
    setHandCardMoved(false);
    handCardPlacedRef.current = false;
    setDragStartedFromHand(true);
    dragStartedFromHandRef.current = true;
    // Atualizar ref com o ID da carta sendo arrastada ANTES de atualizar o estado
    activeDragCardIdRef.current = card.id;
    
    setDraggingHandCard(card.id);
    setHoveredHandCard(null);
    setDragPosition({ x: startX, y: startY });
    setDragStartPosition({ x: startX, y: startY });
    setPreviewHandOrder(null);
    setPendingHandDrag(null);
    
    // Resetar flag de execução
    stopDragExecutedRef.current = false;
    
    // Atualizar ref para debug
    handDragStateRef.current = {
      draggingHandCard: card.id,
      handCardMoved: false,
      previewHandOrder: null,
      dragPosition: { x: startX, y: startY },
      dragStartPosition: { x: startX, y: startY },
    };
    
    addEventLog('DRAG_START', `Iniciando drag da hand: ${card.name}`, card.id, card.name, {
      zone: 'hand',
      handIndex: card.handIndex,
      startPosition: { x: startX, y: startY },
    });
  };

  // useEffect para detectar movimento e iniciar drag pendente
  useEffect(() => {
    if (!pendingHandDrag || !boardRef.current) return;
    
    const handleMove = (event: PointerEvent) => {
      const rect = boardRef.current!.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      
      const deltaX = Math.abs(cursorX - pendingHandDrag.startX);
      const deltaY = Math.abs(cursorY - pendingHandDrag.startY);
      
      if (deltaX > 5 || deltaY > 5) {
        // Usar board atualizado do store para garantir que temos a versão mais recente
        const currentBoard = useGameStore.getState().board;
        const card = currentBoard.find((c) => c.id === pendingHandDrag.cardId);
        if (card && card.zone === 'hand' && card.ownerId === playerId) {
          event.preventDefault();
          startHandDrag(card, pendingHandDrag.startX, pendingHandDrag.startY);
        }
      }
    };
    
    const handleUp = () => {
      setPendingHandDrag(null);
    };
    
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [pendingHandDrag, board, playerId, hoveredHandCard]);
  
  // useEffect para drag de cartas da mão
  useEffect(() => {
    // Se não há carta sendo arrastada, não fazer nada
    // IMPORTANTE: Se stopDragExecutedRef está true, significa que já processamos o stopDrag
    // e estamos apenas aguardando a limpeza dos estados, então não devemos processar eventos
    if (!draggingHandCard || !boardRef.current || stopDragExecutedRef.current) return;
    
    // Capturar o cardId atual no início do useEffect para evitar problemas de closure
    const currentDraggingCardId = draggingHandCard;
    
    const handleMove = (event: PointerEvent) => {
      const now = Date.now();
      if (now - dragUpdateRef.current < THROTTLE_MS) return;
      dragUpdateRef.current = now;
      
      const rect = boardRef.current!.getBoundingClientRect();
      let cursorX = event.clientX - rect.left;
      let cursorY = event.clientY - rect.top;
      
      // Atualizar a posição visual da carta arrastada sempre (para seguir o mouse)
      // Isso garante que a carta siga o mouse desde o início do drag
      setDragPosition({ x: cursorX, y: cursorY });
      
      // Atualizar ref para debug
      handDragStateRef.current.dragPosition = { x: cursorX, y: cursorY };
      
      // Para o cálculo de movimento, usar coordenadas relativas (não convertidas)
      // Isso garante que o threshold funcione corretamente
      if (!handCardMoved && dragStartPosition) {
        const deltaX = Math.abs(cursorX - dragStartPosition.x);
        const deltaY = Math.abs(cursorY - dragStartPosition.y);
        if (deltaX > 5 || deltaY > 5) {
          setHandCardMoved(true);
          // Atualizar ref para debug
          handDragStateRef.current.handCardMoved = true;
        }
      }
      
      // Se ainda não moveu o suficiente, não processar reordenação
      if (!handCardMoved) {
        return;
      }
      
      const handArea = getHandArea(playerId);
      if (!handArea) return;
      
      // Usar board atualizado do store para garantir que temos a versão mais recente
      const currentBoard = useGameStore.getState().board;
      const playerHandCards = currentBoard.filter((c) => c.zone === 'hand' && c.ownerId === playerId);
      const allCards = [...playerHandCards].sort((a, b) => {
        const indexA = originalHandOrder?.[a.id] ?? a.handIndex ?? 0;
        const indexB = originalHandOrder?.[b.id] ?? b.handIndex ?? 0;
        return indexA - indexB;
      });
      
      const totalCards = allCards.length;
      const maxScroll = Math.max(0, totalCards - maxRenderCards);
      const currentScrollIndex = Math.min(handScrollIndex, maxScroll);
      const renderStartIndex = currentScrollIndex;
      
      // Calcular posição visual baseada no cursor dentro da área da hand
      // As cartas começam em 80px dentro da hand area
      const handAreaLeft = handArea.x;
      const relativeX = cursorX - handAreaLeft;
      const cardStartOffset = 80; // Offset onde as cartas começam dentro da hand area
      const adjustedX = relativeX - cardStartOffset;
      
      // Se o cursor está antes do início das cartas, usar posição 0
      if (adjustedX < 0) {
        const newIndex = renderStartIndex;
        const clampedNewIndex = Math.max(0, Math.min(totalCards - 1, newIndex));
        const originalIndex = originalHandOrder?.[currentDraggingCardId] ?? 
          allCards.findIndex((c) => c.id === currentDraggingCardId);
        if (originalIndex >= 0 && clampedNewIndex !== originalIndex) {
          setPreviewHandOrder(clampedNewIndex);
          handDragStateRef.current.previewHandOrder = clampedNewIndex;
        } else if (clampedNewIndex === originalIndex) {
          setPreviewHandOrder(originalIndex);
          handDragStateRef.current.previewHandOrder = originalIndex;
        }
        return;
      }
      
      const visibleCardsCount = Math.min(maxRenderCards, totalCards - renderStartIndex);
      let visualPosition = Math.floor(adjustedX / HAND_CARD_LEFT_SPACING);
      visualPosition = Math.max(0, Math.min(visibleCardsCount - 1, visualPosition));
      
      const newIndex = renderStartIndex + visualPosition;
      const clampedNewIndex = Math.max(0, Math.min(totalCards - 1, newIndex));
      
      const originalIndex = originalHandOrder?.[currentDraggingCardId] ?? 
        allCards.findIndex((c) => c.id === currentDraggingCardId);
      
      if (originalIndex >= 0 && clampedNewIndex !== originalIndex) {
        setPreviewHandOrder(clampedNewIndex);
        handDragStateRef.current.previewHandOrder = clampedNewIndex;
      } else if (clampedNewIndex === originalIndex) {
        setPreviewHandOrder(originalIndex);
        handDragStateRef.current.previewHandOrder = originalIndex;
      }
    };
    
    const stopDrag = (event?: PointerEvent) => {
      // Evitar múltiplas execuções
      if (stopDragExecutedRef.current) {
        console.log('[Hand] stopDrag: Já executado, ignorando');
        return;
      }
      
      // Usar o cardId capturado no início do useEffect para evitar problemas de closure
      const draggedCardId = currentDraggingCardId;
      
      // Verificar se o cardId ainda corresponde ao activeDragCardIdRef
      // Se não corresponder E o activeDragCardIdRef não for null, significa que um novo drag foi iniciado
      // Se activeDragCardIdRef for null, pode ser que ainda não foi setado ou foi limpo, então continuar
      if (activeDragCardIdRef.current !== null && draggedCardId !== activeDragCardIdRef.current) {
        console.log('[Hand] stopDrag: CardId não corresponde ao drag ativo, cancelando:', {
          capturedId: draggedCardId,
          activeId: activeDragCardIdRef.current,
          currentDraggingHandCard: draggingHandCard,
        });
        return;
      }
      
      // Verificar se o cardId ainda corresponde ao draggingHandCard atual
      // Se não corresponder, significa que um novo drag foi iniciado e devemos cancelar
      if (draggedCardId !== draggingHandCard) {
        console.log('[Hand] stopDrag: CardId mudou durante o drag, cancelando:', {
          capturedId: draggedCardId,
          currentId: draggingHandCard,
        });
        return;
      }
      
      // Capturar previewHandOrder no início para evitar problemas de closure
      const currentPreviewHandOrder = previewHandOrder;
      
      console.log('[Hand] stopDrag chamado:', {
        draggedCardId,
        handCardMoved,
        dragStartPosition,
        currentPreviewHandOrder,
        previewHandOrder,
        event: event ? { clientX: event.clientX, clientY: event.clientY } : null,
      });
      
      // Marcar como executado imediatamente
      stopDragExecutedRef.current = true;
      
      if (!draggedCardId) {
        console.log('[Hand] stopDrag: Sem draggedCardId, limpando estados');
        setDraggingHandCard(null);
        setPreviewHandOrder(null);
        setDragPosition(null);
        setDragStartPosition(null);
        setHoveredHandCard(null);
        setInitialHoverIndex(null);
        setOriginalHandOrder(null);
        setHandCardMoved(false);
        setDragStartedFromHand(false);
        handCardPlacedRef.current = false;
        
        // Limpar ref para debug
        handDragStateRef.current = {
          draggingHandCard: null,
          handCardMoved: false,
          previewHandOrder: null,
          dragPosition: null,
          dragStartPosition: null,
        };
        return;
      }
      
      // Obter o board atualizado diretamente do store para garantir que temos a versão mais recente
      const currentBoard = useGameStore.getState().board;
      const draggedCard = currentBoard.find((c) => c.id === draggedCardId);
      
      console.log('[Hand] stopDrag: Verificando carta:', {
        draggedCard: draggedCard ? { id: draggedCard.id, name: draggedCard.name, zone: draggedCard.zone, ownerId: draggedCard.ownerId } : null,
        playerId,
        isHand: draggedCard?.zone === 'hand',
        isOwner: draggedCard?.ownerId === playerId,
      });
      
      // Se a carta não existe, não está na hand, ou não é do jogador, limpar estados imediatamente
      if (!draggedCard || draggedCard.zone !== 'hand' || draggedCard.ownerId !== playerId) {
        console.log('[Hand] stopDrag: Carta não é válida para drag da hand, limpando estados');
        // Limpar imediatamente para evitar múltiplas chamadas
        if (draggingHandCard === draggedCardId) {
          setDraggingHandCard(null);
        }
        setPreviewHandOrder(null);
        setDragPosition(null);
        setDragStartPosition(null);
        setHoveredHandCard(null);
        setInitialHoverIndex(null);
        setOriginalHandOrder(null);
        setHandCardMoved(false);
        setDragStartedFromHand(false);
        handCardPlacedRef.current = false;
        
        // Limpar ref para debug
        handDragStateRef.current = {
          draggingHandCard: null,
          handCardMoved: false,
          previewHandOrder: null,
          dragPosition: null,
          dragStartPosition: null,
        };
        return;
      }
      
      // Se não moveu, verificar se foi apenas um clique (sem movimento significativo)
      if (!handCardMoved && event && dragStartPosition && boardRef.current) {
        const rect = boardRef.current.getBoundingClientRect();
        const cursorX = event.clientX - rect.left;
        const cursorY = event.clientY - rect.top;
        const deltaX = Math.abs(cursorX - dragStartPosition.x);
        const deltaY = Math.abs(cursorY - dragStartPosition.y);
        
        // Se não moveu o suficiente, foi apenas um clique - não fazer nada
        if (deltaX <= 5 && deltaY <= 5) {
          console.log('[Hand] stopDrag: Foi apenas um clique, não moveu o suficiente');
          setDraggingHandCard(null);
          setPreviewHandOrder(null);
          setDragPosition(null);
          setDragStartPosition(null);
          setHoveredHandCard(null);
          setInitialHoverIndex(null);
          setOriginalHandOrder(null);
          setHandCardMoved(false);
          setDragStartedFromHand(false);
          handCardPlacedRef.current = false;
          
          // Resetar flag de execução
          stopDragExecutedRef.current = false;
          
          // Limpar ref para debug
          handDragStateRef.current = {
            draggingHandCard: null,
            handCardMoved: false,
            previewHandOrder: null,
            dragPosition: null,
            dragStartPosition: null,
          };
          return;
        }
      }
      
      // Se não moveu, não fazer nada (já foi tratado acima)
      if (!handCardMoved) {
        console.log('[Hand] stopDrag: Não moveu, cancelando');
        // Resetar flag de execução ANTES de limpar estados
        stopDragExecutedRef.current = false;
        
        setDraggingHandCard(null);
        setPreviewHandOrder(null);
        setDragPosition(null);
        setDragStartPosition(null);
        setHoveredHandCard(null);
        setInitialHoverIndex(null);
        setOriginalHandOrder(null);
        setHandCardMoved(false);
        setDragStartedFromHand(false);
        handCardPlacedRef.current = false;
        
        // Limpar ref para debug
        handDragStateRef.current = {
          draggingHandCard: null,
          handCardMoved: false,
          previewHandOrder: null,
          dragPosition: null,
          dragStartPosition: null,
        };
        return;
      }
      
      let dropPosition: { x: number; y: number } | null = null;
      let startedFromHand = false;
      
      // Verificar se o drag começou na área da hand baseado na posição inicial
      if (dragStartPosition && boardRef.current) {
        const handArea = getHandArea(playerId);
        if (handArea) {
          startedFromHand = 
            dragStartPosition.x >= handArea.x && 
            dragStartPosition.x <= handArea.x + handArea.width &&
            dragStartPosition.y >= handArea.y && 
            dragStartPosition.y <= handArea.y + handArea.height;
        }
      }
      
      // Usar as coordenadas x e y de onde o usuário soltou a carta
      let dropCursorX: number | null = null;
      let dropCursorY: number | null = null;
      if (event && boardRef.current) {
        const rect = boardRef.current.getBoundingClientRect();
        let relativeX = event.clientX - rect.left;
        let relativeY = event.clientY - rect.top;
        
        // Converter coordenadas para o espaço base (1920x1080) se necessário
        if (viewMode === 'separated' && convertMouseToSeparatedCoordinates) {
          const coords = convertMouseToSeparatedCoordinates(
            event.clientX,
            event.clientY,
            playerId,
            rect
          );
          if (coords) {
            dropCursorX = coords.x;
            dropCursorY = coords.y;
          } else {
            // Se não está na janela do player, usar coordenadas relativas
            dropCursorX = relativeX;
            dropCursorY = relativeY;
          }
        } else if ((viewMode === 'individual' || viewMode === 'unified') && convertMouseToUnifiedCoordinates) {
          const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
          dropCursorX = coords.x;
          dropCursorY = coords.y;
        } else {
          // Fallback: usar coordenadas relativas
          dropCursorX = relativeX;
          dropCursorY = relativeY;
        }
        
        // Usar diretamente as coordenadas onde soltou (já convertidas para espaço base)
        dropPosition = {
          x: dropCursorX - CARD_WIDTH / 2,
          y: dropCursorY - CARD_HEIGHT / 2,
        };
      } else if (dragPosition && boardRef.current) {
        // Se não tem evento mas tem posição de drag, usar a última posição conhecida
        // A posição já deve estar no espaço base se foi convertida durante o drag
        dropCursorX = dragPosition.x;
        dropCursorY = dragPosition.y;
        dropPosition = {
          x: dragPosition.x - CARD_WIDTH / 2,
          y: dragPosition.y - CARD_HEIGHT / 2,
        };
      }
      
      // Se arrastou da hand e moveu, verificar se soltou dentro ou fora da área da hand
      if (draggedCard.zone === 'hand' && draggedCard.ownerId === playerId) {
        console.log('[Hand] stopDrag: Verificando condições para mudar zona:', {
          startedFromHand,
          handCardMoved,
          dropPosition,
          dropCursorX,
          dropCursorY,
          draggedCardId: draggedCard.id,
          draggedCardName: draggedCard.name,
          hasEvent: !!event,
          previewHandOrder,
        });
        
        // PRIMEIRO: Verificar se houve preview de reordenação
        // Se há previewHandOrder, significa que durante o drag estava dentro da hand
        // Nesse caso, deve reordenar, não mudar de zona
        const hadPreviewOrder = currentPreviewHandOrder !== null;
        
        // Verificar se a carta foi solta FORA da área da hand
        // Se sim, mudar de zona. Se não, reordenar.
        let droppedOutsideHand = false;
        
        // Se há preview de reordenação, assumir que está dentro da hand (não mudar de zona)
        if (!hadPreviewOrder && startedFromHand && handCardMoved && event && dropCursorX !== null && dropCursorY !== null && boardRef.current) {
          const handArea = getHandArea(playerId);
          if (handArea) {
            // Converter dropCursorX/Y para espaço base antes de comparar
            const rect = boardRef.current.getBoundingClientRect();
            let baseX: number;
            let baseY: number;
            
            if (viewMode === 'separated' && convertMouseToSeparatedCoordinates) {
              // Para separated, precisamos converter usando as coordenadas do evento
              const coords = convertMouseToSeparatedCoordinates(
                event.clientX,
                event.clientY,
                playerId,
                rect
              );
              if (coords) {
                baseX = coords.x;
                baseY = coords.y;
              } else {
                // Fallback: usar dropCursorX/Y diretamente (já pode estar no espaço base)
                baseX = dropCursorX;
                baseY = dropCursorY;
              }
            } else if ((viewMode === 'individual' || viewMode === 'unified') && convertMouseToUnifiedCoordinates) {
              const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
              baseX = coords.x;
              baseY = coords.y;
            } else {
              // Fallback: assumir que dropCursorX/Y já estão no espaço base
              baseX = dropCursorX;
              baseY = dropCursorY;
            }
            
            // Verificar se a posição onde soltou está FORA da área da hand (no espaço base)
            // Adicionar uma pequena margem para facilitar a detecção
            const margin = 20;
            const isInsideHand = 
              baseX >= (handArea.x - margin) && 
              baseX <= (handArea.x + handArea.width + margin) &&
              baseY >= (handArea.y - margin) && 
              baseY <= (handArea.y + handArea.height + margin);
            
            droppedOutsideHand = !isInsideHand;
            
            console.log('[Hand] stopDrag: Verificando se soltou fora da hand:', {
              dropCursorX,
              dropCursorY,
              baseX,
              baseY,
              handArea: { x: handArea.x, y: handArea.y, width: handArea.width, height: handArea.height },
              isInsideHand,
              droppedOutsideHand,
              margin,
              hadPreviewOrder,
            });
          } else {
            // Se não conseguiu calcular a área da hand, assumir que está dentro
            droppedOutsideHand = false;
          }
        } else if (hadPreviewOrder) {
          // Se há preview de reordenação, está dentro da hand
          droppedOutsideHand = false;
          console.log('[Hand] stopDrag: Há preview de reordenação, assumindo dentro da hand');
        }
        
        // Se soltou FORA da hand, mudar de zona (prioridade sobre reordenação)
        // IMPORTANTE: Verificar ANTES de qualquer lógica de reordenação
        if (startedFromHand && handCardMoved && dropPosition && droppedOutsideHand && event && boardRef.current) {
          const rect = boardRef.current.getBoundingClientRect();
          
          // Converter coordenadas para o espaço base antes de detectar zona
          let baseX: number;
          let baseY: number;
          
          if (viewMode === 'separated' && convertMouseToSeparatedCoordinates) {
            const coords = convertMouseToSeparatedCoordinates(
              event.clientX,
              event.clientY,
              playerId,
              rect
            );
            if (coords) {
              baseX = coords.x;
              baseY = coords.y;
            } else {
              // Se não está na janela do player, usar dropCursorX/Y já convertidos
              baseX = dropCursorX || 0;
              baseY = dropCursorY || 0;
            }
          } else if ((viewMode === 'individual' || viewMode === 'unified') && convertMouseToUnifiedCoordinates) {
            const coords = convertMouseToUnifiedCoordinates(event.clientX, event.clientY, rect);
            baseX = coords.x;
            baseY = coords.y;
          } else {
            // Fallback: usar dropCursorX/Y já convertidos
            baseX = dropCursorX || 0;
            baseY = dropCursorY || 0;
          }
          
          // Usar a função de detecção de zona do Board (espera coordenadas no espaço base)
          const detectedZone = detectZoneAtPosition(baseX, baseY);
          
          // Mudar de zona (sempre que soltou fora da hand, mesmo que detecte hand, usar battlefield)
          if (detectedZone.zone) {
            // Se detectou hand mas soltou fora, usar battlefield
            const targetZone = detectedZone.zone === 'hand' ? 'battlefield' : detectedZone.zone;
            // Ajustar posição baseado na zona detectada
            let finalPosition = dropPosition;
            
            if (targetZone === 'battlefield') {
              // Converter dropPosition para espaço base se necessário
              // dropPosition já está em coordenadas relativas ao board, precisa converter para espaço base
              const rect = boardRef.current?.getBoundingClientRect();
              if (rect) {
                // dropPosition está em pixels relativos ao board, precisa converter para espaço base
                // Usar a mesma lógica de conversão do Board
                let baseDropX = dropPosition.x;
                let baseDropY = dropPosition.y;
                
                // Se estiver em modo separated, pode precisar de conversão adicional
                // Por enquanto, assumir que dropPosition já está no espaço correto
                finalPosition = {
                  x: Math.max(0, Math.min(BASE_BOARD_WIDTH - CARD_WIDTH, baseDropX)),
                  y: Math.max(0, Math.min(BASE_BOARD_HEIGHT - CARD_HEIGHT, baseDropY)),
                };
              } else {
                finalPosition = {
                  x: Math.max(0, Math.min(BASE_BOARD_WIDTH - CARD_WIDTH, dropPosition.x)),
                  y: Math.max(0, Math.min(BASE_BOARD_HEIGHT - CARD_HEIGHT, dropPosition.y)),
                };
              }
            } else if (targetZone === 'cemetery') {
              // Posição será calculada pelo store baseado no cemitério
              finalPosition = { x: 0, y: 0 };
            } else if (targetZone === 'library') {
              // Posição será calculada pelo store baseado no library
              finalPosition = { x: 0, y: 0 };
            }
            
            console.log('[Hand] stopDrag: Mudando zona de hand para', targetZone, ':', {
              cardId: draggedCard.id,
              cardName: draggedCard.name,
              from: 'hand',
              to: targetZone,
              finalPosition,
            });
            
            // Limpar o estado ANTES de mudar a zona para evitar múltiplas chamadas
            setDraggingHandCard(null);
            setPreviewHandOrder(null);
            setDragPosition(null);
            setDragStartPosition(null);
            setHoveredHandCard(null);
            setInitialHoverIndex(null);
            setOriginalHandOrder(null);
            setDragStartedFromHand(false);
            dragStartedFromHandRef.current = false;
            handCardPlacedRef.current = false;
            
            // Limpar ref para debug
            handDragStateRef.current = {
              draggingHandCard: null,
              handCardMoved: false,
              previewHandOrder: null,
              dragPosition: null,
              dragStartPosition: null,
            };
            
            // Desativar o drag do Board também
            if (clearBoardDrag) {
              clearBoardDrag();
            }
            
            // Mudar a zona da carta usando a zona detectada
            addEventLog('CHANGE_ZONE', `Mudando zona: ${draggedCard.name} (hand → ${targetZone})`, draggedCard.id, draggedCard.name, {
              from: 'hand',
              to: targetZone,
              position: finalPosition,
              handIndex: draggedCard.handIndex,
            });
            changeCardZone(draggedCard.id, targetZone, finalPosition);
            
            // Manter handCardMoved por um tempo para impedir cliques após o movimento
            setTimeout(() => {
              setHandCardMoved(false);
            }, 300);
            
            // Log DRAG_END antes de retornar (quando muda de zona)
            if (handCardMoved) {
              addEventLog('DRAG_END', `Finalizando drag da hand: ${draggedCard.name}`, draggedCard.id, draggedCard.name, {
                zone: draggedCard.zone,
                handCardMoved,
                previewHandOrder,
                droppedOutsideHand: true,
              });
            }
            
            return; // Retornar imediatamente após mudar a zona
          }
        }
        
        // Verificar se houve reordenação (previewHandOrder não é null e diferente do original)
        const originalIndex = originalHandOrder?.[draggedCardId];
        const hadReordering = currentPreviewHandOrder !== null;
        const actuallyReordered = hadReordering && originalIndex !== undefined && originalIndex !== currentPreviewHandOrder;
        
        // Log evento de drag end ANTES de reordenar, se realmente moveu
        // IMPORTANTE: Sempre logar quando houver movimento, independente de reordenação
        // Isso garante que o DRAG_END apareça mesmo quando não há reordenação
        if (handCardMoved) {
          addEventLog('DRAG_END', `Finalizando drag da hand: ${draggedCard.name}`, draggedCard.id, draggedCard.name, {
            zone: draggedCard.zone,
            handCardMoved,
            previewHandOrder,
            droppedOutsideHand,
            actuallyReordered,
          });
        }
        
        // Reordenar cartas na hand se soltou DENTRO da área da hand
        // Só reordenar se realmente moveu E o índice mudou E NÃO soltou fora da hand
        // IMPORTANTE: Só executar uma vez por drag
        if (actuallyReordered && !droppedOutsideHand) {
          // Recalcular a posição final baseada na posição onde a carta foi soltada
          let finalNewIndex = currentPreviewHandOrder;
          
          if (event && boardRef.current && dropCursorX !== null && dropCursorY !== null) {
            const handArea = getHandArea(playerId);
            if (handArea) {
              const currentBoard = useGameStore.getState().board;
              const playerHandCards = currentBoard.filter((c) => c.zone === 'hand' && c.ownerId === playerId);
              const allCards = [...playerHandCards].sort((a, b) => {
                const indexA = originalHandOrder?.[a.id] ?? a.handIndex ?? 0;
                const indexB = originalHandOrder?.[b.id] ?? b.handIndex ?? 0;
                return indexA - indexB;
              });
              
              const totalCards = allCards.length;
              const maxScroll = Math.max(0, totalCards - maxRenderCards);
              const currentScrollIndex = Math.min(handScrollIndex, maxScroll);
              const renderStartIndex = currentScrollIndex;
              
              // Calcular posição visual baseada na posição onde soltou
              // As cartas começam em 80px dentro da hand area
              const handAreaLeft = handArea.x;
              const relativeX = dropCursorX - handAreaLeft;
              const cardStartOffset = 80; // Offset onde as cartas começam dentro da hand area
              const adjustedX = relativeX - cardStartOffset;
              
              const visibleCardsCount = Math.min(maxRenderCards, totalCards - renderStartIndex);
              let visualPosition = Math.floor(adjustedX / HAND_CARD_LEFT_SPACING);
              visualPosition = Math.max(0, Math.min(visibleCardsCount - 1, visualPosition));
              
              const newIndex = renderStartIndex + visualPosition;
              finalNewIndex = Math.max(0, Math.min(totalCards - 1, newIndex));
            }
          }
          
          console.log('[Hand] stopDrag: Reordenando carta na hand:', {
            cardId: draggedCard.id,
            cardName: draggedCard.name,
            originalIndex,
            previewIndex: currentPreviewHandOrder,
            finalNewIndex,
            dropCursorX,
            dropCursorY,
          });
          
          addEventLog('REORDER_HAND', `Reordenando hand: ${draggedCard.name} (${originalIndex} → ${finalNewIndex})`, draggedCard.id, draggedCard.name, {
            fromIndex: originalIndex,
            toIndex: finalNewIndex,
          });
          
          // Reordenar ANTES de limpar estados (para garantir que a reordenação aconteça)
          reorderHandCard(draggedCardId, finalNewIndex);
          
          // Não atualizar originalHandOrder aqui - deixar o useEffect sincronizar automaticamente
          // quando o board mudar. Isso garante que o originalHandOrder seja atualizado
          // corretamente após o reorder, permitindo reordenar a mesma carta múltiplas vezes
          
          // Limpar TODOS os estados DEPOIS de reordenar
          // IMPORTANTE: Manter stopDragExecutedRef como true para evitar execuções duplicadas
          // Ele será resetado apenas quando iniciar um novo drag
          activeDragCardIdRef.current = null;
          setDraggingHandCard(null);
          setPreviewHandOrder(null);
          setDragPosition(null);
          setDragStartPosition(null);
          setHoveredHandCard(null);
          setInitialHoverIndex(null);
          setHandCardMoved(false);
          setDragStartedFromHand(false);
          dragStartedFromHandRef.current = false;
          handCardPlacedRef.current = false;
          
          // Limpar ref para debug
          handDragStateRef.current = {
            draggingHandCard: null,
            handCardMoved: false,
            previewHandOrder: null,
            dragPosition: null,
            dragStartPosition: null,
          };
          
          // NÃO resetar stopDragExecutedRef aqui - ele será resetado quando iniciar um novo drag
          // Isso previne que o useEffect seja re-executado quando o board mudar após reordenar
          
          // Retornar imediatamente após reordenar para evitar qualquer processamento adicional
          return;
        }
      }
      
      // Limpar todos os estados
      activeDragCardIdRef.current = null;
      setDraggingHandCard(null);
      setPreviewHandOrder(null);
      setDragPosition(null);
      setDragStartPosition(null);
      setHoveredHandCard(null);
      setInitialHoverIndex(null);
      setOriginalHandOrder(null);
      setHandCardMoved(false);
      setDragStartedFromHand(false);
      dragStartedFromHandRef.current = false;
      handCardPlacedRef.current = false;
      
      // Limpar ref para debug
      handDragStateRef.current = {
        draggingHandCard: null,
        handCardMoved: false,
        previewHandOrder: null,
        dragPosition: null,
        dragStartPosition: null,
      };
      
      // Resetar flag de execução DEPOIS de limpar todos os estados
      stopDragExecutedRef.current = false;
    };
    
    const handleUp = (e: PointerEvent) => stopDrag(e);
    
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [
    draggingHandCard,
    previewHandOrder,
    originalHandOrder,
    board,
    playerId,
    reorderHandCard,
    hoveredHandCard,
    handScrollIndex,
    handCardMoved,
    dragPosition,
    dragStartPosition,
    changeCardZone,
    detectZoneAtPosition,
    getPlayerArea,
    players,
    addEventLog,
    viewMode,
    convertMouseToSeparatedCoordinates,
    convertMouseToUnifiedCoordinates,
  ]);

  // Sincronizar originalHandOrder quando o board mudar (após reordenação)
  useEffect(() => {
    // Se não há drag ativo, sempre atualizar originalHandOrder com a ordem atual do board
    // Isso garante que após uma reordenação, o originalHandOrder seja atualizado
    if (!draggingHandCard) {
      const playerHandCards = board.filter((c) => c.zone === 'hand' && c.ownerId === playerId);
      const sortedCards = [...playerHandCards].sort((a, b) => {
        if (a.handIndex !== undefined && b.handIndex !== undefined) {
          return a.handIndex - b.handIndex;
        }
        if (a.handIndex !== undefined) return -1;
        if (b.handIndex !== undefined) return 1;
        return a.id.localeCompare(b.id);
      });
      
      const currentOrder: Record<string, number> = {};
      sortedCards.forEach((c, idx) => {
        currentOrder[c.id] = c.handIndex ?? idx;
      });
      
      // Sempre atualizar para garantir sincronização após reordenação
      // Comparar se realmente mudou para evitar re-renders desnecessários
      const orderChanged = !originalHandOrder || 
        Object.keys(currentOrder).length !== Object.keys(originalHandOrder).length ||
        Object.keys(currentOrder).some(id => currentOrder[id] !== originalHandOrder[id]);
      
      if (orderChanged) {
        console.log('[Hand] Atualizando originalHandOrder:', {
          oldOrder: originalHandOrder,
          newOrder: currentOrder,
        });
        setOriginalHandOrder(currentOrder);
      }
    }
  }, [board, playerId, draggingHandCard]);

  // Navegação com teclado (setas esquerda/direita)
  useEffect(() => {
    if (!boardRef.current) return;
    
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignorar se estiver digitando em um input ou textarea
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      
      // Verificar se há cartas na hand do jogador
      const playerHandCards = board.filter((c) => c.zone === 'hand' && c.ownerId === playerId);
      if (playerHandCards.length === 0) return;
      
      const totalCards = playerHandCards.length;
      const maxScroll = Math.max(0, totalCards - maxRenderCards);
      
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (handScrollIndex > 0 && !isSliding) {
          setIsSliding(true);
          setHandScrollIndex(Math.max(0, handScrollIndex - 1));
          setTimeout(() => setIsSliding(false), 300);
        }
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (handScrollIndex < maxScroll && !isSliding) {
          setIsSliding(true);
          setHandScrollIndex(Math.min(maxScroll, handScrollIndex + 1));
          setTimeout(() => setIsSliding(false), 300);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [board, playerId, handScrollIndex, isSliding]);

  if (!boardRef.current) return null;

  return (
    <>
      {players.length > 0 && players.map((player) => {
        const handArea = getHandArea(player.id);
        if (!handArea) return null;
        const isCurrentPlayer = player.id === playerId;
        const playerHandCards = handCards.filter((c) => c.ownerId === player.id);
        
        if (!isCurrentPlayer) return null;
        
        const boardRect = boardRef.current!.getBoundingClientRect();
        
        return (
          <div
            key={`hand-${player.id}`}
            className={`hand-area ${isCurrentPlayer ? 'current-player-hand' : ''}`}
            style={{
              left: `${(handArea.x / boardRect.width) * 100}%`,
              top: `${(handArea.y / boardRect.height) * 100}%`,
              width: `${(handArea.width / boardRect.width) * 100}%`,
              height: `${(handArea.height / boardRect.height) * 100}%`,
            }}
          >
            <div className="hand-cards">
              {(() => {
                let sortedHandCards = [...playerHandCards].sort((a, b) => {
                  if (a.handIndex !== undefined && b.handIndex !== undefined) {
                    return a.handIndex - b.handIndex;
                  }
                  if (a.handIndex !== undefined) return -1;
                  if (b.handIndex !== undefined) return 1;
                  return a.id.localeCompare(b.id);
                });
                
                let previewOrder: Record<string, number> | null = null;
                if (draggingHandCard && previewHandOrder !== null && originalHandOrder) {
                  previewOrder = { ...originalHandOrder };
                  const originalIndex = originalHandOrder[draggingHandCard];
                  const newIndex = previewHandOrder;
                  
                  if (originalIndex !== undefined && originalIndex !== newIndex) {
                    const draggedCardId = draggingHandCard;
                    Object.keys(previewOrder).forEach((cardId) => {
                      const currentIndex = previewOrder![cardId];
                      if (cardId === draggedCardId) {
                        previewOrder![cardId] = newIndex;
                      } else if (originalIndex < newIndex) {
                        if (currentIndex > originalIndex && currentIndex <= newIndex) {
                          previewOrder![cardId] = currentIndex - 1;
                        }
                      } else {
                        if (currentIndex >= newIndex && currentIndex < originalIndex) {
                          previewOrder![cardId] = currentIndex + 1;
                        }
                      }
                    });
                  }
                }
                
                if (previewOrder) {
                  sortedHandCards = sortedHandCards.sort((a, b) => {
                    const indexA = previewOrder![a.id] ?? originalHandOrder?.[a.id] ?? a.handIndex ?? 0;
                    const indexB = previewOrder![b.id] ?? originalHandOrder?.[b.id] ?? b.handIndex ?? 0;
                    return indexA - indexB;
                  });
                }
                
                const totalCards = sortedHandCards.length;
                const maxScroll = Math.max(0, totalCards - maxRenderCards);
                const currentScrollIndex = Math.min(handScrollIndex, maxScroll);
                const renderStartIndex = currentScrollIndex;
                
                const visibleCards = sortedHandCards.slice(
                  renderStartIndex,
                  renderStartIndex + maxRenderCards
                );
                
                let spaceIndex: number | null = null;
                if (hoveredHandCard && !draggingHandCard) {
                  const hoveredIndex = originalHandOrder?.[hoveredHandCard] ?? 
                    playerHandCards.findIndex((c) => c.id === hoveredHandCard);
                  if (hoveredIndex >= renderStartIndex && hoveredIndex < renderStartIndex + visibleCards.length) {
                    spaceIndex = hoveredIndex - renderStartIndex;
                  }
                } else if (draggingHandCard && initialHoverIndex !== null) {
                  if (initialHoverIndex >= renderStartIndex && initialHoverIndex < renderStartIndex + visibleCards.length) {
                    spaceIndex = initialHoverIndex - renderStartIndex;
                  }
                }
                
                return (
                  <>
                    {visibleCards.map((card, visibleIndex) => {
                      const isDragging = draggingHandCard === card.id;
                      const isZoomed = zoomedCard === card.id;
                      const isHovered = hoveredHandCard === card.id && !draggingHandCard;
                      
                      let displayIndex: number;
                      if (previewOrder && previewOrder[card.id] !== undefined) {
                        displayIndex = previewOrder[card.id];
                      } else if (originalHandOrder && originalHandOrder[card.id] !== undefined) {
                        displayIndex = originalHandOrder[card.id];
                      } else {
                        displayIndex = card.handIndex ?? renderStartIndex + visibleIndex;
                      }
                      
                      const actualIndex = originalHandOrder?.[card.id] ?? card.handIndex ?? renderStartIndex + visibleIndex;
                      
                      let positionIndex: number;
                      if (draggingHandCard && previewHandOrder !== null && previewOrder) {
                        const minVisibleIndex = renderStartIndex;
                        const maxVisibleIndex = renderStartIndex + maxRenderCards - 1;
                        
                        if (displayIndex >= minVisibleIndex && displayIndex <= maxVisibleIndex) {
                          positionIndex = displayIndex - renderStartIndex;
                        } else {
                          positionIndex = visibleIndex;
                        }
                      } else {
                        positionIndex = visibleIndex;
                      }
                      
                      // Calcular posição X em pixels: começa em 20px, incrementa HAND_CARD_LEFT_SPACING por carta
                      const cardLeftPx = 80 + (positionIndex * HAND_CARD_LEFT_SPACING);
                      
                      if (isDragging) {
                        const spaceDisplayIndex = previewHandOrder !== null ? previewHandOrder : actualIndex;
                        const minVisibleIndex = renderStartIndex;
                        const maxVisibleIndex = renderStartIndex + maxRenderCards - 1;
                        
                        let spacePositionIndex: number;
                        if (spaceDisplayIndex >= minVisibleIndex && spaceDisplayIndex <= maxVisibleIndex) {
                          spacePositionIndex = spaceDisplayIndex - renderStartIndex;
                        } else {
                          spacePositionIndex = visibleIndex;
                        }
                        
                        // Calcular posição do espaço em pixels: começa em 20px, incrementa HAND_CARD_LEFT_SPACING por carta
                        const spaceLeftPx = 20 + (spacePositionIndex * HAND_CARD_LEFT_SPACING);
                        const cardHeightPercent = (HAND_CARD_HEIGHT / boardRect.height) * 100;
                        const cardWidthPercent = (HAND_CARD_WIDTH / boardRect.width) * 100;
                        
                        return (
                          <div
                            key={card.id}
                            style={{
                              position: 'absolute',
                              left: `${spaceLeftPx}px`,
                              top: '85%',
                              width: `${cardWidthPercent}%`,
                              height: `${cardHeightPercent}%`,
                              pointerEvents: 'none',
                            }}
                          />
                        );
                      }
                      
                      let horizontalOffset = 0;
                      let verticalOffset = 0;
                      const HOVER_LIFT_PX = 10;
                      const HOVER_SPACE_PX = 40;
                      
                      if (hoveredHandCard && !draggingHandCard && spaceIndex !== null) {
                        if (visibleIndex === spaceIndex && isHovered) {
                          verticalOffset = -HOVER_LIFT_PX;
                        } else if (visibleIndex < spaceIndex) {
                          horizontalOffset = -HOVER_SPACE_PX;
                        } else if (visibleIndex > spaceIndex) {
                          horizontalOffset = HOVER_SPACE_PX;
                        }
                      }
                      
                      if (draggingHandCard && previewHandOrder !== null && !isDragging && originalHandOrder) {
                        const originalIndex = originalHandOrder[draggingHandCard];
                        const hoverIndex = initialHoverIndex !== null ? initialHoverIndex : originalIndex;
                        
                        if (previewHandOrder === originalIndex && hoverIndex !== null && hoverIndex !== undefined) {
                          const hoveredVisibleIndex = visibleCards.findIndex(c => {
                            const cardOriginalIndex = originalHandOrder?.[c.id] ?? c.handIndex ?? -1;
                            return cardOriginalIndex === hoverIndex;
                          });
                          
                          if (hoveredVisibleIndex !== -1) {
                            if (visibleIndex < hoveredVisibleIndex) {
                              horizontalOffset = -HOVER_SPACE_PX;
                            } else if (visibleIndex > hoveredVisibleIndex) {
                              horizontalOffset = HOVER_SPACE_PX;
                            }
                          }
                        }
                      }
                      
                      const normalizedPos = visibleCards.length > 1 
                        ? (positionIndex / (visibleCards.length - 1)) * 2 - 1 
                        : 0;
                      const curveHeight = 8;
                      const ellipseY = Math.sqrt(Math.max(0, 1 - normalizedPos * normalizedPos));
                      const curveY = curveHeight * ellipseY;
                      const cardYPercent = 85 - curveY;
                      const rotation = normalizedPos * 5;
                      
                      return (
                        <div
                          key={card.id}
                          className={`hand-card-wrapper ${isDragging ? 'dragging' : ''} ${isZoomed ? 'zoomed' : ''} ${isHovered ? 'hovered' : ''} ${isSliding ? 'sliding' : ''}`}
                          style={{
                            position: 'absolute',
                            left: `${cardLeftPx}px`,
                            top: `${cardYPercent}%`,
                            zIndex: isDragging ? 1000 : (isZoomed ? 100 : actualIndex),
                            transform: isZoomed 
                              ? undefined
                              : `translate(calc(-50% + ${horizontalOffset}px), calc(-100% + ${verticalOffset}px)) rotate(${rotation}deg)`,
                            transformOrigin: 'center bottom',
                            transition: isSliding && !isDragging ? 'left 0.3s ease-in-out' : undefined,
                          }}
                          onMouseEnter={() => {
                            if (!draggingHandCard) {
                              setHoveredHandCard(card.id);
                            }
                          }}
                          onMouseLeave={() => {
                            if (!draggingHandCard) {
                              setHoveredHandCard(null);
                            }
                          }}
                          onPointerDown={(event) => {
                            setLastTouchedCard(card);
                            if (event.button === 1) {
                              event.preventDefault();
                              if (zoomedCard === card.id) {
                                setZoomedCard(null);
                              } else {
                                setZoomedCard(card.id);
                              }
                              return;
                            }
                            
                            if (card.zone === 'hand' && card.ownerId === playerId) {
                              prepareHandDrag(card, event);
                            } else {
                              startDrag(card, event);
                            }
                          }}
                          onClick={(event) => {
                            // Impedir clique se moveu recentemente ou está arrastando
                            if (handCardMoved || draggingHandCard === card.id) {
                              event.preventDefault();
                              event.stopPropagation();
                              return;
                            }
                            // Obter a carta atualizada do store para garantir que temos a versão mais recente
                            const currentBoard = useGameStore.getState().board;
                            const currentCard = currentBoard.find((c) => c.id === card.id);
                            if (currentCard) {
                              handleCardClick(currentCard, event);
                            } else {
                              handleCardClick(card, event);
                            }
                          }}
                          onContextMenu={(event) => handleCardContextMenu(card, event)}
                        >
                          <CardToken
                            card={card}
                            onPointerDown={() => {}}
                            onClick={() => {}}
                            onContextMenu={() => {}}
                            ownerName={ownerName(card)}
                            width={HAND_CARD_WIDTH}
                            height={HAND_CARD_HEIGHT}
                            showBack={false}
                          />
                          {showDebugMode && (
                            <div
                              style={{
                                position: 'absolute',
                                top: '-20px',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                                color: '#fff',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '9px',
                                fontFamily: 'monospace',
                                whiteSpace: 'nowrap',
                                zIndex: 200,
                                border: '1px solid #555',
                                pointerEvents: 'none',
                              }}
                            >
                              {card.id}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>
            
            {/* Setas de navegação */}
            {(() => {
              const sortedHandCards = [...playerHandCards].sort((a, b) => {
                if (a.handIndex !== undefined && b.handIndex !== undefined) {
                  return a.handIndex - b.handIndex;
                }
                if (a.handIndex !== undefined) return -1;
                if (b.handIndex !== undefined) return 1;
                return a.id.localeCompare(b.id);
              });
              
              const totalCards = sortedHandCards.length;
              const maxScroll = Math.max(0, totalCards - maxRenderCards);
              const currentScrollIndex = Math.min(handScrollIndex, maxScroll);
              const renderStartIndex = currentScrollIndex;
              
              return (
                <>
                  {renderStartIndex > 0 && (
                    <button
                      className="hand-nav-button hand-nav-left"
                      style={{
                        position: 'absolute',
                        left: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        zIndex: 100,
                      }}
                      onClick={() => {
                        if (!isSliding) {
                          setIsSliding(true);
                          setHandScrollIndex(Math.max(0, handScrollIndex - 1));
                          setTimeout(() => setIsSliding(false), 300);
                        }
                      }}
                      aria-label="Cartas anteriores"
                    >
                      ←
                    </button>
                  )}
                  
                  <div
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0px',
                      zIndex: 100,
                    }}
                  >
                    {totalCards > 0 && (
                      <span
                        style={{
                          color: '#f8fafc',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          position: 'absolute',
                          top: '-24px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                        }}
                      >
                        {totalCards}
                      </span>
                    )}
                    {renderStartIndex + maxRenderCards < totalCards && (
                      <button
                        className="hand-nav-button hand-nav-right"
                        onClick={() => {
                          if (!isSliding) {
                            setIsSliding(true);
                            setHandScrollIndex(Math.min(maxScroll, handScrollIndex + 1));
                            setTimeout(() => setIsSliding(false), 300);
                          }
                        }}
                        aria-label="Próximas cartas"
                      >
                        →
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        );
      })}
      
      {/* Carta arrastada seguindo o cursor */}
      {draggingHandCard && dragPosition && boardRef.current && (() => {
        // Usar board atualizado do store para garantir que temos a versão mais recente
        const currentBoard = useGameStore.getState().board;
        const draggedCard = currentBoard.find((c) => c.id === draggingHandCard);
        if (!draggedCard) return null;
        const boardRect = boardRef.current.getBoundingClientRect();
        const draggedXPercent = (dragPosition.x / boardRect.width) * 100;
        const handYPercent = 85;
        const draggedYPercent = Math.min(handYPercent - 5, (dragPosition.y / boardRect.height) * 100 - 10);
        return (
          <div
            className="hand-card-wrapper dragging"
            style={{
              position: 'absolute',
              left: `${draggedXPercent}%`,
              top: `${draggedYPercent}%`,
              zIndex: 1000,
              transform: 'translate(-50%, -100%)',
              pointerEvents: 'none',
            }}
          >
            <CardToken
              card={draggedCard}
              onPointerDown={() => {}}
              onClick={() => {}}
              onContextMenu={() => {}}
              ownerName={ownerName(draggedCard)}
              width={HAND_CARD_WIDTH}
              height={HAND_CARD_HEIGHT}
              showBack={false}
            />
          </div>
        );
      })()}
    </>
  );
};

export default Hand;

