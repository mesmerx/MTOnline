import CardToken from './CardToken';
import CounterToken from './CounterToken';
import Hand from './Hand';
import Library from './Library';
import Cemetery from './Cemetery';
import Exile from './Exile';
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
    playerName,
    battlefieldCards,
    libraryCards,
    cemeteryCards,
    exileCards,
    showHand,
    dragStateRef,
    draggingLibrary,
    draggingCemetery,
    draggingExile,
    ownerName,
    handleCardClick,
    handleCardContextMenu,
    handleCardZoom,
    startDrag,
    startLibraryDrag,
    startCemeteryDrag,
    startExileDrag,
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
    getExilePosition,
    setLibraryContainerRef,
    selectedPlayerIndex,
    counters,
    moveCounter,
    modifyCounter,
    removeCounterToken,
  } = props;

  const selectedPlayer = allPlayers[selectedPlayerIndex];
  if (!selectedPlayer) return null;

  const selectedPlayerName = selectedPlayer.name;
  const selectedPlayerId = selectedPlayer.id;
  const filteredPlayers = [selectedPlayer];
  const filteredBattlefieldCards = battlefieldCards.filter(c => c.ownerId === selectedPlayerName);
  const filteredLibraryCards = libraryCards.filter(c => c.ownerId === selectedPlayerName);
  const filteredCemeteryCards = cemeteryCards.filter(c => c.ownerId === selectedPlayerName);
  const filteredExileCards = exileCards.filter(c => c.ownerId === selectedPlayerName);

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
        playerName={playerName}
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
        handleCardZoom={handleCardZoom}
        zoomedCard={props.zoomedCard}
        changeCardZone={changeCardZone}
        getCemeteryPosition={getCemeteryPosition}
        board={board}
        reorderLibraryCard={props.reorderLibraryCard}
        setLibraryContainerRef={setLibraryContainerRef}
      />

      <Cemetery
        boardRef={boardRef}
        playerName={playerName}
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
        handleCardZoom={handleCardZoom}
          zoomedCard={props.zoomedCard}
        changeCardZone={changeCardZone}
        getLibraryPosition={getLibraryPosition}
        board={board}
      />

      <Exile
        boardRef={boardRef}
        playerName={playerName}
        exileCards={filteredExileCards}
        players={filteredPlayers}
        getExilePosition={getExilePosition}
        ownerName={ownerName}
        onExileContextMenu={(card, e) => {
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            card,
          });
        }}
        startDrag={startDrag}
        startExileDrag={startExileDrag}
        draggingExile={draggingExile}
        handleCardZoom={handleCardZoom}
          zoomedCard={props.zoomedCard}
        changeCardZone={changeCardZone}
        getLibraryPosition={getLibraryPosition}
        getCemeteryPosition={getCemeteryPosition}
        board={board}
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
                handleCardZoom(card, event);
                startDrag(card, event);
              }}
              onClick={(event) => handleCardClick(card, event)}
              onContextMenu={(event) => handleCardContextMenu(card, event)}
              ownerName={ownerName(card)}
              width={CARD_WIDTH}
              height={CARD_HEIGHT}
              showBack={false}
            />
            {/* Botão de flip embaixo da carta (apenas se tiver backImageUrl) */}
            {card.backImageUrl && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  props.flipCard(card.id);
                }}
                style={{
                  position: 'absolute',
                  bottom: '-24px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '40px',
                  height: '32px',
                  padding: '4px 6px',
                  backgroundColor: 'rgba(15, 23, 42, 0.9)',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  borderRadius: '4px',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  fontSize: '18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 2,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(15, 23, 42, 0.9)';
                }}
                title="Transform"
              >
                🔄
              </button>
            )}
          </div>
        );
      })}

      {/* Renderizar todos os contadores independentemente */}
      {counters.map((counter) => (
        <CounterToken
          key={counter.id}
          counter={counter}
          isCurrentPlayer={counter.ownerId === playerName}
          onMove={moveCounter}
          onModify={modifyCounter}
          onRemove={removeCounterToken}
          boardRef={boardRef}
          viewMode={props.viewMode}
          convertMouseToSeparatedCoordinates={props.convertMouseToSeparatedCoordinates}
          convertMouseToUnifiedCoordinates={props.convertMouseToUnifiedCoordinates}
        />
      ))}

      {showHand && selectedPlayerId === playerId && (
        <Hand
          boardRef={boardRef}
          playerName={playerName}
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
          setLastTouchedCard={setLastTouchedCard}
          handDragStateRef={props.handDragStateRef}
          addEventLog={props.addEventLog}
          viewMode={props.viewMode}
          convertMouseToSeparatedCoordinates={props.convertMouseToSeparatedCoordinates}
          convertMouseToUnifiedCoordinates={props.convertMouseToUnifiedCoordinates}
          counters={counters}
          moveCounter={moveCounter}
          modifyCounter={modifyCounter}
          removeCounterToken={removeCounterToken}
          getCemeteryPosition={getCemeteryPosition}
          getLibraryPosition={getLibraryPosition}
        />
      )}
    </>
  );
};

