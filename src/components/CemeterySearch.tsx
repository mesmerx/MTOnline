import type { CardOnBoard } from '../store/useGameStore';
import CardSearchBase from './CardSearchBase';

interface CemeterySearchProps {
  cemeteryCards: CardOnBoard[];
  playerName: string;
  isOpen: boolean;
  onClose: () => void;
  onMoveCard: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery' | 'exile', libraryPlace?: 'top' | 'bottom' | 'random') => void;
  ownerName: (card: CardOnBoard) => string;
}

const CemeterySearch = ({
  cemeteryCards,
  playerName,
  isOpen,
  onClose,
  onMoveCard,
  ownerName,
}: CemeterySearchProps) => {
  return (
    <CardSearchBase
      cards={cemeteryCards}
      playerName={playerName}
      isOpen={isOpen}
      onClose={onClose}
      onMoveCard={onMoveCard}
      ownerName={ownerName}
      title="🔍 Search Card in Cemetery"
      placeholder="Enter the card name..."
      showAllWhenEmpty={true}
      sortCards={(cards) => {
        return [...cards].sort((a, b) => {
          return (b.stackIndex ?? 0) - (a.stackIndex ?? 0); // Ordem reversa (topo primeiro)
        });
      }}
      availableZones={['battlefield', 'library', 'hand', 'exile']}
      defaultMaxCards={0}
      ignoreMaxCardsLimit={true}
    />
  );
};

export default CemeterySearch;

