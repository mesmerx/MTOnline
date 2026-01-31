import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { CardOnBoard } from '../store/useGameStore';
import CardToken from './CardToken';
import type { Counter } from '../store/useGameStore';
import { BASE_BOARD_WIDTH, BASE_BOARD_HEIGHT } from './BoardTypes';
import HandSearch from './HandSearch';

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
  playerName: string;
  board: CardOnBoard[];
  players: Array<{ id: string; name: string }>;
  getPlayerArea: (ownerId: string) => { x: number; y: number; width: number; height: number } | null;
  handleCardClick: (card: CardOnBoard, event: React.MouseEvent) => void;
  handleCardContextMenu: (card: CardOnBoard, event: React.MouseEvent) => void;
  startDrag: (card: CardOnBoard, event: ReactPointerEvent) => void;
  ownerName: (card: CardOnBoard) => string;
  changeCardZone: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery' | 'exile', position: Point, libraryPlace?: 'top' | 'bottom' | 'random') => void;
  detectZoneAtPosition: (x: number, y: number) => { zone: 'battlefield' | 'hand' | 'library' | 'cemetery' | 'exile' | null; ownerId?: string };
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
    dragOffset: Point | null;
  }>;
  addEventLog: (type: string, message: string, cardId?: string, cardName?: string, details?: Record<string, unknown>) => void;
  showDebugMode?: boolean;
  viewMode?: 'individual' | 'separated';
  convertMouseToSeparatedCoordinates?: (mouseX: number, mouseY: number, playerId: string, rect: DOMRect) => { x: number; y: number } | null;
  convertMouseToUnifiedCoordinates?: (mouseX: number, mouseY: number, rect: DOMRect) => { x: number; y: number };
  counters?: Counter[];
  moveCounter?: (counterId: string, position: Point) => void;
  modifyCounter?: (counterId: string, delta?: number, deltaX?: number, deltaY?: number, setValue?: number, setX?: number, setY?: number) => void;
  removeCounterToken?: (counterId: string) => void;
  getCemeteryPosition?: (playerName: string) => Point | null;
  getLibraryPosition?: (playerName: string) => Point | null;
}

const sortHandComparator = (a: CardOnBoard, b: CardOnBoard) => {
  if (a.handIndex !== undefined && b.handIndex !== undefined) {
    return a.handIndex - b.handIndex;
  }
  if (a.handIndex !== undefined) return -1;
  if (b.handIndex !== undefined) return 1;
  return a.id.localeCompare(b.id);
};

const Hand = ({
  boardRef,
  playerName,
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
  viewMode = 'individual',
  convertMouseToSeparatedCoordinates,
  convertMouseToUnifiedCoordinates,
  getCemeteryPosition,
  getLibraryPosition,
}: HandProps) => {
  const [showHandSearch, setShowHandSearch] = useState(false);
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
  const [maxCardsToShow] = useState<number>(0); // 0 = mostrar todas
  
  const dragUpdateRef = useRef<number>(0);
  const stopDragExecutedRef = useRef<boolean>(false); // Flag para evitar múltiplas execuções
  const activeDragCardIdRef = useRef<string | null>(null); // Ref para rastrear qual carta está sendo arrastada atualmente

  const handCards = useMemo(() => board.filter((c) => c.zone === 'hand'), [board]);
  const handCardsByOwner = useMemo(() => {
    const map = new Map<string, CardOnBoard[]>();
    handCards.forEach((card) => {
      const existing = map.get(card.ownerId);
      if (existing) {
        existing.push(card);
      } else {
        map.set(card.ownerId, [card]);
      }
    });
    map.forEach((cards, owner) => {
      map.set(owner, cards.slice().sort(sortHandComparator));
    });
    return map;
  }, [handCards]);
  const playerHandCards = handCardsByOwner.get(playerName) ?? [];

  const getHandArea = useCallback((ownerId: string) => {
    if (!boardRef.current || players.length === 0) return null;
    const rect = boardRef.current.getBoundingClientRect();
    // ownerId pode ser o nome do player (quando chamado com playerName) ou o ID
    // Tentar encontrar por nome primeiro, depois por ID
    const player = players.find((p) => p.name === ownerId) || players.find((p) => p.id === ownerId);
    if (!player) return null;

    const playerHandCardsForOwner = handCardsByOwner.get(player.name) ?? [];
    const totalCards = playerHandCardsForOwner.length;
    
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
    
    // Área Y: baseada na altura da carta
    // Reduzir margens para evitar espaço vazio no topo
    // Margem inferior pequena (5px) e margem superior mínima (2px) apenas para o arco
    const handHeight = HAND_CARD_HEIGHT + 5 + 2; // Altura da carta + margem inferior + margem superior mínima
    const handY = rect.height - handHeight;

    return {
      x: handX,
      y: handY,
      width: handWidth,
      height: handHeight,
    };
  }, [boardRef, players, handCardsByOwner]);

  const prepareHandDrag = (card: CardOnBoard, event: ReactPointerEvent) => {
    if (card.ownerId !== playerName) return;
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
    
    const sortedCards = playerHandCards;
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
    
    // Calcular a posição real da carta na mão para evitar "pulo" inicial
    let cardRealX = startX;
    let cardRealY = startY;
    if (boardRef.current) {
      const handArea = getHandArea(playerName);
      if (handArea) {
        const cardIndex = originalOrder[card.id] ?? sortedCards.findIndex((c) => c.id === card.id);
        if (cardIndex >= 0) {
          const positionIndex = cardIndex;
          const cardLeftPx = 80 + (positionIndex * HAND_CARD_LEFT_SPACING);
          
          // Calcular Y com o arco
          const visibleCardsCount = Math.min(maxRenderCards, sortedCards.length);
          const normalizedPos = visibleCardsCount > 1 
            ? (positionIndex / (visibleCardsCount - 1)) * 2 - 1 
            : 0;
          const curveHeight = 8;
          const ellipseY = Math.sqrt(Math.max(0, 1 - normalizedPos * normalizedPos));
          const curveY = curveHeight * ellipseY;
          const cardYPercent = 85 - curveY;
          
          // Converter para coordenadas relativas ao board
          cardRealX = handArea.x + cardLeftPx;
          cardRealY = handArea.y + (cardYPercent / 100) * handArea.height;
        }
      }
    }
    
    setHandCardMoved(false);
    handCardPlacedRef.current = false;
    setDragStartedFromHand(true);
    dragStartedFromHandRef.current = true;
    // Atualizar ref com o ID da carta sendo arrastada ANTES de atualizar o estado
    activeDragCardIdRef.current = card.id;
    
    setDraggingHandCard(card.id);
    setHoveredHandCard(null);
    // Calcular offset do mouse em relação ao centro da carta
    // A carta usa translate(-50%, -100%) então o ponto de referência é o centro inferior
    // O centro da carta seria: X = cardRealX, Y = cardRealY - HAND_CARD_HEIGHT/2
    const cardCenterX = cardRealX;
    const cardCenterY = cardRealY - HAND_CARD_HEIGHT / 2;
    const offsetX = startX - cardCenterX;
    const offsetY = startY - cardCenterY;
    const dragOffsetValue = { x: offsetX, y: offsetY };
    // Usar a posição real da carta na mão como posição inicial para evitar "pulo"
    setDragPosition({ x: cardRealX, y: cardRealY });
    setDragStartPosition({ x: startX, y: startY }); // Manter posição do cursor para cálculo de movimento
    setPreviewHandOrder(null);
    setPendingHandDrag(null);
    
    // Resetar flag de execução
    stopDragExecutedRef.current = false;
    
    // Atualizar ref para debug
    handDragStateRef.current = {
      draggingHandCard: card.id,
      handCardMoved: false,
      previewHandOrder: null,
      dragPosition: { x: cardRealX, y: cardRealY },
      dragStartPosition: { x: startX, y: startY },
      dragOffset: dragOffsetValue,
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
        if (card && card.zone === 'hand' && card.ownerId === playerName) {
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
  }, [pendingHandDrag, board, playerName, hoveredHandCard]);
  
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
      // Aplicar o offset para que o mouse fique sempre no mesmo ponto da carta
      // A carta usa translate(-50%, -100%) então o ponto de referência é o centro inferior
      const currentDragOffset = handDragStateRef.current.dragOffset;
      if (currentDragOffset) {
        // O mouse está em (cursorX, cursorY)
        // O offset é a diferença entre o mouse e o centro da carta
        // O centro da carta seria: X = cardCenterX, Y = cardCenterY
        // O centro inferior (ponto de referência) seria: X = cardCenterX, Y = cardCenterY + HAND_CARD_HEIGHT/2
        // Queremos: cursorX = cardCenterX + offsetX, cursorY = cardCenterY + offsetY
        // Então: cardCenterX = cursorX - offsetX, cardCenterY = cursorY - offsetY
        const cardCenterX = cursorX - currentDragOffset.x;
        const cardCenterY = cursorY - currentDragOffset.y;
        // Converter para a posição do centro inferior (ponto de referência da carta)
        const newDragPosition = { x: cardCenterX, y: cardCenterY + HAND_CARD_HEIGHT / 2 };
        setDragPosition(newDragPosition);
        handDragStateRef.current.dragPosition = newDragPosition;
      } else {
        setDragPosition({ x: cursorX, y: cursorY });
        handDragStateRef.current.dragPosition = { x: cursorX, y: cursorY };
      }
      
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
      
      const handArea = getHandArea(playerName);
      if (!handArea) return;
      
      // Usar board atualizado do store para garantir que temos a versão mais recente
      const currentBoard = useGameStore.getState().board;
      const playerHandCards = currentBoard.filter((c) => c.zone === 'hand' && c.ownerId === playerName);
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
        console.log('[Hand] stopDrag: Already executed, ignoring');
        return;
      }
      
      // Usar o cardId capturado no início do useEffect para evitar problemas de closure
      const draggedCardId = currentDraggingCardId;
      
      // Verificar se o cardId ainda corresponde ao activeDragCardIdRef
      // Se não corresponder E o activeDragCardIdRef não for null, significa que um novo drag foi iniciado
      // Se activeDragCardIdRef for null, pode ser que ainda não foi setado ou foi limpo, então continuar
      if (activeDragCardIdRef.current !== null && draggedCardId !== activeDragCardIdRef.current) {
        console.log('[Hand] stopDrag: CardId does not match active drag, canceling:', {
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
      let currentPreviewHandOrder = previewHandOrder;
      
      // Usar a ref que foi setada quando o drag começou (definir antes de usar)
      const startedFromHand = dragStartedFromHandRef.current;
      
      // Se previewHandOrder não foi calculado durante o drag, calcular agora
      // IMPORTANTE: Calcular ANTES de verificar droppedOutsideHand
      if (currentPreviewHandOrder === null && handCardMoved && event && boardRef.current && startedFromHand) {
        console.log('[Hand] stopDrag: Tentando calcular previewHandOrder', {
          currentPreviewHandOrder,
          handCardMoved,
          hasEvent: !!event,
          hasBoardRef: !!boardRef.current,
          startedFromHand,
        });
        const handArea = getHandArea(playerName);
        console.log('[Hand] stopDrag: handArea:', handArea);
        if (handArea) {
          const rect = boardRef.current.getBoundingClientRect();
          // handArea está em coordenadas relativas ao board, usar coordenadas relativas também
          let relativeX = event.clientX - rect.left;
          
          const currentBoard = useGameStore.getState().board;
          const playerHandCards = currentBoard.filter((c) => c.zone === 'hand' && c.ownerId === playerName);
          const allCards = [...playerHandCards].sort((a, b) => {
            const indexA = originalHandOrder?.[a.id] ?? a.handIndex ?? 0;
            const indexB = originalHandOrder?.[b.id] ?? b.handIndex ?? 0;
            return indexA - indexB;
          });
          
          const totalCards = allCards.length;
          const maxScroll = Math.max(0, totalCards - maxRenderCards);
          const currentScrollIndex = Math.min(handScrollIndex, maxScroll);
          const renderStartIndex = currentScrollIndex;
          
          const handAreaLeft = handArea.x;
          const relativeXToHand = relativeX - handAreaLeft;
          const cardStartOffset = 80;
          const adjustedX = relativeXToHand - cardStartOffset;
          
          if (adjustedX >= 0) {
            const visibleCardsCount = Math.min(maxRenderCards, totalCards - renderStartIndex);
            let visualPosition = Math.floor(adjustedX / HAND_CARD_LEFT_SPACING);
            visualPosition = Math.max(0, Math.min(visibleCardsCount - 1, visualPosition));
            
            const newIndex = renderStartIndex + visualPosition;
            currentPreviewHandOrder = Math.max(0, Math.min(totalCards - 1, newIndex));
          } else {
            currentPreviewHandOrder = renderStartIndex;
          }
          
          console.log('[Hand] stopDrag: Calculado previewHandOrder:', {
            relativeX,
            handAreaLeft,
            relativeXToHand,
            adjustedX,
            currentPreviewHandOrder,
          });
        }
      }
      
      console.log('[Hand] stopDrag chamado:', {
        draggedCardId,
        handCardMoved,
        dragStartPosition,
        currentPreviewHandOrder,
        previewHandOrder,
        startedFromHand,
        hasEvent: !!event,
        hasBoardRef: !!boardRef.current,
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
          dragOffset: null,
        };
        return;
      }
      
      // Obter o board atualizado diretamente do store para garantir que temos a versão mais recente
      const currentBoard = useGameStore.getState().board;
      const draggedCard = currentBoard.find((c) => c.id === draggedCardId);
      
      console.log('[Hand] stopDrag: Verificando carta:', {
        draggedCard: draggedCard ? { id: draggedCard.id, name: draggedCard.name, zone: draggedCard.zone, ownerId: draggedCard.ownerId } : null,
        playerName,
        isHand: draggedCard?.zone === 'hand',
        isOwner: draggedCard?.ownerId === playerName,
      });
      
      // Se a carta não existe, não está na hand, ou não é do jogador, limpar estados imediatamente
      if (!draggedCard || draggedCard.zone !== 'hand' || draggedCard.ownerId !== playerName) {
        console.log('[Hand] stopDrag: Card is not valid for hand drag, clearing state');
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
          dragOffset: null,
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
          console.log('[Hand] stopDrag: It was just a click, did not move enough');
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
            dragOffset: null,
          };
          return;
        }
      }
      
      // Se não moveu, não fazer nada (já foi tratado acima)
      if (!handCardMoved) {
        console.log('[Hand] stopDrag: Did not move, canceling');
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
          dragOffset: null,
        };
        return;
      }
      
      let dropPosition: { x: number; y: number } | null = null;
      // startedFromHand já foi declarado acima (linha 395)
      
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
            playerName,
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
        } else if (viewMode === 'individual' && convertMouseToUnifiedCoordinates) {
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
      if (draggedCard.zone === 'hand' && draggedCard.ownerId === playerName) {
        console.log('[Hand] stopDrag: Checking conditions to change zone:', {
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
        // Mas ainda precisamos verificar se soltou fora da hand
        const hadPreviewOrder = currentPreviewHandOrder !== null;
        
        // Verificar se a carta foi solta FORA da área da hand
        // IMPORTANTE: Sempre verificar, mesmo se há preview de reordenação
        // Se soltou fora, mudar de zona. Se não, reordenar.
        let droppedOutsideHand = false;
        
        // Sempre verificar se soltou fora da hand, independente de ter preview
        if (startedFromHand && handCardMoved && event && dropCursorX !== null && dropCursorY !== null && boardRef.current) {
          const handArea = getHandArea(playerName);
          if (handArea) {
            // Converter dropCursorX/Y para coordenadas relativas ao board (mesmo sistema que handArea)
            const rect = boardRef.current.getBoundingClientRect();
            let relativeX = event.clientX - rect.left;
            let relativeY = event.clientY - rect.top;
            
            // handArea está em coordenadas relativas ao board, usar coordenadas relativas também
            // Verificar se a posição onde soltou está FORA da área da hand
            // Adicionar uma pequena margem para facilitar a detecção
            const margin = 20;
            const isInsideHand = 
              relativeX >= (handArea.x - margin) && 
              relativeX <= (handArea.x + handArea.width + margin) &&
              relativeY >= (handArea.y - margin) && 
              relativeY <= (handArea.y + handArea.height + margin);
            
            droppedOutsideHand = !isInsideHand;
            
            console.log('[Hand] stopDrag: Verificando se soltou fora da hand:', {
              dropCursorX,
              dropCursorY,
              relativeX,
              relativeY,
              handArea: { x: handArea.x, y: handArea.y, width: handArea.width, height: handArea.height },
              isInsideHand,
              droppedOutsideHand,
              margin,
              hadPreviewOrder,
            });
          } else {
            // Se não conseguiu calcular a área da hand, assumir que está dentro
            droppedOutsideHand = false;
            console.log('[Hand] stopDrag: Could not calculate handArea, assuming inside hand');
          }
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
              playerName,
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
          } else if (viewMode === 'individual' && convertMouseToUnifiedCoordinates) {
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
            // dropPosition está baseado em dropCursorX/Y que já foi convertido para espaço base
            // se estiver em modo separated, ou está em coordenadas relativas se não
              // Usar baseX/baseY que já foram calculados acima e estão no espaço base
              finalPosition = {
                x: Math.max(0, Math.min(BASE_BOARD_WIDTH - CARD_WIDTH, baseX - CARD_WIDTH / 2)),
                y: Math.max(0, Math.min(BASE_BOARD_HEIGHT - CARD_HEIGHT, baseY - CARD_HEIGHT / 2)),
              };
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
              dragOffset: null,
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
        // IMPORTANTE: Usar currentPreviewHandOrder que pode ter sido calculado acima
        const originalIndex = originalHandOrder?.[draggedCardId] ?? 
          (() => {
            const currentBoard = useGameStore.getState().board;
            const playerHandCards = currentBoard.filter((c) => c.zone === 'hand' && c.ownerId === playerName);
            const allCards = [...playerHandCards].sort((a, b) => {
              const indexA = originalHandOrder?.[a.id] ?? a.handIndex ?? 0;
              const indexB = originalHandOrder?.[b.id] ?? b.handIndex ?? 0;
              return indexA - indexB;
            });
            return allCards.findIndex((c) => c.id === draggedCardId);
          })();
        
        // Se ainda não calculou o previewHandOrder e está dentro da hand, calcular baseado na posição final
        if (currentPreviewHandOrder === null && !droppedOutsideHand && event && boardRef.current && startedFromHand) {
          const handArea = getHandArea(playerName);
          if (handArea && dropCursorX !== null) {
            // handArea está em coordenadas relativas ao board, dropCursorX pode estar no espaço base
            // Converter dropCursorX para coordenadas relativas se necessário
            const rect = boardRef.current.getBoundingClientRect();
            let cursorXRelative = dropCursorX;
            
            // Se dropCursorX está no espaço base (modo separated), converter para relativo
            if (viewMode === 'separated') {
              // dropCursorX já está no espaço base, mas handArea.x está em coordenadas relativas
              // Precisamos converter handArea.x para o espaço base ou dropCursorX para relativo
              // Vamos usar coordenadas relativas para ambos
              const relativeX = event.clientX - rect.left;
              cursorXRelative = relativeX;
            }
            
            const handAreaLeft = handArea.x;
            const relativeXToHand = cursorXRelative - handAreaLeft;
            const cardStartOffset = 80;
            const adjustedX = relativeXToHand - cardStartOffset;
            
            const currentBoard = useGameStore.getState().board;
            const playerHandCards = currentBoard.filter((c) => c.zone === 'hand' && c.ownerId === playerName);
            const allCards = [...playerHandCards].sort((a, b) => {
              const indexA = originalHandOrder?.[a.id] ?? a.handIndex ?? 0;
              const indexB = originalHandOrder?.[b.id] ?? b.handIndex ?? 0;
              return indexA - indexB;
            });
            
            const totalCards = allCards.length;
            const maxScroll = Math.max(0, totalCards - maxRenderCards);
            const currentScrollIndex = Math.min(handScrollIndex, maxScroll);
            const renderStartIndex = currentScrollIndex;
            
            if (adjustedX >= 0) {
              const visibleCardsCount = Math.min(maxRenderCards, totalCards - renderStartIndex);
              let visualPosition = Math.floor(adjustedX / HAND_CARD_LEFT_SPACING);
              visualPosition = Math.max(0, Math.min(visibleCardsCount - 1, visualPosition));
              
              const newIndex = renderStartIndex + visualPosition;
              currentPreviewHandOrder = Math.max(0, Math.min(totalCards - 1, newIndex));
            } else {
              currentPreviewHandOrder = renderStartIndex;
            }
            
            console.log('[Hand] stopDrag: Calculado previewHandOrder (fallback):', {
              dropCursorX,
              handAreaLeft,
              relativeXToHand,
              adjustedX,
              currentPreviewHandOrder,
            });
          }
        }
        
        const hadReordering = currentPreviewHandOrder !== null;
        const actuallyReordered = hadReordering && originalIndex !== undefined && originalIndex >= 0 && originalIndex !== currentPreviewHandOrder;
        
        console.log('[Hand] stopDrag: Checking reordering:', {
          currentPreviewHandOrder,
          originalIndex,
          hadReordering,
          actuallyReordered,
          droppedOutsideHand,
        });
        
        // Log evento de drag end ANTES de reordenar, se realmente moveu
        // IMPORTANTE: Sempre logar quando houver movimento, independente de reordenação
        // Isso garante que o DRAG_END apareça mesmo quando não há reordenação
        if (handCardMoved) {
          addEventLog('DRAG_END', `Finalizando drag da hand: ${draggedCard.name}`, draggedCard.id, draggedCard.name, {
            zone: draggedCard.zone,
            handCardMoved,
            previewHandOrder: currentPreviewHandOrder,
            originalIndex,
            droppedOutsideHand,
            actuallyReordered,
          });
        }
        
        // Reordenar cartas na hand se soltou DENTRO da área da hand
        // Só reordenar se realmente moveu E o índice mudou E NÃO soltou fora da hand
        // IMPORTANTE: Só executar uma vez por drag
        if (actuallyReordered && !droppedOutsideHand && currentPreviewHandOrder !== null) {
          // Recalcular a posição final baseada na posição onde a carta foi soltada
          let finalNewIndex = currentPreviewHandOrder;
          
          if (event && boardRef.current && dropCursorX !== null && dropCursorY !== null) {
            const handArea = getHandArea(playerName);
            if (handArea) {
              const currentBoard = useGameStore.getState().board;
              const playerHandCards = currentBoard.filter((c) => c.zone === 'hand' && c.ownerId === playerName);
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
            dragOffset: null,
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
        dragOffset: null,
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
    playerName,
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
      const sortedCards = playerHandCards;
      if (sortedCards.length === 0 && Object.keys(originalHandOrder ?? {}).length === 0) {
        return;
      }
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
  }, [playerHandCards, draggingHandCard, originalHandOrder]);

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
  }, [playerHandCards, handScrollIndex, isSliding]);

  if (!boardRef.current) return null;

  return (
    <>
      {players.length > 0 && players.map((player) => {
        const handArea = getHandArea(player.name);
        if (!handArea) return null;
        const isCurrentPlayer = player.name === playerName;
        const isSimulated = player.id.startsWith('simulated-');
        const canInteract = isCurrentPlayer || isSimulated;
        const shouldRender = viewMode === 'separated' ? true : canInteract;
        const isReadOnlyHand = viewMode === 'separated' && !isCurrentPlayer;
        const playerHandCardsForRender = handCardsByOwner.get(player.name) ?? [];
        
        if (!shouldRender) return null;
        
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
              overflow: 'visible',
            }}
          >
            <div className="hand-cards">
              {(() => {
                let sortedHandCards = [...playerHandCardsForRender];
                
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
                
                // Aplicar limite de cartas a mostrar se maxCardsToShow > 0
                const cardsToShow = maxCardsToShow > 0 
                  ? sortedHandCards.slice(0, maxCardsToShow)
                  : sortedHandCards;
                
                const totalCards = cardsToShow.length;
                const maxScroll = Math.max(0, totalCards - maxRenderCards);
                const currentScrollIndex = Math.min(handScrollIndex, maxScroll);
                const renderStartIndex = currentScrollIndex;
                
                const visibleCards = cardsToShow.slice(
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
                      const HOVER_SPACE_PX = 40;
                      
                      if (hoveredHandCard && !draggingHandCard && spaceIndex !== null) {
                        if (visibleIndex === spaceIndex && isHovered) {
                          // Removido verticalOffset para não subir a carta
                          verticalOffset = 0;
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
                            opacity: isDragging ? 0 : 1, // Ocultar a carta na lista quando está sendo arrastada
                            pointerEvents: isDragging ? 'none' : 'auto', // Desabilitar interação quando arrastando
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
                            if (isReadOnlyHand) {
                              event.preventDefault();
                              event.stopPropagation();
                              return;
                            }
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
                            
                            if (card.zone === 'hand' && card.ownerId === playerName) {
                              prepareHandDrag(card, event);
                            } else {
                              startDrag(card, event);
                            }
                          }}
                          onClick={(event) => {
                            if (isReadOnlyHand) {
                              event.preventDefault();
                              event.stopPropagation();
                              return;
                            }
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
                          onContextMenu={(event) => {
                            if (isReadOnlyHand) {
                              event.preventDefault();
                              event.stopPropagation();
                              return;
                            }
                            handleCardContextMenu(card, event);
                          }}
                        >
                          <CardToken
                            card={card}
                            onPointerDown={() => {}}
                            onClick={() => {}}
                            onContextMenu={() => {}}
                            ownerName={ownerName(card)}
                            width={HAND_CARD_WIDTH}
                            height={HAND_CARD_HEIGHT}
                            showBack={isReadOnlyHand}
                          />
                          {/* Botão de flip embaixo da carta (apenas se tiver backImageUrl) */}
                          {card.backImageUrl && !isReadOnlyHand && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                useGameStore.getState().flipCard(card.id);
                              }}
                              style={{
                                position: 'absolute',
                                bottom: '-20px',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                width: '36px',
                                height: '28px',
                                padding: '4px 6px',
                                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                                border: '1px solid rgba(148, 163, 184, 0.3)',
                                borderRadius: '4px',
                                color: '#f8fafc',
                                cursor: 'pointer',
                                fontSize: '16px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 2,
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.3)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(15, 23, 42, 0.9)';
                              }}
                              title="Transform"
                            >
                              🔄
                            </button>
                          )}
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
              
              // Aplicar limite de cartas a mostrar se maxCardsToShow > 0
              const cardsToShow = maxCardsToShow > 0 
                ? sortedHandCards.slice(0, maxCardsToShow)
                : sortedHandCards;
              
              const totalCards = cardsToShow.length;
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
                        left: '-40px',
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
                      aria-label="Previous cards"
                    >
                      ←
                    </button>
                  )}
                  
                  <div
                    style={{
                      position: 'absolute',
                      right: '-40px',
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
                      aria-label="Next cards"
                      >
                        →
                      </button>
                    )}
                  </div>
                  
                  {/* Botão Buscar na Mão */}
                  {isCurrentPlayer && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowHandSearch(true);
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      style={{
                        position: 'absolute',
                        top: '10px',
                        right: '-70px',
                        padding: '4px 8px',
                        backgroundColor: '#6366f1',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '10px',
                        fontWeight: '500',
                        zIndex: 1000,
                        pointerEvents: 'auto',
                      }}
                      title="Search hand card and move to a zone"
                    >
                      🔍 Search
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        );
      })}
      
      {/* Busca de cartas na mão */}
      {changeCardZone && getCemeteryPosition && getLibraryPosition && (
        <HandSearch
          handCards={handCards}
          playerName={playerName}
          isOpen={showHandSearch}
          onClose={() => setShowHandSearch(false)}
          onMoveCard={(cardId, zone, libraryPlace) => {
            const card = board.find((c) => c.id === cardId);
            if (!card || !changeCardZone) return;
            
            let position: Point = { x: 0, y: 0 };
            
            if (zone === 'battlefield' && boardRef.current) {
              const rect = boardRef.current.getBoundingClientRect();
              position = {
                x: rect.width / 2 - 150 / 2,
                y: rect.height / 2 - 210 / 2,
              };
            } else if (zone === 'cemetery' && getCemeteryPosition) {
              const cemeteryPos = getCemeteryPosition(playerName);
              if (cemeteryPos) {
                position = cemeteryPos;
              }
            } else if (zone === 'library' && getLibraryPosition) {
              const libraryPos = getLibraryPosition(playerName);
              if (libraryPos) {
                position = libraryPos;
              }
            } else if (zone === 'exile' && getCemeteryPosition) {
              // Usar getCemeteryPosition temporariamente, depois adicionar getExilePosition
              const exilePos = getCemeteryPosition(playerName);
              if (exilePos) {
                position = exilePos;
              }
            }
            
            changeCardZone(cardId, zone, position, libraryPlace);
          }}
          ownerName={ownerName}
          reorderHandCard={reorderHandCard}
        />
      )}
      
      {/* Carta arrastada seguindo o cursor */}
      {draggingHandCard && dragPosition && boardRef.current && (() => {
        // Usar board atualizado do store para garantir que temos a versão mais recente
        const currentBoard = useGameStore.getState().board;
        const draggedCard = currentBoard.find((c) => c.id === draggingHandCard);
        if (!draggedCard) return null;
        const boardRect = boardRef.current.getBoundingClientRect();
        const draggedXPercent = (dragPosition.x / boardRect.width) * 100;
        // Manter a carta na mesma altura Y da mão durante o drag para evitar "pulo"
        const handArea = getHandArea(playerName);
        const handYPercent = handArea ? ((handArea.y + handArea.height) / boardRect.height) * 100 : 85;
        // Usar a posição Y do cursor, mas limitar para não sair muito da área da mão
        const draggedYPercent = Math.min(handYPercent, (dragPosition.y / boardRect.height) * 100);
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
