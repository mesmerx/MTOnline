import classNames from 'classnames';
import { memo } from 'react';
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
  isSelected?: boolean;
  ownerName?: string;
  width?: number;
  height?: number;
  showBack?: boolean; // Para outros casos: mostrar verso genérico se não tiver imagem
  forceShowFront?: boolean; // Forçar mostrar a frente mesmo se for library
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
  isSelected = false,
  ownerName: _ownerName,
  width = 150,
  height = 210,
  showBack = false,
  forceShowFront = false,
}: CardTokenProps) => {
  // No library, sempre mostrar o verso genérico (magic_card_back), exceto se forceShowFront for true
  // No board/hand, mostrar o verso se flipped === true e backImageUrl existir
  const isLibrary = card.zone === 'library';
  const shouldShowBack = forceShowFront ? false : (isLibrary ? true : (!!card.flipped && !!card.backImageUrl));
  const imageToShow = shouldShowBack && card.backImageUrl ? card.backImageUrl : card.imageUrl;
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

  // Se for library e não forçar mostrar frente, sempre mostrar o verso genérico
  if (isLibrary && !forceShowFront) {
    return (
      <div
        className={classNames('card-token', 'card-back', { selected: isSelected })}
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
      </div>
    );
  }

  // Se showBack é true (para outros casos), mostrar o verso genérico se não tiver imagem
  if (showBack && !imageToShow) {
    return (
      <div
        className={classNames('card-token', 'card-back', { selected: isSelected })}
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
      </div>
    );
  }

  return (
    <div
      className={classNames('card-token', { tapped: card.tapped, selected: isSelected })}
      style={{ width, height, touchAction: 'none', position: 'relative' }}
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={onDoubleClick}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {imageToShow ? (
        <img src={imageToShow} alt={card.name} draggable={false} />
      ) : (
        <div className="card-placeholder">
          <span>{card.name}</span>
        </div>
      )}
    </div>
  );
};

export default memo(CardToken);

