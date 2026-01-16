import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { CardOnBoard } from '../store/useGameStore';
import CardToken from './CardToken';

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
  const drawFromLibrary = useGameStore((state) => state.drawFromLibrary);
  const addCardToBoard = useGameStore((state) => state.addCardToBoard);
  const reorderHandCard = useGameStore((state) => state.reorderHandCard);
  const status = useGameStore((state) => state.status);
  const boardRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const [libraryPositions, setLibraryPositions] = useState<Record<string, Point>>({});
  const [draggingLibrary, setDraggingLibrary] = useState<{ playerId: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const [libraryMoved, setLibraryMoved] = useState(false);
  const [cardMoved, setCardMoved] = useState(false);
  const [handScrollIndex, setHandScrollIndex] = useState(0);
  const maxRenderCards = 9; // Máximo de cartas renderizadas (constante)
  const [isSliding, setIsSliding] = useState(false); // Estado para animação de slide
  const [draggingHandCard, setDraggingHandCard] = useState<string | null>(null);
  const [previewHandOrder, setPreviewHandOrder] = useState<number | null>(null); // Índice de preview durante drag
  const [dragPosition, setDragPosition] = useState<Point | null>(null); // Posição atual do cursor durante drag
  const [zoomedCard, setZoomedCard] = useState<string | null>(null); // Carta com zoom ativo
  const [hoveredHandCard, setHoveredHandCard] = useState<string | null>(null); // Carta com hover para criar espaço
  const [initialHoverIndex, setInitialHoverIndex] = useState<number | null>(null); // Índice inicial do hover quando drag começa
  const [originalHandOrder, setOriginalHandOrder] = useState<Record<string, number> | null>(null); // Stack original: mapeia cardId -> handIndex
  
  // Refs para throttling de atualizações durante drag
  const dragUpdateRef = useRef<number>(0);
  const libraryDragUpdateRef = useRef<number>(0);
  const THROTTLE_MS = 8; // ~120fps para melhor responsividade durante drag
  
  const battlefieldCards = board.filter((c) => c.zone === 'battlefield');
  const libraryCards = board.filter((c) => c.zone === 'library');
  const handCards = board.filter((c) => c.zone === 'hand');

  const getPlayerArea = (ownerId: string) => {
    if (!boardRef.current || players.length === 0) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const playerIndex = players.findIndex((p) => p.id === ownerId);
    if (playerIndex === -1) return null;

    // Calcular número de colunas e linhas baseado no número de players
    const totalPlayers = players.length;
    const cols = totalPlayers <= 2 ? totalPlayers : Math.ceil(Math.sqrt(totalPlayers));
    const rows = Math.ceil(totalPlayers / cols);

    // Reservar espaço para a mão (150px de altura)
    const handHeight = 150;
    const availableHeight = rect.height - handHeight;
    const areaWidth = rect.width / cols;
    const areaHeight = availableHeight / rows;
    const col = playerIndex % cols;
    const row = Math.floor(playerIndex / cols);

    return {
      x: col * areaWidth,
      y: row * areaHeight,
      width: areaWidth,
      height: areaHeight,
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

  const getHandArea = (ownerId: string) => {
    if (!boardRef.current || players.length === 0) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const playerIndex = players.findIndex((p) => p.id === ownerId);
    if (playerIndex === -1) return null;

    // Altura suficiente apenas para a elipse (cerca de 25% da altura da tela)
    const handHeight = rect.height * 0.25;
    // Posicionar na parte inferior da tela
    const handY = rect.height - handHeight;

    return {
      x: 0,
      y: handY,
      width: rect.width,
      height: handHeight,
    };
  };


  useEffect(() => {
    if (!dragging) return;
    const handleMove = (event: PointerEvent) => {
      if (!boardRef.current) return;
      
      // Verificar se moveu mais de 5px para distinguir clique de arrasto
      const deltaX = Math.abs(event.clientX - dragging.startX);
      const deltaY = Math.abs(event.clientY - dragging.startY);
      if (deltaX > 5 || deltaY > 5) {
        setCardMoved(true);
      }
      
      const rect = boardRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left - dragging.offsetX;
      const y = event.clientY - rect.top - dragging.offsetY;
      
      // Encontrar a área do player para a carta
      const card = board.find((c) => c.id === dragging.id);
      if (!card) return;
      
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
      } else if (card.zone === 'hand') {
        const handArea = getHandArea(card.ownerId);
        if (handArea) {
          clampedX = Math.max(
            handArea.x,
            Math.min(handArea.x + handArea.width - HAND_CARD_WIDTH, x)
          );
          clampedY = Math.max(
            handArea.y,
            Math.min(handArea.y + handArea.height - HAND_CARD_HEIGHT, y)
          );
        }
      }
      
      moveCard(dragging.id, { x: clampedX, y: clampedY });
    };

    const stopDrag = () => {
      setDragging(null);
      setTimeout(() => setCardMoved(false), 100);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopDrag);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopDrag);
    };
  }, [dragging, moveCard, board, players]);

  const startDrag = (card: CardOnBoard, event: ReactPointerEvent) => {
    // Só pode mover suas próprias cartas
    if (card.ownerId !== playerId) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    if (!boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const offsetX = event.clientX - rect.left - card.position.x;
    const offsetY = event.clientY - rect.top - card.position.y;
    setCardMoved(false);
    setDragging({ id: card.id, offsetX, offsetY, startX: event.clientX, startY: event.clientY });
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
    // Se moveu, não foi um clique - foi um drag
    if (cardMoved) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    // Se a carta está no board, fazer tap/untap
    if (card.zone === 'battlefield' && card.ownerId === playerId) {
      toggleTap(card.id);
      return;
    }
    
    // Se está na mão, colocar no board
    if (card.zone === 'hand' && card.ownerId === playerId) {
      const playerArea = getPlayerArea(playerId);
      if (playerArea) {
        // Calcular posição no centro da área do jogador
        const position = {
          x: playerArea.x + playerArea.width / 2 - CARD_WIDTH / 2,
          y: playerArea.y + playerArea.height / 2 - CARD_HEIGHT / 2,
        };
        
        // Criar nova carta no board com os mesmos dados
        addCardToBoard({
          name: card.name,
          imageUrl: card.imageUrl,
          oracleText: card.oracleText,
          manaCost: card.manaCost,
          typeLine: card.typeLine,
          setName: card.setName,
          position,
        });
        
        // Remover da mão
        removeCard(card.id);
      }
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

  // Função para iniciar drag de carta da mão
  const startHandDrag = (card: CardOnBoard, event: ReactPointerEvent) => {
    if (card.ownerId !== playerId) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    if (!boardRef.current) return;
    
    const rect = boardRef.current.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    
    // Salvar ordem original
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
    
    // Salvar índice inicial do hover se houver
    if (hoveredHandCard) {
      const hoveredIndex = originalOrder[hoveredHandCard] ?? 
        sortedCards.findIndex((c) => c.id === hoveredHandCard);
      setInitialHoverIndex(hoveredIndex >= 0 ? hoveredIndex : null);
    }
    
    setDraggingHandCard(card.id);
    setHoveredHandCard(null);
    setDragPosition({ x: cursorX, y: cursorY });
    setPreviewHandOrder(null);
  };

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
      
      setDragPosition({ x: cursorX, y: cursorY });
      
      // Calcular novo índice baseado na posição X
      const CARD_SPACING_PX = HAND_CARD_WIDTH;
      const centerXPx = rect.width / 2;
      const CENTER_INDEX = 4;
      
      const playerHandCards = board.filter((c) => c.zone === 'hand' && c.ownerId === playerId);
      const allCards = [...playerHandCards].sort((a, b) => {
        const indexA = originalHandOrder?.[a.id] ?? a.handIndex ?? 0;
        const indexB = originalHandOrder?.[b.id] ?? b.handIndex ?? 0;
        return indexA - indexB;
      });
      
      const totalCards = allCards.length;
      const spacing = CARD_SPACING_PX;
      
      // Encontrar qual índice corresponde à posição do cursor
      let newIndex = 0;
      for (let i = 0; i < totalCards; i++) {
        const cardXPx = centerXPx + ((i - CENTER_INDEX) * spacing);
        const threshold = cardXPx + (spacing / 2);
        if (cursorX < threshold) {
          newIndex = i;
          break;
        }
        newIndex = i + 1;
      }
      newIndex = Math.max(0, Math.min(totalCards - 1, newIndex));
      
      const originalIndex = originalHandOrder?.[draggingHandCard] ?? 
        allCards.findIndex((c) => c.id === draggingHandCard);
      
      if (originalIndex >= 0 && newIndex !== originalIndex) {
        setPreviewHandOrder(newIndex);
      } else if (newIndex === originalIndex) {
        setPreviewHandOrder(originalIndex);
      }
    };
    
    const stopDrag = () => {
      if (previewHandOrder !== null && draggingHandCard) {
        const originalIndex = originalHandOrder?.[draggingHandCard];
        if (originalIndex !== undefined && originalIndex !== previewHandOrder) {
          reorderHandCard(draggingHandCard, previewHandOrder);
        }
      }
      
      setDraggingHandCard(null);
      setPreviewHandOrder(null);
      setDragPosition(null);
      setHoveredHandCard(null);
      setInitialHoverIndex(null);
      setOriginalHandOrder(null);
    };
    
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopDrag);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopDrag);
    };
  }, [draggingHandCard, previewHandOrder, originalHandOrder, board, playerId, reorderHandCard, hoveredHandCard]);

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
      </div>
      <div className="board-surface" ref={boardRef}>
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
        
        {/* Hand areas - apenas visível para o próprio jogador */}
        {players.length > 0 && players.map((player) => {
          const handArea = getHandArea(player.id);
          if (!handArea) return null;
          const isCurrentPlayer = player.id === playerId;
          const playerHandCards = handCards.filter((c) => c.ownerId === player.id);
          
          // Só mostrar a mão do próprio jogador
          if (!isCurrentPlayer) return null;
          
          if (!boardRef.current) return null;
          const boardRect = boardRef.current.getBoundingClientRect();
          
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
                  // Stack original: ordenar cartas por handIndex original
                  let sortedHandCards = [...playerHandCards].sort((a, b) => {
                    if (a.handIndex !== undefined && b.handIndex !== undefined) {
                      return a.handIndex - b.handIndex;
                    }
                    if (a.handIndex !== undefined) return -1;
                    if (b.handIndex !== undefined) return 1;
                    return a.id.localeCompare(b.id);
                  });
                  
                  // Criar stack preview se houver drag
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
                  
                  // Usar stack preview se disponível, senão usar original
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
                      {/* Botão de seta esquerda */}
                      {renderStartIndex > 0 && (
                        <button
                          className="hand-nav-button hand-nav-left"
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
                      
                      {/* Botão de seta direita */}
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
                      
                      {/* Cartas lado a lado */}
                      {visibleCards.map((card, visibleIndex) => {
                        const isDragging = draggingHandCard === card.id;
                        const isZoomed = zoomedCard === card.id;
                        const isHovered = hoveredHandCard === card.id && !draggingHandCard;
                        
                        const CARD_SPACING_PX = HAND_CARD_WIDTH;
                        const centerXPx = boardRect.width / 2;
                        const CENTER_INDEX = 4;
                        
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
                          positionIndex = displayIndex;
                        } else {
                          positionIndex = visibleIndex;
                        }
                        
                        const cardXPx = centerXPx + ((positionIndex - CENTER_INDEX) * CARD_SPACING_PX);
                        const cardXPercent = (cardXPx / boardRect.width) * 100;
                        
                        if (isDragging) {
                          const spaceDisplayIndex = previewHandOrder !== null ? previewHandOrder : actualIndex;
                          const spaceXPx = centerXPx + ((spaceDisplayIndex - CENTER_INDEX) * CARD_SPACING_PX);
                          const spaceXPercent = (spaceXPx / boardRect.width) * 100;
                          const cardHeightPercent = (HAND_CARD_HEIGHT / boardRect.height) * 100;
                          const cardWidthPercent = (HAND_CARD_WIDTH / boardRect.width) * 100;
                          
                          return (
                            <div
                              key={card.id}
                              style={{
                                position: 'absolute',
                                left: `${spaceXPercent}%`,
                                top: '85%',
                                width: `${cardWidthPercent}%`,
                                height: `${cardHeightPercent}%`,
                                pointerEvents: 'none',
                              }}
                            >
                              <div
                                style={{
                                  position: 'absolute',
                                  top: '-25px',
                                  left: '50%',
                                  transform: 'translateX(-50%)',
                                  background: 'rgba(255, 0, 0, 0.8)',
                                  color: 'white',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  fontWeight: 'bold',
                                  whiteSpace: 'nowrap',
                                  zIndex: 1001,
                                }}
                              >
                                {actualIndex} → {previewHandOrder !== null ? previewHandOrder : actualIndex} (arrastada)
                              </div>
                              <div
                                style={{
                                  position: 'absolute',
                                  bottom: '-25px',
                                  left: '50%',
                                  transform: 'translateX(-50%)',
                                  background: 'rgba(255, 0, 0, 0.8)',
                                  color: 'white',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  fontWeight: 'bold',
                                  whiteSpace: 'nowrap',
                                  zIndex: 1001,
                                }}
                              >
                                {actualIndex} → {previewHandOrder !== null ? previewHandOrder : actualIndex} (arrastada)
                              </div>
                            </div>
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
                              left: `${cardXPercent}%`,
                              top: `${cardYPercent}%`,
                              zIndex: isDragging ? 1000 : actualIndex,
                              transform: `translate(calc(-50% + ${horizontalOffset}px), calc(-100% + ${verticalOffset}px)) rotate(${rotation}deg)`,
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
                              if (card.zone === 'hand' && card.ownerId === playerId) {
                                startHandDrag(card, event);
                              } else {
                                startDrag(card, event);
                              }
                            }}
                            onClick={(event) => handleCardClick(card, event)}
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
                      
                      {/* Carta arrastada seguindo o cursor */}
                      {draggingHandCard && dragPosition && (() => {
                        const draggedCard = board.find((c) => c.id === draggingHandCard);
                        if (!draggedCard) return null;
                        const draggedXPercent = (dragPosition.x / boardRect.width) * 100;
                        const draggedYPercent = (dragPosition.y / boardRect.height) * 100;
                        return (
                          <div
                            className="hand-card-wrapper dragging"
                            style={{
                              position: 'absolute',
                              left: `${draggedXPercent}%`,
                              top: `${draggedYPercent}%`,
                              zIndex: 1000,
                              transform: 'translate(-50%, -50%)',
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
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Board;
