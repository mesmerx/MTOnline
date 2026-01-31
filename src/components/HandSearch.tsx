import type { CardOnBoard } from '../store/useGameStore';
import CardSearchBase from './CardSearchBase';

interface HandSearchProps {
  handCards: CardOnBoard[];
  playerName: string;
  isOpen: boolean;
  onClose: () => void;
  onMoveCard: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery' | 'exile', libraryPlace?: 'top' | 'bottom' | 'random') => void;
  ownerName: (card: CardOnBoard) => string;
  reorderHandCard?: (cardId: string, newIndex: number) => void;
}

const HandSearch = ({
  handCards,
  playerName,
  isOpen,
  onClose,
  onMoveCard,
  ownerName,
  reorderHandCard,
}: HandSearchProps) => {
  return (
    <CardSearchBase
      cards={handCards}
      playerName={playerName}
      isOpen={isOpen}
      onClose={onClose}
      onMoveCard={onMoveCard}
      ownerName={ownerName}
      title="🔍 Search Card in Hand"
      placeholder="Enter the card name..."
      showAllWhenEmpty={true}
      sortCards={(cards) => {
        return [...cards].sort((a, b) => {
          const indexA = a.handIndex ?? 0;
          const indexB = b.handIndex ?? 0;
          return indexA - indexB;
        });
      }}
      onReorder={reorderHandCard}
      availableZones={['battlefield', 'library', 'cemetery', 'exile']}
      defaultMaxCards={0}
      ignoreMaxCardsLimit={true}
    />
  );
};

export default HandSearch;

