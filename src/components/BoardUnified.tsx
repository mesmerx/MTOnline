import CardToken from './CardToken';
import Hand from './Hand';
import Library from './Library';
import Cemetery from './Cemetery';
import type { BoardViewProps } from './BoardTypes';
import { CARD_WIDTH, CARD_HEIGHT } from './BoardTypes';

export const BoardUnified = (props: BoardViewProps) => {
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
    getPlayerArea,
    getLibraryPosition,
    getCemeteryPosition,
  } = props;

  return (
    <>
      {allPlayers.length > 0 && allPlayers.map((player) => {
        const area = getPlayerArea(player.id);
        if (!area) return null;
        const isCurrentPlayer = player.id === playerId;

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
          </div>
        );
      })}

      <Library
        boardRef={boardRef}
        playerId={playerId}
        libraryCards={libraryCards}
        players={allPlayers}
        getPlayerArea={getPlayerArea}
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
        cemeteryCards={cemeteryCards}
        players={allPlayers}
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

      {battlefieldCards.map((card) => {
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

      {showHand && (
        <Hand
          boardRef={boardRef}
          playerId={playerId}
          board={board}
          players={allPlayers}
          getPlayerArea={getPlayerArea}
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

