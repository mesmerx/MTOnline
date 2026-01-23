import CardToken from './CardToken';
import Hand from './Hand';
import Library from './Library';
import Cemetery from './Cemetery';
import type { BoardViewProps } from './BoardTypes';
import { BASE_BOARD_WIDTH, BASE_BOARD_HEIGHT, CARD_WIDTH, CARD_HEIGHT } from './BoardTypes';

export const BoardSeparated = (props: BoardViewProps) => {
  const {
    boardRef,
    allPlayers,
    playerId,
    battlefieldCards,
    libraryCards,
    cemeteryCards,
    storeLibraryPositions,
    storeCemeteryPositions,
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

        // Manter proporção 16:9 sempre usando 100% da largura disponível
        const aspectRatio = 16 / 9;
        
        // Sempre usar 100% da largura disponível e calcular altura para manter 16:9
        const playerAreaWidth = availableWidth;
        const playerAreaHeight = availableWidth / aspectRatio;
        
        // Centralizar verticalmente
        const offsetX = 0;
        const offsetY = (availableHeight - playerAreaHeight) / 2;

        // Calcular scale baseado na largura
        const scale = playerAreaWidth / BASE_BOARD_WIDTH;

        const playerBattlefieldCards = battlefieldCards.filter(c => c.ownerId === player.id);
        const playerLibraryCards = libraryCards.filter(c => c.ownerId === player.id);
        const playerCemeteryCards = cemeteryCards.filter(c => c.ownerId === player.id);

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
                    playerId={playerId}
                    libraryCards={playerLibraryCards}
                    players={[player]}
                    getPlayerArea={(id) => {
                      if (id === player.id) {
                        return {
                          x: 0,
                          y: 0,
                          width: BASE_BOARD_WIDTH,
                          height: BASE_BOARD_HEIGHT,
                        };
                      }
                      return null;
                    }}
                    getLibraryPosition={(id) => {
                      if (id !== player.id) {
                        return null;
                      }
                      const storePos = storeLibraryPositions[id];
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
                  />

                  <Cemetery
                    boardRef={boardRef}
                    playerId={playerId}
                    cemeteryCards={playerCemeteryCards}
                    players={[player]}
                    getCemeteryPosition={(id) => {
                      if (id !== player.id) {
                        return null;
                      }
                      const storePos = storeCemeteryPositions[id];
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

                  {showHand && player.id === playerId && (
                    <Hand
                      boardRef={boardRef}
                      playerId={playerId}
                      board={board}
                      players={[player]}
                      getPlayerArea={(id) => {
                        if (id === player.id) {
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
                      viewMode={props.viewMode}
                      convertMouseToSeparatedCoordinates={props.convertMouseToSeparatedCoordinates}
                      convertMouseToUnifiedCoordinates={props.convertMouseToUnifiedCoordinates}
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

