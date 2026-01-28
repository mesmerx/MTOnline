import { useState, useMemo } from 'react';
import type { CardOnBoard } from '../store/useGameStore';
import CardToken from './CardToken';

interface LibrarySearchProps {
  libraryCards: CardOnBoard[];
  playerId: string;
  isOpen: boolean;
  onClose: () => void;
  onMoveCard: (cardId: string, zone: 'battlefield' | 'hand' | 'cemetery') => void;
  ownerName: (card: CardOnBoard) => string;
}

const LibrarySearch = ({
  libraryCards,
  playerId,
  isOpen,
  onClose,
  onMoveCard,
  ownerName,
}: LibrarySearchProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCard, setSelectedCard] = useState<CardOnBoard | null>(null);
  const [showZoneMenu, setShowZoneMenu] = useState(false);

  // Filtrar cartas do jogador atual e buscar por nome
  const filteredCards = useMemo(() => {
    if (!searchQuery.trim()) return [];
    
    const playerCards = libraryCards.filter((c) => c.ownerId === playerId);
    const query = searchQuery.toLowerCase().trim();
    
    return playerCards.filter((card) =>
      card.name.toLowerCase().includes(query)
    );
  }, [libraryCards, playerId, searchQuery]);

  const handleCardSelect = (card: CardOnBoard) => {
    setSelectedCard(card);
    setShowZoneMenu(true);
  };

  const handleMoveToZone = (zone: 'battlefield' | 'hand' | 'cemetery') => {
    if (!selectedCard) return;
    
    onMoveCard(selectedCard.id, zone);
    setSelectedCard(null);
    setShowZoneMenu(false);
    setSearchQuery('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        style={{
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid rgba(148, 163, 184, 0.3)',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '800px',
          width: '90%',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ color: '#f8fafc', margin: 0, fontSize: '20px', fontWeight: 'bold' }}>
            🔍 Buscar Carta no Deck
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#f8fafc',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        <input
          type="text"
          placeholder="Digite o nome da carta..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '16px',
            backgroundColor: 'rgba(30, 41, 59, 0.8)',
            border: '1px solid rgba(148, 163, 184, 0.3)',
            borderRadius: '8px',
            color: '#f8fafc',
            marginBottom: '16px',
          }}
          autoFocus
        />

        {searchQuery.trim() && (
          <div style={{ flex: 1, overflowY: 'auto', minHeight: '200px' }}>
            {filteredCards.length === 0 ? (
              <div style={{ color: '#94a3b8', textAlign: 'center', padding: '40px' }}>
                Nenhuma carta encontrada
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: '12px',
                }}
              >
                {filteredCards.map((card) => (
                  <div
                    key={card.id}
                    style={{
                      cursor: 'pointer',
                      transition: 'transform 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                    onClick={() => handleCardSelect(card)}
                  >
                    <CardToken
                      card={card}
                      onPointerDown={() => {}}
                      onClick={() => {}}
                      onContextMenu={() => {}}
                      ownerName={ownerName(card)}
                      width={120}
                      height={168}
                      showBack={false}
                    />
                    <div
                      style={{
                        marginTop: '4px',
                        fontSize: '12px',
                        color: '#f8fafc',
                        textAlign: 'center',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {card.name}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showZoneMenu && selectedCard && (
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: 'rgba(15, 23, 42, 0.98)',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              borderRadius: '12px',
              padding: '24px',
              zIndex: 10002,
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.7)',
            }}
          >
            <h3 style={{ color: '#f8fafc', marginTop: 0, marginBottom: '16px' }}>
              Mover "{selectedCard.name}" para:
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                onClick={() => handleMoveToZone('battlefield')}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#475569',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#64748b';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#475569';
                }}
              >
                🎯 Battlefield
              </button>
              <button
                onClick={() => handleMoveToZone('hand')}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#475569',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#64748b';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#475569';
                }}
              >
                🎴 Hand
              </button>
              <button
                onClick={() => handleMoveToZone('cemetery')}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#475569',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#64748b';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#475569';
                }}
              >
                ⚰️ Cemetery
              </button>
              <button
                onClick={() => {
                  setSelectedCard(null);
                  setShowZoneMenu(false);
                }}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginTop: '8px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#ef4444';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#dc2626';
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LibrarySearch;

