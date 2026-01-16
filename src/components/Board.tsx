import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { CardOnBoard } from '../store/useGameStore';
import CardToken from './CardToken';
import Hand from './Hand';

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
  const [showHand, setShowHand] = useState(true);
  const [handButtonEnabled, setHandButtonEnabled] = useState(false);
  
  // Refs para compartilhar com Hand component
  const dragStartedFromHandRef = useRef<boolean>(false);
  const handCardPlacedRef = useRef<boolean>(false);
  
  const battlefieldCards = board.filter((c) => c.zone === 'battlefield');
  const libraryCards = board.filter((c) => c.zone === 'library');
  

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

      // Se a carta mudou de zone durante o drag, cancelar imediatamente
      if (card.zone !== 'battlefield') {
        dragStateRef.current = null;
        setIsDragging(false);
        console.log('[Board] handleMove: Carta mudou de zona, cancelando drag');
        return;
      }

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

      // Se moveu e soltou na área da hand, mudar zona
      if (dragState.hasMoved && showHand && boardRef.current) {
        const currentBoard = useGameStore.getState().board;
        const card = currentBoard.find((c) => c.id === dragState.cardId);
        
        if (card && card.zone === 'battlefield' && card.ownerId === playerId) {
          const rect = boardRef.current.getBoundingClientRect();
          const cursorX = event.clientX - rect.left;
          const cursorY = event.clientY - rect.top;
          
          const handArea = getHandArea(playerId);
          if (handArea) {
            const isInHandArea = 
              cursorX >= handArea.x && 
              cursorX <= handArea.x + handArea.width &&
              cursorY >= handArea.y && 
              cursorY <= handArea.y + handArea.height;
            
            if (isInHandArea) {
              console.log('[Board] handleUp: Movendo carta para hand:', {
                cardId: card.id,
                cardName: card.name,
              });
              changeCardZone(card.id, 'hand', { x: 0, y: 0 });
              
              // Limpar estados de drag imediatamente
              dragStateRef.current = null;
              setIsDragging(false);
              
              // Bloquear cliques por um tempo após mudança de zona
              if (clickBlockTimeoutRef.current) {
                clearTimeout(clickBlockTimeoutRef.current.timeoutId);
              }
              const timeoutId = window.setTimeout(() => {
                console.log('[Board] clickBlockTimeout expirado após mudança de zona');
                clickBlockTimeoutRef.current = null;
              }, CLICK_BLOCK_DELAY);
              clickBlockTimeoutRef.current = { cardId: card.id, timeoutId };
              
              console.log('[Board] handleUp: Carta movida para hand, bloqueando cliques por', CLICK_BLOCK_DELAY, 'ms');
              
              // Resetar todos os estados de drag após um pequeno delay para garantir que a mudança de zona foi processada
              requestAnimationFrame(() => {
                console.log('[Board] handleUp: Chamando resetAllDragStates após mudança de zona');
                resetAllDragStates();
              });
              
              return;
            }
          }
        }
      }

      // Limpar estado de drag
      const hadMoved = dragState.hasMoved;
      const cardId = dragState.cardId;
      
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

    // Cancelar qualquer drag anterior
    dragStateRef.current = null;
    setIsDragging(false);
    if (clickBlockTimeoutRef.current) {
      clearTimeout(clickBlockTimeoutRef.current.timeoutId);
      clickBlockTimeoutRef.current = null;
    }

    const rect = boardRef.current.getBoundingClientRect();
    // Calcular offset: posição do cursor dentro da carta (relativo ao board)
    const cardX = card.position.x;
    const cardY = card.position.y;
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const offsetX = cursorX - cardX;
    const offsetY = cursorY - cardY;

    // Iniciar novo drag - apenas uma carta pode ser arrastada por vez
    dragStateRef.current = {
      cardId: card.id,
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
      drawFromLibrary();
    }
  };

  const handleCardClick = (card: CardOnBoard, event: React.MouseEvent) => {
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
        changeCardZone(card.id, 'battlefield', position);
      }
      return;
    }

    console.log('[Board] Nenhuma ação tomada para o clique');
  };

  const handleCardContextMenu = (card: CardOnBoard, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
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
    
    // Só pode remover suas próprias cartas
    if (card.ownerId === playerId) {
      console.log('[Board] handleCardContextMenu: Removendo carta:', {
        cardId: card.id,
        cardName: card.name,
        zone: card.zone,
      });
      removeCard(card.id);
    } else {
      console.log('[Board] handleCardContextMenu: Não é dono da carta, não removendo');
    }
  };

  const startLibraryDrag = (targetPlayerId: string, event: ReactPointerEvent) => {
    if (targetPlayerId !== playerId) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    if (!boardRef.current) return;

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

    const stopDrag = () => {
      if (!libraryMoved) {
        handleLibraryClick(draggingLibrary.playerId);
      }
      setDraggingLibrary(null);
      setTimeout(() => setLibraryMoved(false), 100);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopDrag);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopDrag);
    };
  }, [draggingLibrary, moveLibrary, playerId, libraryMoved]);

  return (
    <div className="board-container">
      <div className="board-toolbar">
        <div className="board-status">{instruction}</div>
        <button
          onClick={() => {
            setShowHand(!showHand);
            setHandButtonEnabled(true);
          }}
          disabled={!handButtonEnabled && !showHand}
          style={{
            marginLeft: 'auto',
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
          const libraryPos = getLibraryPosition(player.id);
          const playerLibraryCards = libraryCards.filter((c) => c.ownerId === player.id);
          const sortedLibraryCards = [...playerLibraryCards].sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));
          
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
              
              {libraryPos && sortedLibraryCards.length > 0 && (
                <div
                  className={`library-stack ${isCurrentPlayer ? 'draggable' : ''}`}
                  style={{
                    left: `${libraryPos.x}px`,
                    top: `${libraryPos.y}px`,
                    cursor: isCurrentPlayer ? (draggingLibrary?.playerId === player.id ? 'grabbing' : 'grab') : 'pointer',
                  }}
                  onPointerDown={(e) => {
                    if (isCurrentPlayer) {
                      startLibraryDrag(player.id, e);
                    }
                  }}
                >
                  {sortedLibraryCards.slice(0, 5).map((card, index) => (
                    <div
                      key={card.id}
                      style={{
                        position: 'absolute',
                        left: `${index * 3}px`,
                        top: `${index * 3}px`,
                        pointerEvents: 'none',
                      }}
                    >
                      <CardToken
                        card={card}
                        onPointerDown={() => {}}
                        onDoubleClick={() => {}}
                        ownerName={ownerName(card)}
                        width={LIBRARY_CARD_WIDTH}
                        height={LIBRARY_CARD_HEIGHT}
                        showBack={true}
                      />
                    </div>
                  ))}
                  <div className="library-count">{sortedLibraryCards.length}</div>
                </div>
              )}
            </div>
          );
        })}
        
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
                onPointerDown={(event) => startDrag(card, event)}
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
          />
        )}
      </div>
    </div>
  );
};

export default Board;
