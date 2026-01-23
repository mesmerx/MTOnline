import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CardOnBoard } from '../store/useGameStore';
import CardToken from './CardToken';

type Point = { x: number; y: number };

const CEMETERY_CARD_WIDTH = 100;
const CEMETERY_CARD_HEIGHT = 140;

interface CemeteryProps {
  boardRef: React.RefObject<HTMLDivElement | null>;
  playerId: string;
  cemeteryCards: CardOnBoard[];
  players: Array<{ id: string; name: string }>;
  getCemeteryPosition: (playerId: string) => Point | null;
  ownerName: (card: CardOnBoard) => string;
  onCemeteryContextMenu: (card: CardOnBoard, event: React.MouseEvent) => void;
  startDrag: (card: CardOnBoard, event: ReactPointerEvent) => void;
  startCemeteryDrag: (playerId: string, event: ReactPointerEvent) => void;
  draggingCemetery: { playerId: string; offsetX: number; offsetY: number; startX: number; startY: number } | null;
}

const Cemetery = ({
  boardRef,
  playerId,
  cemeteryCards,
  players,
  getCemeteryPosition,
  ownerName,
  onCemeteryContextMenu,
  startDrag,
  startCemeteryDrag,
  draggingCemetery,
}: CemeteryProps) => {
  if (!boardRef.current || players.length === 0) return null;

  // Agrupar cartas por owner
  const cemeteryByOwner = players.map((player) => {
    const playerCemeteryCards = cemeteryCards.filter((c) => c.ownerId === player.id);
    const sortedCemeteryCards = [...playerCemeteryCards].sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));
    return { player, cards: sortedCemeteryCards };
  });

  return (
    <>
      {cemeteryByOwner.map(({ player, cards }) => {
        const cemeteryPos = getCemeteryPosition(player.id);
        if (!cemeteryPos) return null;

        return (
          <div
            key={player.id}
            style={{
              position: 'absolute',
              left: `${cemeteryPos.x}px`,
              top: `${cemeteryPos.y - 20}px`,
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
              {player.name} - Cemitério
            </div>
            <div
              className={`cemetery-stack ${player.id === playerId ? 'draggable' : ''}`}
              style={{
                position: 'absolute',
                left: '0px',
                top: '20px',
                width: `${CEMETERY_CARD_WIDTH}px`,
                height: `${CEMETERY_CARD_HEIGHT}px`,
                cursor: player.id === playerId ? (draggingCemetery && draggingCemetery.playerId === player.id ? 'grabbing' : 'grab') : 'pointer',
                pointerEvents: 'auto',
              }}
            onPointerDown={(e) => {
              console.log('[Cemetery] onPointerDown', { 
                playerId: player.id, 
                currentPlayerId: playerId, 
                matches: player.id === playerId,
                button: e.button,
                shiftKey: e.shiftKey,
                cardsLength: cards.length 
              });
              
              if (player.id === playerId) {
                // Se for botão direito, não fazer nada (abre menu de contexto)
                if (e.button === 2) return;
                // Se for botão do meio, não fazer nada
                if (e.button === 1) return;
                // Se segurar Shift, arrastar carta individual
                if (e.shiftKey && cards.length > 0) {
                  e.stopPropagation();
                  const topCard = cards[0];
                  startDrag(topCard, e);
                } else {
                  // Caso contrário, arrastar o stack inteiro
                  console.log('[Cemetery] Chamando startCemeteryDrag', player.id);
                  startCemeteryDrag(player.id, e);
                }
              } else {
                console.log('[Cemetery] Bloqueado - não é o player atual');
              }
            }}
            onContextMenu={(e) => {
              if (cards.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                const topCard = cards[0];
                onCemeteryContextMenu(topCard, e);
              }
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
                      if (index === 0 && card.ownerId === playerId) {
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
                      width={CEMETERY_CARD_WIDTH}
                      height={CEMETERY_CARD_HEIGHT}
                      showBack={false}
                    />
                  </div>
                ))}
                <div className="cemetery-count">{cards.length}</div>
              </>
            ) : (
              <>
                {/* Mostrar área vazia do cemitério */}
                <div
                  style={{
                    position: 'absolute',
                    width: `${CEMETERY_CARD_WIDTH}px`,
                    height: `${CEMETERY_CARD_HEIGHT}px`,
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
                  <span style={{ color: 'rgba(148, 163, 184, 0.6)', fontSize: '16px' }}>⚰️</span>
                </div>
                <div className="cemetery-count" style={{ opacity: 0.5, pointerEvents: 'none' }}>0</div>
              </>
            )}
            </div>
          </div>
        );
      })}
    </>
  );
};

export default Cemetery;

