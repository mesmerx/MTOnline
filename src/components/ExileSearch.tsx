import type { CardOnBoard } from '../store/useGameStore';
import CardSearchBase from './CardSearchBase';

interface ExileSearchProps {
  exileCards: CardOnBoard[];
  playerName: string;
  isOpen: boolean;
  onClose: () => void;
  onMoveCard: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery' | 'exile', libraryPlace?: 'top' | 'bottom' | 'random') => void;
  ownerName: (card: CardOnBoard) => string;
}

const ExileSearch = ({
  exileCards,
  playerName,
  isOpen,
  onClose,
  onMoveCard,
  ownerName,
}: ExileSearchProps) => {
  return (
    <CardSearchBase
      cards={exileCards}
      playerName={playerName}
      isOpen={isOpen}
      onClose={onClose}
      onMoveCard={onMoveCard}
      ownerName={ownerName}
      title="🔍 Search Card in Exile"
      placeholder="Enter the card name..."
      showAllWhenEmpty={true}
      sortCards={(cards) => {
        return [...cards].sort((a, b) => {
          return (b.stackIndex ?? 0) - (a.stackIndex ?? 0); // Ordem reversa (topo primeiro)
        });
      }}
      availableZones={['battlefield', 'library', 'hand', 'cemetery']}
      defaultMaxCards={0}
      ignoreMaxCardsLimit={true}
    />
  );
};

export default ExileSearch;

