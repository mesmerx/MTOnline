import classNames from 'classnames';
import type { CardOnBoard } from '../store/useGameStore';

interface CardTokenProps {
  card: CardOnBoard;
  onPointerDown: (event: React.PointerEvent) => void;
  onMouseDown?: (event: React.MouseEvent) => void;
  onTouchStart?: (event: React.TouchEvent) => void;
  onTouchEnd?: (event: React.TouchEvent) => void;
  onDoubleClick?: (event: React.MouseEvent) => void;
  onClick?: (event: React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  ownerName?: string;
  width?: number;
  height?: number;
  showBack?: boolean;
}

const CARD_BACK_IMAGE = '/Magic_card_back.webp';

const CardToken = ({
  card,
  onPointerDown,
  onMouseDown,
  onTouchStart,
  onTouchEnd,
  onDoubleClick,
  onClick,
  onContextMenu,
  ownerName: _ownerName,
  width = 150,
  height = 210,
  showBack = false,
}: CardTokenProps) => {
  // Converter touch events para pointer events para compatibilidade
  const handleTouchStart = (e: React.TouchEvent) => {
    if (onTouchStart) {
      onTouchStart(e);
    } else if (onPointerDown) {
      // Criar um evento pointer sintético a partir do touch
      const touch = e.touches[0];
      if (touch) {
        const syntheticEvent = {
          ...e,
          clientX: touch.clientX,
          clientY: touch.clientY,
          button: 0,
          pointerType: 'touch',
        } as unknown as React.PointerEvent;
        onPointerDown(syntheticEvent);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (onTouchEnd) {
      onTouchEnd(e);
    } else if (onClick) {
      // Converter touch end em click para tap
      const touch = e.changedTouches[0];
      if (touch) {
        const syntheticEvent = {
          ...e,
          clientX: touch.clientX,
          clientY: touch.clientY,
          button: 0,
        } as unknown as React.MouseEvent;
        onClick(syntheticEvent);
      }
    }
  };

  if (showBack) {
    return (
      <div
        className={classNames('card-token', 'card-back')}
        style={{ width, height, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onMouseDown={onMouseDown}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={onDoubleClick}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <img src={CARD_BACK_IMAGE} alt="Card back" draggable={false} />
      </div>
    );
  }

  return (
    <div
      className={classNames('card-token', { tapped: card.tapped })}
      style={{ width, height, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={onDoubleClick}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {card.imageUrl ? (
        <img src={card.imageUrl} alt={card.name} draggable={false} />
      ) : (
        <div className="card-placeholder">
          <span>{card.name}</span>
        </div>
      )}
    </div>
  );
};

export default CardToken;

