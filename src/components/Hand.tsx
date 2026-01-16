import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { CardOnBoard } from '../store/useGameStore';
import CardToken from './CardToken';

type Point = { x: number; y: number };

const HAND_CARD_WIDTH = 120;
const HAND_CARD_HEIGHT = 168;
const CARD_WIDTH = 150;
const CARD_HEIGHT = 210;
const HAND_CARD_SPACING = 80; // Espaçamento entre cartas da mão (menor para ficar mais natural)
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
  changeCardZone: (cardId: string, zone: 'battlefield' | 'library' | 'hand', position: Point) => void;
  reorderHandCard: (cardId: string, newIndex: number) => void;
  dragStartedFromHandRef: React.MutableRefObject<boolean>;
  handCardPlacedRef: React.MutableRefObject<boolean>;
  setDragStartedFromHand: (value: boolean) => void;
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
  reorderHandCard,
  dragStartedFromHandRef,
  handCardPlacedRef,
  setDragStartedFromHand,
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

  const handCards = board.filter((c) => c.zone === 'hand');

  const getHandArea = (ownerId: string) => {
    if (!boardRef.current || players.length === 0) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const playerIndex = players.findIndex((p) => p.id === ownerId);
    if (playerIndex === -1) return null;

    // Calcular área baseada no número real de cartas
    const playerHandCards = board.filter((c) => c.zone === 'hand' && c.ownerId === ownerId);
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
  };

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
    setDraggingHandCard(card.id);
    setHoveredHandCard(null);
    setDragPosition({ x: startX, y: startY });
    setDragStartPosition({ x: startX, y: startY });
    setPreviewHandOrder(null);
    setPendingHandDrag(null);
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
        const card = board.find((c) => c.id === pendingHandDrag.cardId);
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
    if (!draggingHandCard || !boardRef.current) return;
    
    const handleMove = (event: PointerEvent) => {
      const now = Date.now();
      if (now - dragUpdateRef.current < THROTTLE_MS) return;
      dragUpdateRef.current = now;
      
      const rect = boardRef.current!.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      
      if (!handCardMoved && dragStartPosition) {
        const deltaX = Math.abs(cursorX - dragStartPosition.x);
        const deltaY = Math.abs(cursorY - dragStartPosition.y);
        if (deltaX > 5 || deltaY > 5) {
          setHandCardMoved(true);
        }
      }
      
      if (!handCardMoved) {
        return;
      }
      
      setDragPosition({ x: cursorX, y: cursorY });
      
      const handArea = getHandArea(playerId);
      if (!handArea) return;
      
      const playerHandCards = board.filter((c) => c.zone === 'hand' && c.ownerId === playerId);
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
      const handAreaLeft = handArea.x;
      const relativeX = cursorX - handAreaLeft;
      const visibleCardsCount = Math.min(maxRenderCards, totalCards - renderStartIndex);
      let visualPosition = Math.floor(relativeX / HAND_CARD_LEFT_SPACING);
      visualPosition = Math.max(0, Math.min(visibleCardsCount - 1, visualPosition));
      
      const newIndex = renderStartIndex + visualPosition;
      const clampedNewIndex = Math.max(0, Math.min(totalCards - 1, newIndex));
      
      const originalIndex = originalHandOrder?.[draggingHandCard] ?? 
        allCards.findIndex((c) => c.id === draggingHandCard);
      
      if (originalIndex >= 0 && clampedNewIndex !== originalIndex) {
        setPreviewHandOrder(clampedNewIndex);
      } else if (clampedNewIndex === originalIndex) {
        setPreviewHandOrder(originalIndex);
      }
    };
    
    const stopDrag = (event?: PointerEvent) => {
      const draggedCardId = draggingHandCard;
      
      if (!draggedCardId) {
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
        return;
      }
      
      const card = board.find((c) => c.id === draggedCardId);
      
      if (!card || card.zone !== 'hand' || card.ownerId !== playerId) {
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
        return;
      }
      
      if (handCardPlacedRef.current) {
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
        return;
      }
      
      if (!handCardMoved && event && dragStartPosition && boardRef.current) {
        const rect = boardRef.current.getBoundingClientRect();
        const cursorX = event.clientX - rect.left;
        const cursorY = event.clientY - rect.top;
        const deltaX = Math.abs(cursorX - dragStartPosition.x);
        const deltaY = Math.abs(cursorY - dragStartPosition.y);
        
        if (deltaX <= 5 && deltaY <= 5) {
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
          return;
        }
      }
      
      let isAboveHandArea = false;
      let dropPosition: { x: number; y: number } | null = null;
      
      if (event && boardRef.current) {
        const rect = boardRef.current.getBoundingClientRect();
        const cursorX = event.clientX - rect.left;
        const cursorY = event.clientY - rect.top;
        
        const handArea = getHandArea(playerId);
        if (handArea) {
          isAboveHandArea = cursorY < handArea.y;
          if (isAboveHandArea) {
            dropPosition = {
              x: cursorX - CARD_WIDTH / 2,
              y: cursorY - CARD_HEIGHT / 2,
            };
          }
        }
      }
      
      // Se arrastou da hand e soltou acima da área da hand, mover para o battlefield
      if (dragStartedFromHandRef.current && handCardMoved && isAboveHandArea && !handCardPlacedRef.current) {
        const currentCard = board.find((c) => c.id === draggedCardId);
        if (currentCard && currentCard.zone === 'hand' && currentCard.ownerId === playerId) {
          handCardPlacedRef.current = true;
          
          const playerArea = getPlayerArea(playerId);
          if (playerArea) {
            const position = dropPosition || {
              x: playerArea.x + playerArea.width / 2 - CARD_WIDTH / 2,
              y: playerArea.y + playerArea.height / 2 - CARD_HEIGHT / 2,
            };
            
            if (boardRef.current) {
              const rect = boardRef.current.getBoundingClientRect();
              position.x = Math.max(0, Math.min(rect.width - CARD_WIDTH, position.x));
              position.y = Math.max(0, Math.min(rect.height - CARD_HEIGHT, position.y));
            }
            
            // Trocar a zona da carta de hand para battlefield
            changeCardZone(currentCard.id, 'battlefield', position);
            setDragStartedFromHand(false);
            dragStartedFromHandRef.current = false;
            handCardPlacedRef.current = true;
          }
        } else {
          handCardPlacedRef.current = false;
        }
      } else if (previewHandOrder !== null) {
        const originalIndex = originalHandOrder?.[draggedCardId];
        if (originalIndex !== undefined && originalIndex !== previewHandOrder) {
          reorderHandCard(draggedCardId, previewHandOrder);
        }
      }
      
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
    };
    
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', (e) => stopDrag(e));
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', (e) => stopDrag(e));
    };
  }, [draggingHandCard, previewHandOrder, originalHandOrder, board, playerId, reorderHandCard, hoveredHandCard, handScrollIndex, handCardMoved, dragPosition, dragStartPosition, changeCardZone, getPlayerArea, getHandArea]);

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
                            if (handCardMoved || draggingHandCard === card.id) {
                              event.preventDefault();
                              event.stopPropagation();
                              return;
                            }
                            handleCardClick(card, event);
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
                        left: '0',
                        top: '50%',
                        transform: 'translate(-100%, -50%)',
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
                      right: '0',
                      top: '50%',
                      transform: 'translate(100%, -50%)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0px',
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
        const draggedCard = board.find((c) => c.id === draggingHandCard);
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

