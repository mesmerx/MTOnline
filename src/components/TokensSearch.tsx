import type { CardOnBoard } from '../store/useGameStore';
import CardSearchBase from './CardSearchBase';

interface TokensSearchProps {
  tokensCards: CardOnBoard[];
  playerName: string;
  isOpen: boolean;
  onClose: () => void;
  onMoveCard: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery' | 'exile', libraryPlace?: 'top' | 'bottom' | 'random') => void;
  onAddCard: (card: CardOnBoard) => void;
  ownerName: (card: CardOnBoard) => string;
}

const TokensSearch = ({
  tokensCards,
  playerName,
  isOpen,
  onClose,
  onMoveCard,
  onAddCard,
  ownerName,
}: TokensSearchProps) => {
  return (
    <CardSearchBase
      cards={tokensCards}
      playerName={playerName}
      isOpen={isOpen}
      onClose={onClose}
      onMoveCard={onMoveCard}
      onAddCard={onAddCard}
      ownerName={ownerName}
      title="🔍 Search Token"
      placeholder="Enter the token name..."
      showAllWhenEmpty={true}
      sortCards={(cards) => {
        return [...cards].sort((a, b) => {
          return (b.stackIndex ?? 0) - (a.stackIndex ?? 0);
        });
      }}
      availableZones={[]}
      showAddButton={true}
      addButtonLabel="Add to battlefield"
      defaultMaxCards={0}
      ignoreMaxCardsLimit={true}
    />
  );
};

export default TokensSearch;

