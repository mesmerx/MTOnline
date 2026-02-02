import { useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CardOnBoard } from '../store/useGameStore';
import CardToken from './CardToken';
import ExileSearch from './ExileSearch';

type Point = { x: number; y: number };

const EXILE_CARD_WIDTH = 100;
const EXILE_CARD_HEIGHT = 140;

interface ExileProps {
  boardRef: React.RefObject<HTMLDivElement | null>;
  playerName: string;
  exileCards: CardOnBoard[];
  players: Array<{ id: string; name: string }>;
  getExilePosition: (playerName: string) => Point | null;
  ownerName: (card: CardOnBoard) => string;
  selectedCardId?: string | null;
  handleCardDoubleClick?: (card: CardOnBoard, event: React.MouseEvent) => void;
  onExileContextMenu: (card: CardOnBoard, event: React.MouseEvent) => void;
  startDrag: (card: CardOnBoard, event: ReactPointerEvent) => void;
  startExileDrag: (playerName: string, event: ReactPointerEvent) => void;
  draggingExile: { playerName: string; offsetX: number; offsetY: number; startX: number; startY: number } | null;
  handleCardZoom?: (card: CardOnBoard, event: ReactPointerEvent) => void;
  zoomedCard?: string | null;
  changeCardZone?: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery' | 'exile' | 'commander' | 'tokens', position: Point, libraryPlace?: 'top' | 'bottom' | 'random') => void;
  getLibraryPosition?: (playerName: string) => Point | null;
  getCemeteryPosition?: (playerName: string) => Point | null;
  board?: CardOnBoard[];
}

const Exile = ({
  boardRef,
  playerName,
  exileCards,
  players,
  getExilePosition,
  ownerName,
  selectedCardId,
  handleCardDoubleClick,
  onExileContextMenu,
  startDrag,
  startExileDrag,
  draggingExile,
  handleCardZoom,
  changeCardZone,
  getLibraryPosition,
  getCemeteryPosition,
  board = [],
}: ExileProps) => {
  const [showExileSearch, setShowExileSearch] = useState(false);

  if (!boardRef.current || players.length === 0 || !playerName) return null;

  // Agrupar cartas por owner
  const exileByOwner = players.map((player) => {
    const playerExileCards = exileCards.filter((c) => c.ownerId === player.name);
    const sortedExileCards = [...playerExileCards].sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));
    return { player, cards: sortedExileCards };
  });

  return (
    <>
      {exileByOwner.map(({ player, cards }) => {
        const exilePos = getExilePosition(player.name);
        if (!exilePos) return null;

        return (
          <div
            key={player.name}
            style={{
              position: 'absolute',
              left: `${exilePos.x}px`,
              top: `${exilePos.y - 20}px`,
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
              {player.name} - Exile
            </div>
            {/* Botão Buscar no Exílio */}
            {player.name === playerName && changeCardZone && getCemeteryPosition && getLibraryPosition && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setShowExileSearch(true);
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                style={{
                  position: 'absolute',
                  top: `${20 + EXILE_CARD_HEIGHT + 5}px`,
                  left: '0px',
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
                  width: `${EXILE_CARD_WIDTH}px`,
                  textAlign: 'center',
                }}
                title="Search card in exile and move to a zone"
              >
                🔍 Search
              </button>
            )}
            <div
              className={`exile-stack ${player.name === playerName ? 'draggable' : ''}`}
              style={{
                position: 'absolute',
                left: '0px',
                top: '20px',
                width: `${EXILE_CARD_WIDTH}px`,
                height: `${EXILE_CARD_HEIGHT}px`,
                cursor: player.name === playerName ? (draggingExile && draggingExile.playerName === player.name ? 'grabbing' : 'grab') : 'pointer',
                pointerEvents: 'auto',
              }}
              onPointerDown={(e) => {
                // Verificar se o player dono do exílio é o player atual
                const isOwner = player.name === playerName;
                // Permitir que qualquer player possa mexer em players simulados
                const isSimulated = player.id.startsWith('simulated-');
                const canInteract = isOwner || isSimulated;

                if (canInteract) {
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
                    e.preventDefault();
                    e.stopPropagation();
                    startExileDrag(player.name, e);
                  }
                } else {
                }
              }}
              onContextMenu={(e) => {
                if (cards.length > 0) {
                  e.preventDefault();
                  e.stopPropagation();
                  const topCard = cards[0];
                  onExileContextMenu(topCard, e);
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
                        // Só processar se for a primeira carta (topo do stack)
                        if (index === 0 && card.ownerId === playerName) {
                          // Se for botão do meio, fazer zoom
                          if (e.button === 1 && handleCardZoom) {
                            e.stopPropagation();
                            handleCardZoom(card, e);
                          }
                          // Se for botão esquerdo E segurar Shift, arrastar carta individual
                          else if (e.button === 0 && e.shiftKey) {
                            e.stopPropagation();
                            startDrag(card, e);
                          }
                          // Caso contrário, deixar o evento propagar para o container (para arrastar o stack)
                        } else {
                          // Para outras cartas, sempre bloquear propagação
                          e.stopPropagation();
                        }
                      }}
                    >
                      <CardToken
                        card={card}
                        onPointerDown={() => {}}
                        onDoubleClick={(event) => {
                          if (!handleCardDoubleClick) return;
                          event.stopPropagation();
                          event.preventDefault();
                          handleCardDoubleClick(card, event);
                        }}
                        ownerName={ownerName(card)}
                        width={EXILE_CARD_WIDTH}
                        height={EXILE_CARD_HEIGHT}
                        showBack={false}
                        isSelected={selectedCardId === card.id}
                      />
                    </div>
                  ))}
                  <div className="exile-count">{cards.length}</div>
                </>
              ) : (
                <>
                  {/* Mostrar área vazia do exílio */}
                  <div
                    style={{
                      position: 'absolute',
                      width: `${EXILE_CARD_WIDTH}px`,
                      height: `${EXILE_CARD_HEIGHT}px`,
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
                    <span style={{ color: 'rgba(148, 163, 184, 0.6)', fontSize: '16px' }}>🚫</span>
                  </div>
                  <div className="exile-count" style={{ opacity: 0.5, pointerEvents: 'none' }}>0</div>
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* Busca de cartas no exílio */}
      {changeCardZone && getCemeteryPosition && getLibraryPosition && (
        <ExileSearch
          exileCards={exileCards}
          playerName={playerName}
          isOpen={showExileSearch}
          onClose={() => setShowExileSearch(false)}
          onMoveCard={(cardId, zone, libraryPlace) => {
            const card = board.find((c) => c.id === cardId);
            if (!card || !changeCardZone) return;

            let position: Point = { x: 0, y: 0 };
            if (zone === 'battlefield') {
              // Posição padrão no battlefield
              position = { x: 100, y: 100 };
            } else if (zone === 'hand') {
              // Para hand, usar posição { x: 0, y: 0 } - será reordenada automaticamente
              position = { x: 0, y: 0 };
            } else if (zone === 'cemetery') {
              const cemeteryPos = getCemeteryPosition(playerName);
              position = cemeteryPos || { x: 0, y: 0 };
            } else if (zone === 'library') {
              const libraryPos = getLibraryPosition(playerName);
              position = libraryPos || { x: 0, y: 0 };
            } else if (zone === 'exile') {
              const exilePos = getExilePosition(playerName);
              position = exilePos || { x: 0, y: 0 };
            }

            changeCardZone(cardId, zone, position, libraryPlace);
          }}
          ownerName={ownerName}
        />
      )}
    </>
  );
};

export default Exile;
