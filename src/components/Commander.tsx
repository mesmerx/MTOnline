import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CardOnBoard } from '../store/useGameStore';
import CardToken from './CardToken';

type Point = { x: number; y: number };

const COMMANDER_CARD_WIDTH = 100;
const COMMANDER_CARD_HEIGHT = 140;

interface CommanderProps {
  boardRef: React.RefObject<HTMLDivElement | null>;
  playerName: string;
  commanderCards: CardOnBoard[];
  players: Array<{ id: string; name: string }>;
  getCommanderPosition: (playerName: string) => Point | null;
  ownerName: (card: CardOnBoard) => string;
  selectedCardId?: string | null;
  onCommanderContextMenu: (card: CardOnBoard, event: React.MouseEvent) => void;
  startCommanderDrag: (targetPlayerName: string, event: ReactPointerEvent) => void;
  startDrag: (card: CardOnBoard, event: ReactPointerEvent) => void;
  handleCardZoom?: (card: CardOnBoard, event: ReactPointerEvent) => void;
  zoomedCard?: string | null;
}

const Commander = ({
  boardRef,
  playerName,
  commanderCards,
  players,
  getCommanderPosition,
  ownerName,
  selectedCardId,
  onCommanderContextMenu,
  startCommanderDrag,
  startDrag,
  handleCardZoom,
}: CommanderProps) => {
  if (!boardRef.current || players.length === 0 || !playerName) return null;

  const commanderByOwner = players.map((player) => {
    const playerCommanderCards = commanderCards.filter((c) => c.ownerId === player.name);
    const sortedCommanderCards = [...playerCommanderCards].sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));
    return { player, cards: sortedCommanderCards };
  });

  return (
    <>
      {commanderByOwner.map(({ player, cards }) => {
        const commanderPos = getCommanderPosition(player.name);
        if (!commanderPos) return null;

        const topCard = cards[0];
        const deathCount = topCard?.commanderDeaths ?? 0;

        return (
          <div
            key={player.name}
            style={{
              position: 'absolute',
              left: `${commanderPos.x}px`,
              top: `${commanderPos.y - 20}px`,
            }}
          >
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
              {player.name} - Commander
            </div>
            <div
              className={`commander-stack ${player.name === playerName ? 'draggable' : ''}`}
              style={{
                position: 'absolute',
                left: '0px',
                top: '20px',
                width: `${COMMANDER_CARD_WIDTH}px`,
                height: `${COMMANDER_CARD_HEIGHT}px`,
                cursor: player.name === playerName ? 'grab' : 'default',
                pointerEvents: 'auto',
              }}
              onPointerDown={(e) => {
                if (player.name !== playerName) {
                  return;
                }
                if (e.button !== 0) {
                  return;
                }
                if (e.shiftKey) {
                  return;
                }
                startCommanderDrag(player.name, e);
              }}
            >
              {cards.length > 0 ? (
                <>
                  {cards.slice(0, 5).map((card, index) => (
                    <div
                      key={card.id}
                      style={{
                        position: 'absolute',
                        left: `${index * 3}px`,
                        top: `${index * 3}px`,
                        pointerEvents: index === 0 ? 'auto' : 'none',
                        zIndex: 5 - index,
                      }}
                      onPointerDown={(e) => {
                        if (index !== 0) {
                          e.stopPropagation();
                          return;
                        }
                        if (e.button === 1 && handleCardZoom) {
                          e.stopPropagation();
                          e.preventDefault();
                          handleCardZoom(card, e);
                          return;
                        }
                        if (e.button === 0 && e.shiftKey) {
                          e.stopPropagation();
                          startDrag(card, e);
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onCommanderContextMenu(card, e);
                      }}
                    >
                      <CardToken
                        card={card}
                        onPointerDown={() => {}}
                        onDoubleClick={() => {}}
                        ownerName={ownerName(card)}
                        width={COMMANDER_CARD_WIDTH}
                        height={COMMANDER_CARD_HEIGHT}
                        showBack={false}
                        isSelected={selectedCardId === card.id}
                      />
                    </div>
                  ))}
                  <div
                    style={{
                      position: 'absolute',
                      right: '-6px',
                      bottom: '-6px',
                      padding: '2px 6px',
                      backgroundColor: 'rgba(15, 23, 42, 0.9)',
                      border: '1px solid rgba(148, 163, 184, 0.4)',
                      borderRadius: '999px',
                      color: '#f8fafc',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      zIndex: 10,
                      pointerEvents: 'none',
                    }}
                  >
                    💀 {deathCount}
                  </div>
                </>
              ) : (
                <div
                  style={{
                    position: 'absolute',
                    width: `${COMMANDER_CARD_WIDTH}px`,
                    height: `${COMMANDER_CARD_HEIGHT}px`,
                    left: '0px',
                    top: '0px',
                    border: '2px dashed rgba(148, 163, 184, 0.5)',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(15, 23, 42, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  <span style={{ color: 'rgba(148, 163, 184, 0.6)', fontSize: '16px' }}>⭐</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
};

export default Commander;

