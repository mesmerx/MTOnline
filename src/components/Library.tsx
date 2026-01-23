import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CardOnBoard } from '../store/useGameStore';
import CardToken from './CardToken';

type Point = { x: number; y: number };

const LIBRARY_CARD_WIDTH = 100;
const LIBRARY_CARD_HEIGHT = 140;

interface LibraryProps {
  boardRef: React.RefObject<HTMLDivElement | null>;
  playerId: string;
  libraryCards: CardOnBoard[];
  players: Array<{ id: string; name: string }>;
  getPlayerArea: (ownerId: string) => { x: number; y: number; width: number; height: number } | null;
  getLibraryPosition: (ownerId: string) => Point | null;
  ownerName: (card: CardOnBoard) => string;
  onLibraryContextMenu: (card: CardOnBoard, event: React.MouseEvent) => void;
  startLibraryDrag: (playerId: string, event: ReactPointerEvent) => void;
  draggingLibrary: { playerId: string; offsetX: number; offsetY: number; startX: number; startY: number } | null;
  startDrag: (card: CardOnBoard, event: ReactPointerEvent) => void;
}

const Library = ({
  boardRef,
  playerId,
  libraryCards,
  players,
  getPlayerArea,
  getLibraryPosition,
  ownerName,
  onLibraryContextMenu,
  startLibraryDrag,
  draggingLibrary,
  startDrag,
}: LibraryProps) => {
  if (!boardRef.current || players.length === 0) return null;

  return (
    <>
      {players.map((player) => {
        const area = getPlayerArea(player.id);
        if (!area) return null;
        const isCurrentPlayer = player.id === playerId;
        const libraryPos = getLibraryPosition(player.id);
        const playerLibraryCards = libraryCards.filter((c) => c.ownerId === player.id);
        const sortedLibraryCards = [...playerLibraryCards].sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));

        if (!libraryPos || sortedLibraryCards.length === 0) return null;

        return (
          <div
            key={player.id}
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
              style={{
                position: 'absolute',
                left: '0px',
                top: '20px',
                cursor: isCurrentPlayer ? (draggingLibrary?.playerId === player.id ? 'grabbing' : 'grab') : 'pointer',
              }}
            onPointerDown={(e) => {
              if (isCurrentPlayer) {
                // Se for botão direito, não fazer nada (abre menu de contexto)
                if (e.button === 2) return;
                // Se for botão do meio, não fazer nada
                if (e.button === 1) return;
                // Se segurar Shift, arrastar carta individual
                if (e.shiftKey && sortedLibraryCards.length > 0) {
                  e.stopPropagation();
                  const topCard = sortedLibraryCards[0];
                  startDrag(topCard, e);
                } else {
                  // Caso contrário, arrastar o stack inteiro
                  startLibraryDrag(player.id, e);
                }
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
                  if (index === 0 && isCurrentPlayer && e.button === 0 && e.shiftKey) {
                    e.stopPropagation();
                    startDrag(card, e);
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
            </div>
          </div>
        );
      })}
    </>
  );
};

export default Library;

