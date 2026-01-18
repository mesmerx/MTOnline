import classNames from 'classnames';
import type { CardOnBoard } from '../store/useGameStore';

interface CardTokenProps {
  card: CardOnBoard;
  onPointerDown: (event: React.PointerEvent) => void;
  onMouseDown?: (event: React.MouseEvent) => void;
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
  onDoubleClick,
  onClick,
  onContextMenu,
  ownerName: _ownerName,
  width = 150,
  height = 210,
  showBack = false,
}: CardTokenProps) => {
  if (showBack) {
    return (
      <div
        className={classNames('card-token', 'card-back')}
        style={{ width, height }}
        onPointerDown={onPointerDown}
        onMouseDown={onMouseDown}
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
      style={{ width, height }}
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
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

