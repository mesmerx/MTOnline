import CardToken from './CardToken';
import CounterToken from './CounterToken';
import Hand from './Hand';
import Library from './Library';
import Cemetery from './Cemetery';
import Exile from './Exile';
import type { BoardViewProps } from './BoardTypes';
import { BASE_BOARD_WIDTH, BASE_BOARD_HEIGHT, CARD_WIDTH, CARD_HEIGHT } from './BoardTypes';

export const BoardSeparated = (props: BoardViewProps) => {
  const {
    boardRef,
    allPlayers,
    playerId,
    playerName,
    battlefieldCards,
    libraryCards,
    cemeteryCards,
    exileCards,
    storeLibraryPositions,
    storeCemeteryPositions,
    storeExilePositions,
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
    zoomedCard,
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
    counters,
    moveCounter,
    modifyCounter,
    removeCounterToken,
    getCemeteryPosition,
    getLibraryPosition,
    setLibraryContainerRef,
  } = props;

  if (!boardRef.current) return null;
  const rect = boardRef.current.getBoundingClientRect();
  const boardWidth = rect.width;
  const boardHeight = rect.height;
  const cols = Math.ceil(Math.sqrt(allPlayers.length));
  const rows = Math.ceil(allPlayers.length / cols);

  return (
    <>
      {allPlayers.map((player, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);

        // Calcular porcentagens para posicionamento
        const leftPercent = (col / cols) * 100;
        const topPercent = (row / rows) * 100;
        const widthPercent = 100 / cols;
        const heightPercent = 100 / rows;

        // Calcular tamanho real da janela baseado em porcentagens
        const windowWidth = (boardWidth * widthPercent) / 100;
        const windowHeight = (boardHeight * heightPercent) / 100;
        const availableWidth = windowWidth;
        const availableHeight = windowHeight;

        // Match individual view: scale by the min dimension and center both axes.
        const scale = Math.min(
          availableWidth / BASE_BOARD_WIDTH,
          availableHeight / BASE_BOARD_HEIGHT,
        );
        const playerAreaWidth = BASE_BOARD_WIDTH * scale;
        const playerAreaHeight = BASE_BOARD_HEIGHT * scale;
        const offsetX = (availableWidth - playerAreaWidth) / 2;
        const offsetY = (availableHeight - playerAreaHeight) / 2;

        const playerBattlefieldCards = battlefieldCards.filter(c => c.ownerId === player.name);
        const playerLibraryCards = libraryCards.filter(c => c.ownerId === player.name);
        const playerCemeteryCards = cemeteryCards.filter(c => c.ownerId === player.name);

        return (
          <div
            key={player.id}
            id={`player-window-${player.id}`}
            data-player-id={player.id}
            data-player-index={index}
            data-player-name={player.name}
            data-window-position={`col-${col}-row-${row}`}
            style={{
              position: 'absolute',
              left: `${leftPercent}%`,
              top: `${topPercent}%`,
              width: `${widthPercent}%`,
              height: `${heightPercent}%`,
              border: 'none',
              borderRadius: '0px',
              backgroundColor: 'transparent',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              id={`player-content-container-${player.id}`}
              data-player-id={player.id}
              data-element="player-content-container"
              style={{
                position: 'relative',
                width: '100%',
                flex: 1,
                minHeight: 0,
                overflow: 'visible',
              }}
            >
              <div
                id={`player-scaled-area-${player.id}`}
                data-player-id={player.id}
                data-element="player-scaled-area"
                data-area-width={playerAreaWidth}
                data-area-height={playerAreaHeight}
                data-scale={scale}
                style={{
                  position: 'absolute',
                  left: `${offsetX >= 0 ? (offsetX / availableWidth) * 100 : 0}%`,
                  top: `${offsetY >= 0 ? (offsetY / availableHeight) * 100 : 0}%`,
                  width: `${(playerAreaWidth / availableWidth) * 100}%`,
                  height: `${(playerAreaHeight / availableHeight) * 100}%`,
                  overflow: 'visible',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: '0',
                    top: '0',
                    width: `${BASE_BOARD_WIDTH}px`,
                    height: `${BASE_BOARD_HEIGHT}px`,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    overflow: 'visible',
                  }}
                >
                  <div
                    id={`player-area-${player.id}`}
                    data-player-id={player.id}
                    data-element="player-area"
                    className={`player-area ${player.id === playerId ? 'current-player' : ''}`}
                    style={{
                      position: 'absolute',
                      left: '0px',
                      top: '0px',
                      width: `${BASE_BOARD_WIDTH}px`,
                      height: `${BASE_BOARD_HEIGHT}px`,
                    }}
                  >
                    <div className="player-area-label">{player.name}</div>
                  </div>

                  <Library
                    boardRef={boardRef}
                    playerName={playerName}
                    libraryCards={playerLibraryCards}
                    players={[player]}
                    getPlayerArea={(ownerId) => {
                      if (ownerId === player.name) {
                        return {
                          x: 0,
                          y: 0,
                          width: BASE_BOARD_WIDTH,
                          height: BASE_BOARD_HEIGHT,
                        };
                      }
                      return null;
                    }}
                    getLibraryPosition={(name) => {
                      if (name !== player.name) {
                        return null;
                      }
                      const storePos = storeLibraryPositions[name];
                      if (storePos) {
                        // Usar posição do store diretamente (em pixels)
                        return {
                          x: storePos.x,
                          y: storePos.y,
                        };
                      }
                      // Posição padrão em pixels no espaço base
                      return {
                        x: 50,
                        y: BASE_BOARD_HEIGHT / 2 - 70,
                      };
                    }}
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
                    zoomedCard={zoomedCard}
                    changeCardZone={changeCardZone}
                    getCemeteryPosition={(playerName) => {
                      if (playerName !== player.name) {
                        return null;
                      }
                      const storePos = storeCemeteryPositions[playerName];
                      if (storePos) {
                        return {
                          x: storePos.x,
                          y: storePos.y,
                        };
                      }
                      return {
                        x: BASE_BOARD_WIDTH - 150,
                        y: BASE_BOARD_HEIGHT / 2 - 70,
                      };
                    }}
                    board={board}
                    reorderLibraryCard={props.reorderLibraryCard}
                    setLibraryContainerRef={setLibraryContainerRef}
                  />

                  <Cemetery
                    boardRef={boardRef}
                    playerName={playerName}
                    cemeteryCards={playerCemeteryCards}
                    players={[player]}
                    getCemeteryPosition={(playerName) => {
                      if (playerName !== player.name) {
                        return null;
                      }
                      const storePos = storeCemeteryPositions[playerName];
                      if (storePos) {
                        // Usar posição do store diretamente (em pixels)
                        return {
                          x: storePos.x,
                          y: storePos.y,
                        };
                      }
                      // Posição padrão em pixels no espaço base
                      return {
                        x: BASE_BOARD_WIDTH - 150,
                        y: BASE_BOARD_HEIGHT / 2 - 70,
                      };
                    }}
                    ownerName={ownerName}
                    changeCardZone={changeCardZone}
                    getLibraryPosition={getLibraryPosition}
                    board={board}
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
                    zoomedCard={zoomedCard}
                  />

                  {(() => {
                    const playerExileCards = exileCards.filter(c => c.ownerId === player.name);
                    return (
                      <Exile
                        boardRef={boardRef}
                        playerName={playerName}
                        exileCards={playerExileCards}
                        players={[player]}
                        getExilePosition={(playerName) => {
                          if (playerName !== player.name) {
                            return null;
                          }
                          const storePos = storeExilePositions[playerName];
                          if (storePos) {
                            return {
                              x: storePos.x,
                              y: storePos.y,
                            };
                          }
                          return {
                            x: BASE_BOARD_WIDTH - 150 - 120,
                            y: BASE_BOARD_HEIGHT / 2 - 70,
                          };
                        }}
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
                        zoomedCard={zoomedCard}
                        changeCardZone={changeCardZone}
                        getLibraryPosition={getLibraryPosition}
                        getCemeteryPosition={getCemeteryPosition}
                        board={board}
                      />
                    );
                  })()}

                  {playerBattlefieldCards.map((card) => {
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

                  {/* Renderizar contadores independentemente para este player */}
                  {counters
                    .filter((counter) => counter.ownerId === player.name)
                    .map((counter) => (
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

                  {showHand && player.id === playerId && (
                    <Hand
                      boardRef={boardRef}
                      playerName={playerName}
                      board={board}
                      players={[player]}
                      getPlayerArea={(ownerId) => {
                        if (ownerId === player.name) {
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
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
};
