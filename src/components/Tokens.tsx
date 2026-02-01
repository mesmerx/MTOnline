import { useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CardOnBoard } from '../store/useGameStore';
import CardToken from './CardToken';
import TokensSearch from './TokensSearch';
import { useGameStore } from '../store/useGameStore';

type Point = { x: number; y: number };

const TOKENS_CARD_WIDTH = 100;
const TOKENS_CARD_HEIGHT = 140;

interface TokensProps {
  boardRef: React.RefObject<HTMLDivElement | null>;
  playerName: string;
  tokensCards: CardOnBoard[];
  players: Array<{ id: string; name: string }>;
  getTokensPosition: (playerName: string) => Point | null;
  ownerName: (card: CardOnBoard) => string;
  onTokensContextMenu: (card: CardOnBoard, event: React.MouseEvent) => void;
  startTokensDrag: (playerName: string, event: ReactPointerEvent) => void;
  draggingTokens: { playerName: string; offsetX: number; offsetY: number; startX: number; startY: number } | null;
  handleCardZoom?: (card: CardOnBoard, event: ReactPointerEvent) => void;
  zoomedCard?: string | null;
  changeCardZone?: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery' | 'exile' | 'commander' | 'tokens', position: Point, libraryPlace?: 'top' | 'bottom' | 'random') => void;
  getLibraryPosition?: (playerName: string) => Point | null;
  getCemeteryPosition?: (playerName: string) => Point | null;
}

const Tokens = ({
  boardRef,
  playerName,
  tokensCards,
  players,
  getTokensPosition,
  ownerName,
  onTokensContextMenu,
  startTokensDrag,
  draggingTokens,
  handleCardZoom,
  changeCardZone,
  getLibraryPosition,
  getCemeteryPosition,
}: TokensProps) => {
  const [showTokensSearch, setShowTokensSearch] = useState(false);
  const addCardToBoard = useGameStore((state) => state.addCardToBoard);

  if (!boardRef.current || players.length === 0 || !playerName) return null;

  const tokensByOwner = players.map((player) => {
    const playerTokensCards = tokensCards.filter((c) => c.ownerId === player.name);
    const sortedTokensCards = [...playerTokensCards].sort((a, b) => (b.stackIndex ?? 0) - (a.stackIndex ?? 0));
    return { player, cards: sortedTokensCards };
  });

  return (
    <>
      {tokensByOwner.map(({ player, cards }) => {
        const tokensPos = getTokensPosition(player.name);
        if (!tokensPos) return null;

        return (
          <div
            key={player.name}
            style={{
              position: 'absolute',
              left: `${tokensPos.x}px`,
              top: `${tokensPos.y - 20}px`,
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
              {player.name} - Tokens
            </div>
            {player.name === playerName && changeCardZone && getCemeteryPosition && getLibraryPosition && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setShowTokensSearch(true);
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                style={{
                  position: 'absolute',
                  top: `${20 + TOKENS_CARD_HEIGHT + 5}px`,
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
                  width: `${TOKENS_CARD_WIDTH}px`,
                  textAlign: 'center',
                }}
                title="Search token and move to a zone"
                data-testid={`tokens-search-button-${player.name}`}
              >
                🔍 Search
              </button>
            )}
            <div
              className="tokens-stack"
              onPointerDown={(e) => {
                if (player.name !== playerName) return;
                startTokensDrag(player.name, e);
              }}
              style={{
                position: 'absolute',
                left: '0px',
                top: '20px',
                width: `${TOKENS_CARD_WIDTH}px`,
                height: `${TOKENS_CARD_HEIGHT}px`,
                cursor: player.name === playerName
                  ? draggingTokens && draggingTokens.playerName === player.name
                    ? 'grabbing'
                    : 'grab'
                  : 'default',
                pointerEvents: 'auto',
              }}
            >
              {cards.length > 0 ? (
                cards.slice(0, 5).map((card, index) => (
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
                      // For left-click, allow bubbling so the stack drag works.
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTokensContextMenu(card, e);
                    }}
                  >
                    <CardToken
                      card={card}
                      onPointerDown={() => {}}
                      onDoubleClick={() => {}}
                      ownerName={ownerName(card)}
                      width={TOKENS_CARD_WIDTH}
                      height={TOKENS_CARD_HEIGHT}
                      showBack={false}
                    />
                  </div>
                ))
              ) : (
                <div
                  style={{
                    position: 'absolute',
                    width: `${TOKENS_CARD_WIDTH}px`,
                    height: `${TOKENS_CARD_HEIGHT}px`,
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
                  <span style={{ color: 'rgba(148, 163, 184, 0.6)', fontSize: '16px' }}>🎟️</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {showTokensSearch && changeCardZone && (
        <TokensSearch
          tokensCards={tokensCards}
          playerName={playerName}
          isOpen={showTokensSearch}
          onClose={() => setShowTokensSearch(false)}
          onMoveCard={(cardId, zone, libraryPlace) => {
            if (!changeCardZone) return;
            let position: Point = { x: 0, y: 0 };
            if (zone === 'library') {
              const libraryPos = getLibraryPosition?.(playerName);
              position = libraryPos || { x: 0, y: 0 };
            } else if (zone === 'cemetery') {
              const cemeteryPos = getCemeteryPosition?.(playerName);
              position = cemeteryPos || { x: 0, y: 0 };
            }
            changeCardZone(cardId, zone, position, libraryPlace);
          }}
          onAddCard={(card) => {
            addCardToBoard({
              name: card.name,
              oracleText: card.oracleText,
              manaCost: card.manaCost,
              typeLine: card.typeLine,
              setName: card.setName,
              setCode: card.setCode,
              collectorNumber: card.collectorNumber,
              deckSection: 'tokens',
              imageUrl: card.imageUrl,
              backImageUrl: card.backImageUrl,
            });
          }}
          ownerName={ownerName}
        />
      )}
    </>
  );
};

export default Tokens;

