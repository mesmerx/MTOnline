import CardToken from './CardToken';
import Hand from './Hand';
import Library from './Library';
import Cemetery from './Cemetery';
import type { BoardViewProps } from './BoardTypes';
import { BASE_BOARD_WIDTH, BASE_BOARD_HEIGHT, CARD_WIDTH, CARD_HEIGHT } from './BoardTypes';

interface BoardIndividualProps extends BoardViewProps {
  selectedPlayerIndex: number;
}

export const BoardIndividual = (props: BoardIndividualProps) => {
  const {
    boardRef,
    allPlayers,
    playerId,
    battlefieldCards,
    libraryCards,
    cemeteryCards,
    showHand,
    dragStateRef,
    draggingLibrary,
    draggingCemetery,
    ownerName,
    handleCardClick,
    handleCardContextMenu,
    startDrag,
    startLibraryDrag,
    startCemeteryDrag,
    changeCardZone,
    detectZoneAtPosition,
    reorderHandCard,
    dragStartedFromHandRef,
    handCardPlacedRef,
    setContextMenu,
    setLastTouchedCard,
    board,
    getLibraryPosition,
    getCemeteryPosition,
    selectedPlayerIndex,
  } = props;

  const selectedPlayer = allPlayers[selectedPlayerIndex];
  if (!selectedPlayer) return null;

  const selectedPlayerId = selectedPlayer.id;
  const filteredPlayers = [selectedPlayer];
  const filteredBattlefieldCards = battlefieldCards.filter(c => c.ownerId === selectedPlayerId);
  const filteredLibraryCards = libraryCards.filter(c => c.ownerId === selectedPlayerId);
  const filteredCemeteryCards = cemeteryCards.filter(c => c.ownerId === selectedPlayerId);

  return (
    <>
      <div
        className={`player-area ${selectedPlayerId === playerId ? 'current-player' : ''}`}
        style={{
          left: '0px',
          top: '0px',
          width: `${BASE_BOARD_WIDTH}px`,
          height: `${BASE_BOARD_HEIGHT}px`,
        }}
      >
        <div className="player-area-label">{selectedPlayer.name}</div>
      </div>

      <Library
        boardRef={boardRef}
        playerId={playerId}
        libraryCards={filteredLibraryCards}
        players={filteredPlayers}
        getPlayerArea={(id) => {
          if (id === selectedPlayerId) {
            return {
              x: 0,
              y: 0,
              width: BASE_BOARD_WIDTH,
              height: BASE_BOARD_HEIGHT,
            };
          }
          return null;
        }}
        getLibraryPosition={getLibraryPosition}
        ownerName={ownerName}
        onLibraryContextMenu={(card, e) => {
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            card,
          });
        }}
        startLibraryDrag={startLibraryDrag}
        draggingLibrary={draggingLibrary}
        startDrag={startDrag}
      />

      <Cemetery
        boardRef={boardRef}
        playerId={playerId}
        cemeteryCards={filteredCemeteryCards}
        players={filteredPlayers}
        getCemeteryPosition={getCemeteryPosition}
        ownerName={ownerName}
        onCemeteryContextMenu={(card, e) => {
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            card,
          });
        }}
        startDrag={startDrag}
        startCemeteryDrag={startCemeteryDrag}
        draggingCemetery={draggingCemetery}
      />

      {filteredBattlefieldCards.map((card) => {
        const isDragging = dragStateRef.current?.cardId === card.id;
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
              onPointerDown={(event) => {
                setLastTouchedCard(card);
                startDrag(card, event);
              }}
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

      {showHand && selectedPlayerId === playerId && (
        <Hand
          boardRef={boardRef}
          playerId={playerId}
          board={board}
          players={filteredPlayers}
          getPlayerArea={(id) => {
            if (id === selectedPlayerId) {
              return {
                x: 0,
                y: 0,
                width: BASE_BOARD_WIDTH,
                height: BASE_BOARD_HEIGHT,
              };
            }
            return null;
          }}
          handleCardClick={handleCardClick}
          handleCardContextMenu={handleCardContextMenu}
          startDrag={startDrag}
          ownerName={ownerName}
          changeCardZone={changeCardZone}
          detectZoneAtPosition={detectZoneAtPosition}
          reorderHandCard={reorderHandCard}
          dragStartedFromHandRef={dragStartedFromHandRef}
          handCardPlacedRef={handCardPlacedRef}
          setDragStartedFromHand={(value: boolean) => {
            dragStartedFromHandRef.current = value;
          }}
          clearBoardDrag={() => {
            dragStateRef.current = null;
            // setIsDragging é gerenciado no Board.tsx principal
          }}
        />
      )}
    </>
  );
};

