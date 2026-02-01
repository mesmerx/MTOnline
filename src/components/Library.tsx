import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CardOnBoard } from '../store/useGameStore';
import CardToken from './CardToken';
import LibrarySearch from './LibrarySearch';
import { useState } from 'react';

type Point = { x: number; y: number };

const LIBRARY_CARD_WIDTH = 100;
const LIBRARY_CARD_HEIGHT = 140;

interface LibraryProps {
  boardRef: React.RefObject<HTMLDivElement | null>;
  playerName: string;
  libraryCards: CardOnBoard[];
  players: Array<{ id: string; name: string }>;
  getPlayerArea: (ownerId: string) => { x: number; y: number; width: number; height: number } | null;
  getLibraryPosition: (ownerId: string) => Point | null;
  ownerName: (card: CardOnBoard) => string;
  onLibraryContextMenu: (card: CardOnBoard, event: React.MouseEvent) => void;
  startLibraryDrag: (playerName: string, event: ReactPointerEvent) => void;
  draggingLibrary: { playerName: string; offsetX: number; offsetY: number; startX: number; startY: number } | null;
  startDrag: (card: CardOnBoard, event: ReactPointerEvent) => void;
  handleCardZoom?: (card: CardOnBoard, event: ReactPointerEvent) => void;
  zoomedCard?: string | null;
  changeCardZone?: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery' | 'exile' | 'commander' | 'tokens', position: Point, libraryPlace?: 'top' | 'bottom' | 'random') => void;
  getCemeteryPosition?: (playerName: string) => Point | null;
  board?: CardOnBoard[];
  reorderLibraryCard?: (cardId: string, newIndex: number) => void;
  setLibraryContainerRef?: (playerName: string, element: HTMLDivElement | null) => void;
}

const Library = ({
  boardRef,
  playerName,
  libraryCards,
  players,
  getPlayerArea,
  getLibraryPosition,
  ownerName,
  onLibraryContextMenu,
  startLibraryDrag,
  draggingLibrary,
  startDrag,
  handleCardZoom,
  changeCardZone,
  getCemeteryPosition,
  board = [],
  reorderLibraryCard,
  setLibraryContainerRef,
}: LibraryProps) => {
  const [showLibrarySearch, setShowLibrarySearch] = useState(false);

  if (!boardRef.current || players.length === 0 || !playerName) {
    return null;
  }

  return (
    <>
      {players.map((player) => {
        const area = getPlayerArea(player.name);
        if (!area) return null;
        const isCurrentPlayer = player.name === playerName;
        const isSimulated = player.id.startsWith('simulated-');
        const canInteract = isCurrentPlayer || isSimulated;
        const libraryPos = getLibraryPosition(player.name);
        const playerLibraryCards = libraryCards.filter((c) => c.ownerId === player.name);
        const sortedLibraryCards = [...playerLibraryCards].sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));

        if (!libraryPos || sortedLibraryCards.length === 0) {
          return null;
        }

        return (
          <div
            key={player.id}
            ref={(element) => setLibraryContainerRef?.(player.name, element)}
            style={{
              position: 'absolute',
              left: `${libraryPos.x}px`,
              top: `${libraryPos.y - 20}px`,
            }}
          >
            {/* Label com nome do dono */}
            <div
              style={{
                position: 'absolute',
                top: '0px',
                left: '0px',
                fontSize: '11px',
                fontWeight: 'bold',
                color: '#fff',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                padding: '2px 6px',
                borderRadius: '4px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                zIndex: 100,
              }}
            >
              {player.name} - Deck
            </div>
            <div
              className={`library-stack ${isCurrentPlayer ? 'draggable' : ''}`}
              data-testid={`library-${player.name}`}
              draggable={isCurrentPlayer}
              style={{
                position: 'absolute',
                left: '0px',
                top: '20px',
                cursor: isCurrentPlayer ? (draggingLibrary?.playerName === player.name ? 'grabbing' : 'grab') : 'pointer',
                pointerEvents: 'auto',
              }}
              onPointerDown={(e) => {
                if (canInteract) {
                  // Se for botão direito, não fazer nada (abre menu de contexto)
                  if (e.button === 2) return;
                  // Se for botão do meio, não fazer nada
                  if (e.button === 1) return;
                  // Se segurar Shift, arrastar carta individual para mudar de zona
                  if (e.shiftKey && sortedLibraryCards.length > 0) {
                    e.stopPropagation();
                    e.preventDefault();
                    const topCard = sortedLibraryCards[0];
                    startDrag(topCard, e);
                    return; // IMPORTANTE: retornar para não executar o código abaixo
                  }
                  // Caso contrário, arrastar o stack inteiro
                  e.preventDefault();
                  e.stopPropagation();
                  startLibraryDrag(player.name, e);
                }
              }}
              onContextMenu={(e) => {
                if (isCurrentPlayer && sortedLibraryCards.length > 0) {
                  e.preventDefault();
                  e.stopPropagation();
                  // Usar a primeira carta do stack para representar a library no menu
                  const topCard = sortedLibraryCards[0];
                  onLibraryContextMenu(topCard, e);
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
                    pointerEvents: index === 0 && isCurrentPlayer ? 'auto' : 'none',
                    zIndex: 5 - index,
                  }}
                  onPointerDown={(e) => {
                    // Só processar se for a primeira carta (topo do stack)
                    if (index === 0 && isCurrentPlayer) {
                      // Se for botão do meio, fazer zoom
                      if (e.button === 1 && handleCardZoom) {
                        e.stopPropagation();
                        e.preventDefault();
                        handleCardZoom(card, e);
                        return;
                      }
                      // Se for botão esquerdo E segurar Shift, arrastar carta individual para mudar de zona
                      if (e.button === 0 && e.shiftKey) {
                        e.stopPropagation();
                        e.preventDefault();
                        startDrag(card, e);
                        return; // IMPORTANTE: retornar para não propagar
                      }
                      // Caso contrário, deixar o evento propagar para o container (para arrastar o stack)
                      // Não chamar stopPropagation nem preventDefault aqui
                    } else {
                      // Para outras cartas, sempre bloquear propagação
                      e.stopPropagation();
                    }
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

              {/* Botão Buscar no Deck */}
              {isCurrentPlayer && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowLibrarySearch(true);
                  }}
                  style={{
                    position: 'absolute',
                    top: '20px',
                    left: '120px',
                    padding: '4px 8px',
                    backgroundColor: '#6366f1',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '10px',
                    fontWeight: '500',
                    zIndex: 10,
                  }}
                  title="Search card in deck and move to a zone"
                >
                  🔍 Search
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Busca de cartas no library */}
      {changeCardZone && getCemeteryPosition && (
        <LibrarySearch
          libraryCards={libraryCards}
          playerName={playerName}
          isOpen={showLibrarySearch}
          onClose={() => setShowLibrarySearch(false)}
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
            } else if (zone === 'hand') {
              position = { x: 0, y: 0 };
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
          reorderLibraryCard={reorderLibraryCard}
        />
      )}
    </>
  );
};

export default Library;
