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
const HAND_CARD_WIDTH = 120;
const HAND_CARD_HEIGHT = 168;

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
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const [libraryPositions, setLibraryPositions] = useState<Record<string, Point>>({});
  const [draggingLibrary, setDraggingLibrary] = useState<{ playerId: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const [libraryMoved, setLibraryMoved] = useState(false);
  const [cardMoved, setCardMoved] = useState(false);
  const [dragStartedFromHand, setDragStartedFromHand] = useState<boolean>(false); // Rastrear se drag começou da hand
  const [showHand, setShowHand] = useState(true); // Controlar visibilidade da hand (visível por padrão)
  const [handButtonEnabled, setHandButtonEnabled] = useState(false); // Botão desabilitado por padrão
  
  // Refs para throttling de atualizações durante drag
  const dragUpdateRef = useRef<number>(0);
  const libraryDragUpdateRef = useRef<number>(0);
  const handCardPlacedRef = useRef<boolean>(false); // Prevenir múltiplas colocações
  const dragStartedFromHandRef = useRef<boolean>(false); // Ref para compartilhar com Hand
  const cardMovedTimeoutRef = useRef<number | null>(null); // Ref para armazenar o timeout do cardMoved
  const THROTTLE_MS = 8; // ~120fps para melhor responsividade durante drag
  
  const battlefieldCards = board.filter((c) => c.zone === 'battlefield');
  const libraryCards = board.filter((c) => c.zone === 'library');

  const getPlayerArea = (ownerId: string) => {
    if (!boardRef.current || players.length === 0) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const playerIndex = players.findIndex((p) => p.id === ownerId);
    if (playerIndex === -1) return null;

    // Área do battlefield ocupa 100% da tela
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

    // Calcular área da hand similar ao Hand component
    const HAND_CARD_WIDTH = 120;
    const HAND_CARD_HEIGHT = 168;
    const HAND_CARD_LEFT_SPACING = 120;
    const maxRenderCards = 9;
    
    const playerHandCards = board.filter((c) => c.zone === 'hand' && c.ownerId === ownerId);
    const totalCards = playerHandCards.length;
    
    if (totalCards === 0) {
      const handHeight = HAND_CARD_HEIGHT + 20;
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
    const baseHandHeight = HAND_CARD_HEIGHT + curveHeight + HOVER_LIFT_PX + 10;
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
    
    // Buscar apenas as top 5 cartas do library (maiores stackIndex)
    const playerLibraryCards = libraryCards
      .filter((c) => c.ownerId === ownerId)
      .sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0))
      .slice(0, 5);
    
    // Buscar a carta do topo (primeira das top 5) para obter a posição do stack
    const topCard = playerLibraryCards[0];
    if (topCard && topCard.position.x !== 0 && topCard.position.y !== 0) {
      // Se a carta do topo tem posição definida, usar ela (já está em coordenadas absolutas do board)
      return {
        x: topCard.position.x,
        y: topCard.position.y,
      };
    }
    
    // Se já tem posição salva localmente (durante drag), usar ela
    if (libraryPositions[ownerId]) {
      return {
        x: area.x + libraryPositions[ownerId].x,
        y: area.y + libraryPositions[ownerId].y,
      };
    }
    
    // Posição padrão: centro da área do player
    return {
      x: area.x + (area.width / 2) - (LIBRARY_CARD_WIDTH / 2),
      y: area.y + (area.height / 2) - (LIBRARY_CARD_HEIGHT / 2),
    };
  };



  useEffect(() => {
    if (!dragging) {
      // Garantir que cardMoved está limpo quando não há drag ativo
      // Isso previne que cliques sejam interpretados como movimentos após mudança de zone
      if (cardMoved) {
        setCardMoved(false);
      }
      return;
    }
    
    const handleMove = (event: PointerEvent) => {
      if (!boardRef.current || !dragging) return;
      
      // Verificar se a carta ainda existe e tem o ID correto
      // Usar o board atual do store diretamente para evitar problemas com dependências
      const currentBoard = useGameStore.getState().board;
      const card = currentBoard.find((c) => c.id === dragging.id);
      if (!card) {
        // Se a carta não existe mais, limpar o estado de drag
        setDragging(null);
        setCardMoved(false);
        return;
      }
      
      // IMPORTANTE: Se a carta mudou de zone durante o drag (não está mais no battlefield),
      // limpar o estado de drag imediatamente para evitar que cartas fiquem "conectadas"
      // Cartas da mão têm seu próprio sistema de drag (draggingHandCard) - apenas se hand estiver visível
      if (card.zone !== 'battlefield') {
        setDragging(null);
        setCardMoved(false);
        return;
      }
      
      // Verificar se moveu mais de 5px para distinguir clique de arrasto
      const deltaX = Math.abs(event.clientX - dragging.startX);
      const deltaY = Math.abs(event.clientY - dragging.startY);
      if (deltaX > 5 || deltaY > 5) {
        setCardMoved(true);
      }
      
      const rect = boardRef.current.getBoundingClientRect();
      // Calcular nova posição: posição do cursor relativa ao board menos o offset
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const x = cursorX - dragging.offsetX;
      const y = cursorY - dragging.offsetY;
      
      let clampedX = x;
      let clampedY = y;
      
      if (card.zone === 'battlefield') {
        const playerArea = getPlayerArea(card.ownerId);
        if (!playerArea) {
          clampedX = Math.max(0, Math.min(rect.width - CARD_WIDTH, x));
          clampedY = Math.max(0, Math.min(rect.height - CARD_HEIGHT, y));
        } else {
          clampedX = Math.max(
            playerArea.x,
            Math.min(playerArea.x + playerArea.width - CARD_WIDTH, x)
          );
          clampedY = Math.max(
            playerArea.y,
            Math.min(playerArea.y + playerArea.height - CARD_HEIGHT, y)
          );
        }
      } else if (card.zone === 'hand' && showHand) {
        // Permitir movimento livre em toda a área do board para cartas da mão (apenas se hand estiver visível)
        clampedX = Math.max(0, Math.min(rect.width - HAND_CARD_WIDTH, x));
        clampedY = Math.max(0, Math.min(rect.height - HAND_CARD_HEIGHT, y));
      }
      
      // Só mover se a carta ainda estiver na mesma zone que quando o drag começou
      // Isso previne que cartas fiquem "conectadas" quando mudam de zone
      moveCard(dragging.id, { x: clampedX, y: clampedY });
    };

    const stopDrag = (event?: PointerEvent) => {
      if (!dragging) {
        setDragging(null);
        setCardMoved(false);
        return;
      }
      
      // Verificar se a carta foi soltada na área da hand
      if (event && showHand && cardMoved && boardRef.current) {
        const currentBoard = useGameStore.getState().board;
        const draggedCard = currentBoard.find((c) => c.id === dragging.id);
        
        // Se a carta está no battlefield e pertence ao jogador atual
        if (draggedCard && draggedCard.zone === 'battlefield' && draggedCard.ownerId === playerId) {
          const rect = boardRef.current.getBoundingClientRect();
          const cursorX = event.clientX - rect.left;
          const cursorY = event.clientY - rect.top;
          
          const handArea = getHandArea(playerId);
          if (handArea) {
            // Verificar se o cursor está dentro da área da hand
            const isInHandArea = 
              cursorX >= handArea.x && 
              cursorX <= handArea.x + handArea.width &&
              cursorY >= handArea.y && 
              cursorY <= handArea.y + handArea.height;
            
            if (isInHandArea) {
              // Mudar a zona da carta de battlefield para hand
              // A posição será { x: 0, y: 0 } pois a hand gerencia as posições
              changeCardZone(draggedCard.id, 'hand', { x: 0, y: 0 });
              
              // Limpar o estado de drag imediatamente
              setDragging(null);
              setCardMoved(false);
              
              // Aguardar um frame para garantir que o estado foi atualizado antes de processar qualquer outro evento
              requestAnimationFrame(() => {
                // Forçar limpeza adicional após mudança de zona
                setDragging(null);
                setCardMoved(false);
              });
              
              return;
            }
          }
        }
      }
      
      // Salvar se houve movimento antes de limpar o estado
      const wasMoved = cardMoved;
      
      // Limpar qualquer timeout anterior
      if (cardMovedTimeoutRef.current !== null) {
        clearTimeout(cardMovedTimeoutRef.current);
        cardMovedTimeoutRef.current = null;
      }
      
      // Limpar o estado de drag imediatamente
      setDragging(null);
      // Manter cardMoved por um tempo maior para prevenir que o click execute após o drag
      if (wasMoved) {
        // Garantir que cardMoved está true antes de criar o timeout
        setCardMoved(true);
        // Usar setTimeout para limpar após um delay maior, garantindo que o click seja bloqueado
        cardMovedTimeoutRef.current = window.setTimeout(() => {
          setCardMoved(false);
          cardMovedTimeoutRef.current = null;
        }, 300);
      } else {
        setCardMoved(false);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', (e) => stopDrag(e));
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', (e) => stopDrag(e));
      // NÃO limpar o estado aqui - isso causa problemas quando o useEffect é recriado
      // O estado será limpo naturalmente quando o drag terminar
    };
  }, [dragging, moveCard, players, playerId, changeCardZone, cardMoved, showHand, board, getHandArea]);

  const startDrag = (card: CardOnBoard, event: ReactPointerEvent) => {
    // Só pode mover suas próprias cartas
    if (card.ownerId !== playerId) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    if (!boardRef.current) return;
    
    // Se a carta está na hand, não iniciar drag aqui (deixar o Hand component gerenciar)
    if (card.zone === 'hand' && showHand) {
      return;
    }
    
    // Limpar qualquer estado de drag anterior antes de iniciar um novo
    // Isso previne que cartas fiquem "conectadas"
    if (dragging) {
      setDragging(null);
      setCardMoved(false);
    }
    
    // Garantir que a flag de drag da hand está desativada para cartas do battlefield (apenas se hand estiver visível)
    if (card.zone === 'battlefield' && showHand) {
      setDragStartedFromHand(false);
      dragStartedFromHandRef.current = false;
      handCardPlacedRef.current = true; // Prevenir qualquer lógica de colocação
    }
    
    const rect = boardRef.current.getBoundingClientRect();
    // Calcular offset da mesma forma que o deck: posição do cursor menos posição da carta
    const offsetX = event.clientX - rect.left - card.position.x;
    const offsetY = event.clientY - rect.top - card.position.y;
    
    setCardMoved(false);
    setDragging({ id: card.id, offsetX, offsetY, startX: event.clientX, startY: event.clientY });
  };

  // Função para resetar todos os estados de drag e flags relacionadas
  const resetAllDragStates = () => {
    setDragging(null);
    setDraggingLibrary(null);
    setCardMoved(false);
    setLibraryMoved(false);
    if (showHand) {
      setDragStartedFromHand(false);
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

  // Handler para clique esquerdo nas cartas
  const handleCardClick = (card: CardOnBoard, event: React.MouseEvent) => {
    // IMPORTANTE: Se ainda há um estado de drag ativo, não processar o clique
    // Isso previne que cartas sejam teleportadas após mudança de zone
    if (dragging) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    
    // Se moveu, não foi um clique - foi um drag, então não fazer tap
    // Verificar cardMoved DEPOIS de verificar dragging para garantir que o estado está correto
    if (cardMoved) {
      event.preventDefault();
      event.stopPropagation();
      // Não limpar cardMoved aqui - será limpo pelo timeout no stopDrag
      return;
    }
    
    // IMPORTANTE: Se há um drag da hand ativo (mesmo que não seja este card), não processar clique
    // Isso previne teleporte após mudança de zona
    if (showHand && (dragStartedFromHand || dragStartedFromHandRef.current)) {
      event.preventDefault();
      event.stopPropagation();
      // Limpar flags imediatamente
      setDragStartedFromHand(false);
      dragStartedFromHandRef.current = false;
      handCardPlacedRef.current = false;
      return;
    }
    
    // IMPORTANTE: Se a carta acabou de mudar de zona (não está mais na zone esperada), não processar clique
    // Isso previne teleporte após mudança de zona do battlefield para hand
    const currentBoard = useGameStore.getState().board;
    const currentCard = currentBoard.find((c) => c.id === card.id);
    if (currentCard && currentCard.zone !== card.zone) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    
    // Garantir que flags de drag da hand estão resetadas para prevenir clonagem (apenas se hand estiver visível)
    if (showHand) {
      setDragStartedFromHand(false);
      dragStartedFromHandRef.current = false;
      handCardPlacedRef.current = false;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    // Se a carta está no board, fazer tap/untap
    if (card.zone === 'battlefield' && card.ownerId === playerId) {
      toggleTap(card.id);
      return;
    }
    
    // Se está na mão, colocar no board (apenas se hand estiver visível)
    if (card.zone === 'hand' && card.ownerId === playerId && showHand) {
      const playerArea = getPlayerArea(playerId);
      if (playerArea) {
        // Calcular posição no centro da área do jogador
        const position = {
          x: playerArea.x + playerArea.width / 2 - CARD_WIDTH / 2,
          y: playerArea.y + playerArea.height / 2 - CARD_HEIGHT / 2,
        };
        
        // Mudar zone da carta de hand para battlefield (ao invés de criar/deletar)
        changeCardZone(card.id, 'battlefield', position);
      }
      return;
    }
  };

  // Handler para remover carta (clique direito - cemitério)
  const handleCardContextMenu = (card: CardOnBoard, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Só pode remover suas próprias cartas
    if (card.ownerId === playerId) {
      removeCard(card.id);
    }
  };


  const startLibraryDrag = (targetPlayerId: string, event: React.PointerEvent) => {
    if (targetPlayerId !== playerId) return; // Só pode mover seu próprio library
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    if (!boardRef.current) return;
    
    const libraryPos = getLibraryPosition(targetPlayerId);
    if (!libraryPos) return;
    
    const rect = boardRef.current.getBoundingClientRect();
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

  useEffect(() => {
    if (!draggingLibrary) return;

    const handleMove = (event: PointerEvent) => {
      if (!boardRef.current) return;
      
      // Verificar se moveu mais de 5px para distinguir clique de arrasto
      const deltaX = Math.abs(event.clientX - draggingLibrary.startX);
      const deltaY = Math.abs(event.clientY - draggingLibrary.startY);
      if (deltaX > 5 || deltaY > 5) {
        setLibraryMoved(true);
      }

      const rect = boardRef.current.getBoundingClientRect();
      const area = getPlayerArea(draggingLibrary.playerId);
      if (!area) return;

      const x = event.clientX - rect.left - draggingLibrary.offsetX;
      const y = event.clientY - rect.top - draggingLibrary.offsetY;

      // Limitar movimento dentro da área do player
      const clampedX = Math.max(
        area.x,
        Math.min(area.x + area.width - LIBRARY_CARD_WIDTH, x)
      );
      const clampedY = Math.max(
        area.y,
        Math.min(area.y + area.height - LIBRARY_CARD_HEIGHT, y)
      );

      // Atualizar posição local para feedback visual imediato
      const newPos = {
        x: clampedX - area.x,
        y: clampedY - area.y,
      };
      
      setLibraryPositions((prev) => ({
        ...prev,
        [draggingLibrary.playerId]: newPos,
      }));
      
      // Sincronizar em tempo real (igual às cartas isoladas)
      moveLibrary(draggingLibrary.playerId, { x: clampedX, y: clampedY });
    };

    const stopDrag = (event: PointerEvent) => {
      const wasMoved = libraryMoved;
      const playerIdToCheck = draggingLibrary.playerId;
      const startX = draggingLibrary.startX;
      const startY = draggingLibrary.startY;
      
      // Verificar se realmente moveu comparando posição inicial e final
      const finalDeltaX = Math.abs(event.clientX - startX);
      const finalDeltaY = Math.abs(event.clientY - startY);
      const actuallyMoved = finalDeltaX > 5 || finalDeltaY > 5;
      
      setDraggingLibrary(null);
      
      // Se não moveu, foi um clique - comprar carta
      if (!wasMoved && !actuallyMoved && playerIdToCheck === playerId) {
        setTimeout(() => {
          handleLibraryClick(playerIdToCheck);
        }, 10);
      }
      
      // Reset após delay
      setTimeout(() => setLibraryMoved(false), 100);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopDrag);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopDrag);
    };
  }, [draggingLibrary, moveLibrary, playerId]);

  return (
    <div className="board-wrapper">
      <div className="board-toolbar">
        <h2>Battlefield</h2>
        <span className="muted">{instruction}</span>
        <button
          onClick={() => {
            setHandButtonEnabled(true); // Habilitar o botão na primeira vez que clicar
            setShowHand(!showHand);
          }}
          disabled={!handButtonEnabled}
          style={{
            marginLeft: 'auto',
            padding: '8px 16px',
            backgroundColor: showHand ? '#ef4444' : '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: handButtonEnabled ? 'pointer' : 'not-allowed',
            fontSize: '14px',
            opacity: handButtonEnabled ? 1 : 0.5,
          }}
        >
          {showHand ? 'Esconder Hand' : 'Mostrar Hand'}
        </button>
      </div>
      <div 
        className="board-surface" 
        ref={boardRef}
        onClick={(e) => {
          // Resetar todos os estados ao clicar em qualquer lugar do board
          // Verificar se o clique não foi em uma carta, botão ou outro elemento interativo
          const target = e.target as HTMLElement;
          const isInteractive = target.closest(
            `.card-token, button, .library-stack, .player-area${showHand ? ', .hand-card-wrapper, .hand-area' : ''}`
          );
          
          // Se não foi em um elemento interativo, resetar estados
          if (!isInteractive) {
            resetAllDragStates();
          }
        }}
      >
        {board.length === 0 && <div className="empty-state">No cards yet. Add cards from the search or a deck.</div>}
        
        {/* Player areas */}
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
              
              {/* Library stack - renderizado fora do player-area para evitar problemas de z-index */}
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
                        pointerEvents: 'none', // Prevenir que cartas bloqueiem o drag
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
        
        {/* Battlefield cards */}
        {battlefieldCards.map((card) => (
          <div
            key={card.id}
            style={{
              position: 'absolute',
              left: `${card.position.x}px`,
              top: `${card.position.y}px`,
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
        ))}
        
        {/* Hand component */}
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
            setDragStartedFromHand={setDragStartedFromHand}
          />
        )}
      </div>
    </div>
  );
};

export default Board;
