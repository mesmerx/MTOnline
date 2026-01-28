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
  // Se a carta tem a propriedade flipped, usar ela; caso contrário, usar showBack
  const shouldShowBack = card.flipped !== undefined ? card.flipped : showBack;
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

  const counters = card.counters ?? 0;

  if (shouldShowBack) {
    return (
      <div
        className={classNames('card-token', 'card-back')}
        style={{ width, height, touchAction: 'none', position: 'relative' }}
        onPointerDown={onPointerDown}
        onMouseDown={onMouseDown}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={onDoubleClick}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <img src={CARD_BACK_IMAGE} alt="Card back" draggable={false} />
        {counters > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              backgroundColor: 'rgba(220, 38, 38, 0.9)',
              color: 'white',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              fontWeight: 'bold',
              border: '2px solid white',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            {counters}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={classNames('card-token', { tapped: card.tapped })}
      style={{ width, height, touchAction: 'none', position: 'relative' }}
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
      {counters > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            backgroundColor: 'rgba(220, 38, 38, 0.9)',
            color: 'white',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            fontWeight: 'bold',
            border: '2px solid white',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          {counters}
        </div>
      )}
    </div>
  );
};

export default CardToken;

