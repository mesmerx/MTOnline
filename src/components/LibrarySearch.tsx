import type { CardOnBoard } from '../store/useGameStore';
import CardSearchBase from './CardSearchBase';

interface LibrarySearchProps {
  libraryCards: CardOnBoard[];
  playerName: string;
  isOpen: boolean;
  onClose: () => void;
  onMoveCard: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery' | 'exile', libraryPlace?: 'top' | 'bottom' | 'random') => void;
  ownerName: (card: CardOnBoard) => string;
  reorderLibraryCard?: (cardId: string, newIndex: number) => void;
}

const LibrarySearch = ({
  libraryCards,
  playerName,
  isOpen,
  onClose,
  onMoveCard,
  ownerName,
  reorderLibraryCard,
}: LibrarySearchProps) => {
  return (
    <CardSearchBase
      cards={libraryCards}
      playerName={playerName}
      isOpen={isOpen}
      onClose={onClose}
      onMoveCard={onMoveCard}
      ownerName={ownerName}
      title="🔍 Buscar Carta no Deck"
      placeholder="Digite o nome da carta..."
      showAllWhenEmpty={true}
      sortCards={(cards) => {
        return [...cards].sort((a, b) => {
          return (b.stackIndex ?? 0) - (a.stackIndex ?? 0); // Ordem reversa para library (topo primeiro)
        });
      }}
      onReorder={reorderLibraryCard}
      availableZones={['battlefield', 'hand', 'cemetery', 'exile']}
      showMaxCardsInput={true}
      defaultMaxCards={0}
    />
  );
};

export default LibrarySearch;

