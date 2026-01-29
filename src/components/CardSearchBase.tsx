import { useState, useMemo, useRef, useEffect } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CardOnBoard } from '../store/useGameStore';
import { useGameStore } from '../store/useGameStore';
import CardToken from './CardToken';

interface CardSearchBaseProps {
  cards: CardOnBoard[];
  playerName: string;
  isOpen: boolean;
  onClose: () => void;
  onMoveCard: (cardId: string, zone: 'battlefield' | 'library' | 'hand' | 'cemetery', libraryPlace?: 'top' | 'bottom' | 'random') => void;
  ownerName: (card: CardOnBoard) => string;
  title: string;
  placeholder?: string;
  showAllWhenEmpty?: boolean;
  sortCards?: (cards: CardOnBoard[]) => CardOnBoard[];
  onReorder?: (cardId: string, newIndex: number) => void;
  availableZones?: ('battlefield' | 'library' | 'hand' | 'cemetery')[];
  showMaxCardsInput?: boolean; // Controla se mostra o input de quantidade máxima
  defaultMaxCards?: number | null; // Valor padrão para maxCardsToShow (null = todas, 0 = nenhuma, número = esse número)
  ignoreMaxCardsLimit?: boolean; // Se true, sempre mostra todas as cartas, ignorando maxCardsToShow
}

const CardSearchBase = ({
  cards,
  playerName,
  isOpen,
  onClose,
  onMoveCard,
  ownerName,
  title,
  placeholder = 'Digite o nome da carta...',
  showAllWhenEmpty = false,
  sortCards,
  onReorder,
  availableZones = ['battlefield', 'hand', 'cemetery'],
  showMaxCardsInput = false,
  defaultMaxCards = null,
  ignoreMaxCardsLimit = false,
}: CardSearchBaseProps) => {
  const flipCard = useGameStore((state) => state.flipCard);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCard, setSelectedCard] = useState<CardOnBoard | null>(null);
  const [showZoneMenu, setShowZoneMenu] = useState(false);
  const [showPlacementMenu, setShowPlacementMenu] = useState(false);
  const [pendingZone, setPendingZone] = useState<'library' | 'cemetery' | null>(null);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [zoomedCard, setZoomedCard] = useState<string | null>(null);
  // Inicializar com 0 se showMaxCardsInput for true, senão usar defaultMaxCards
  const [maxCardsToShow, setMaxCardsToShow] = useState<number | null>(
    showMaxCardsInput ? 0 : defaultMaxCards
  ); // null = mostrar todas, 0 = mostrar 0, número > 0 = mostrar esse número
  const containerRef = useRef<HTMLDivElement>(null);

  // Quando o modal abrir e showMaxCardsInput for true, resetar para 0 antes de renderizar
  // Quando o modal fechar, também resetar para 0 para evitar piscar cartas na próxima abertura
  useEffect(() => {
    if (showMaxCardsInput) {
      if (isOpen) {
        setMaxCardsToShow(0);
      } else {
        // Quando fechar, resetar para 0
        setMaxCardsToShow(0);
      }
    }
  }, [isOpen, showMaxCardsInput]);

  // Filtrar cartas do jogador atual e buscar por nome
  const filteredCards = useMemo(() => {
    // ownerId das cartas é o nome do player, não o ID
    const playerCards = cards.filter((c) => c.ownerId === playerName);
    
    // Ordenar se função de ordenação fornecida
    const sortedCards = sortCards ? sortCards([...playerCards]) : playerCards;
    
    // Se não há query e showAllWhenEmpty é true, mostrar todas as cartas
    let result: CardOnBoard[];
    const hasSearchQuery = !!searchQuery.trim();
    
    if (!hasSearchQuery) {
      result = showAllWhenEmpty ? sortedCards : [];
    } else {
      // Se há query, filtrar por nome
      const query = searchQuery.toLowerCase().trim();
      result = sortedCards.filter((card) =>
        card.name.toLowerCase().includes(query)
      );
    }
    
    // Se há texto na busca, sempre mostrar todas as cartas que correspondem (ignorar maxCardsToShow)
    if (hasSearchQuery) {
      return result;
    }
    
    // Aplicar limite de cartas a mostrar apenas quando não há busca
    // Se ignoreMaxCardsLimit for true, sempre mostrar todas
    if (ignoreMaxCardsLimit) {
      return result;
    }
    
    // null = mostrar todas, 0 = mostrar 0, número > 0 = mostrar esse número
    if (maxCardsToShow === null) {
      return result; // Mostrar todas quando null
    }
    if (maxCardsToShow === 0) {
      return []; // Mostrar 0 quando 0
    }
    return result.slice(0, maxCardsToShow);
  }, [cards, playerName, searchQuery, showAllWhenEmpty, sortCards, maxCardsToShow, ignoreMaxCardsLimit]);

  const handleCardSelect = (card: CardOnBoard) => {
    console.log('[CardSearchBase] handleCardSelect chamado:', {
      cardId: card.id,
      cardName: card.name,
      draggedCardId,
      searchQuery,
    });
    setSelectedCard(card);
    setShowZoneMenu(true);
    console.log('[CardSearchBase] Menu deve estar visível agora');
  };

  const handleMoveToZone = (zone: 'battlefield' | 'library' | 'hand' | 'cemetery') => {
    console.log('[CardSearchBase] handleMoveToZone chamado:', {
      zone,
      selectedCard: selectedCard?.id,
      selectedCardName: selectedCard?.name,
    });
    if (!selectedCard) {
      console.log('[CardSearchBase] handleMoveToZone: selectedCard é null, retornando');
      return;
    }
    
    // Se for library ou cemetery, mostrar menu de posicionamento
    if (zone === 'library' || zone === 'cemetery') {
      setPendingZone(zone);
      setShowZoneMenu(false);
      setShowPlacementMenu(true);
      return;
    }
    
    // Para outras zonas, mover diretamente
    console.log('[CardSearchBase] Chamando onMoveCard:', selectedCard.id, zone);
    onMoveCard(selectedCard.id, zone);
    setSelectedCard(null);
    setShowZoneMenu(false);
    setSearchQuery('');
    onClose();
  };

  const handlePlacementChoice = (placement: 'top' | 'bottom' | 'random') => {
    console.log('[CardSearchBase] handlePlacementChoice chamado:', {
      placement,
      pendingZone,
      selectedCard: selectedCard?.id,
    });
    if (!selectedCard || !pendingZone) {
      console.log('[CardSearchBase] handlePlacementChoice: selectedCard ou pendingZone é null');
      return;
    }
    
    // Converter 'top' para 'top', 'bottom' para 'bottom', 'random' para 'random'
    // Para cemetery, 'top' significa topo (última carta), 'bottom' significa fundo (primeira carta)
    // Para library, 'top' significa topo (última carta), 'bottom' significa fundo (primeira carta)
    const libraryPlace: 'top' | 'bottom' | 'random' = placement;
    
    console.log('[CardSearchBase] Chamando onMoveCard com placement:', selectedCard.id, pendingZone, libraryPlace);
    onMoveCard(selectedCard.id, pendingZone, libraryPlace);
    setSelectedCard(null);
    setShowZoneMenu(false);
    setShowPlacementMenu(false);
    setPendingZone(null);
    setSearchQuery('');
    onClose();
  };

  const handleDragStart = (cardId: string, event: ReactPointerEvent) => {
    // Só permitir reorganização se não houver texto na busca
    if (onReorder && !searchQuery.trim()) {
      event.stopPropagation();
      setDraggedCardId(cardId);
      setSelectedCard(null);
      setShowZoneMenu(false);
    } else {
      // Se houver texto na busca, prevenir o drag mas não bloquear o clique
      event.preventDefault();
      // Não fazer stopPropagation para permitir que o onClick do div pai funcione
    }
  };

  const handleDragOver = (index: number, event: React.DragEvent) => {
    event.preventDefault();
    if (draggedCardId !== null && onReorder) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (targetIndex: number) => {
    if (draggedCardId === null || !onReorder) return;
    
    const draggedIndex = filteredCards.findIndex((c) => c.id === draggedCardId);
    if (draggedIndex === -1 || draggedIndex === targetIndex) {
      setDraggedCardId(null);
      setDragOverIndex(null);
      return;
    }

    // Calcular o novo índice
    const draggedCard = filteredCards[draggedIndex];
    const targetCard = filteredCards[targetIndex];
    
    if (draggedCard && targetCard) {
      // Para hand, usar handIndex; para library, usar stackIndex
      const newIndex = targetCard.handIndex ?? targetCard.stackIndex ?? targetIndex;
      onReorder(draggedCardId, newIndex);
    }

    setDraggedCardId(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedCardId(null);
    setDragOverIndex(null);
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
            {title}
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
              borderRadius: '4px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder={placeholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              padding: '12px 16px',
              fontSize: '16px',
              backgroundColor: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              borderRadius: '8px',
              color: '#f8fafc',
              outline: 'none',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onClose();
              }
            }}
            autoFocus
          />
          {showMaxCardsInput && (
            <input
              type="number"
              min="0"
              value={maxCardsToShow ?? 0}
              onChange={(e) => {
                const value = e.target.value.trim();
                if (value === '') {
                  setMaxCardsToShow(0); // Campo vazio = 0
                } else {
                  const numValue = parseInt(value, 10);
                  setMaxCardsToShow(isNaN(numValue) ? 0 : Math.max(0, numValue));
                }
              }}
              placeholder="0"
              style={{
                width: '80px',
                padding: '12px 8px',
                fontSize: '14px',
                backgroundColor: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                borderRadius: '8px',
                color: '#f8fafc',
                outline: 'none',
              }}
              title="Quantas cartas mostrar (vazio = todas, 0 = nenhuma, número = esse número)"
            />
          )}
        </div>

        {filteredCards.length > 0 ? (
          <div style={{ position: 'relative' }}>
            {/* Seta indicativa da direção (esquerda → direita) */}
            <div
              style={{
                position: 'absolute',
                top: '8px',
                left: '8px',
                color: '#94a3b8',
                fontSize: '14px',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                zIndex: 10,
                pointerEvents: 'none',
              }}
            >
              <span>Ordem</span>
              <span>→</span>
            </div>
            <div
              ref={containerRef}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 150px)',
                gap: '12px',
                overflowY: 'auto',
                maxHeight: 'calc(80vh - 200px)',
                padding: '8px',
                paddingTop: '32px',
                justifyContent: 'start',
              }}
            >
            {filteredCards.map((card, index) => {
              const canReorder = onReorder && !searchQuery.trim();
              return (
              <div
                key={card.id}
                draggable={canReorder}
                onDragStart={(e) => {
                  console.log('[CardSearchBase] onDragStart:', {
                    cardId: card.id,
                    canReorder,
                    searchQuery,
                  });
                  if (canReorder) {
                    handleDragStart(card.id, e as any);
                    e.dataTransfer.effectAllowed = 'move';
                  } else {
                    e.preventDefault();
                  }
                }}
                onDragOver={(e) => {
                  if (canReorder && draggedCardId) {
                    handleDragOver(index, e);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (canReorder) {
                    handleDrop(index);
                  }
                }}
                onDragEnd={() => {
                  handleDragEnd();
                  // Limpar draggedCardId imediatamente após o drag terminar
                  setDraggedCardId(null);
                  setDragOverIndex(null);
                }}
                onClick={(e) => {
                  console.log('[CardSearchBase] onClick no div pai:', {
                    cardId: card.id,
                    cardName: card.name,
                    draggedCardId,
                    canReorder,
                    searchQuery,
                  });
                  // Só abrir menu se não estiver arrastando
                  // Se canReorder é true mas não há draggedCardId, significa que foi apenas um clique
                  if (!draggedCardId) {
                    e.stopPropagation();
                    console.log('[CardSearchBase] Chamando handleCardSelect do div pai');
                    handleCardSelect(card);
                  } else {
                    console.log('[CardSearchBase] Bloqueado: draggedCardId existe');
                  }
                }}
                style={{
                  position: 'relative',
                  cursor: draggedCardId === card.id ? 'grabbing' : canReorder ? 'grab' : 'pointer',
                  borderRadius: '8px',
                  overflow: 'visible',
                  border: selectedCard?.id === card.id 
                    ? '2px solid #6366f1' 
                    : dragOverIndex === index && draggedCardId !== card.id
                    ? '2px solid #10b981'
                    : draggedCardId === card.id
                    ? '2px solid #6366f1'
                    : '2px solid transparent',
                  transition: 'border-color 0.2s',
                  opacity: draggedCardId === card.id ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (selectedCard?.id !== card.id && !draggedCardId) {
                    e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.5)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedCard?.id !== card.id && dragOverIndex !== index) {
                    e.currentTarget.style.borderColor = 'transparent';
                  }
                }}
              >
                <CardToken
                  card={card}
                  onPointerDown={(e) => {
                    // Se for botão do meio, fazer zoom
                    if (e.button === 1) {
                      e.preventDefault();
                      e.stopPropagation();
                      if (zoomedCard === card.id) {
                        setZoomedCard(null);
                      } else {
                        setZoomedCard(card.id);
                      }
                      return;
                    }
                    // Se houver busca ativa, não fazer nada para permitir que o onClick funcione
                    if (searchQuery.trim()) {
                      return;
                    }
                    // Não iniciar drag no onPointerDown - deixar o HTML5 drag and drop fazer isso
                    // O drag só será iniciado quando realmente arrastar, não em um clique simples
                  }}
                  onClick={(e) => {
                    console.log('[CardSearchBase] onClick no CardToken:', {
                      cardId: card.id,
                      cardName: card.name,
                      searchQuery,
                      hasSearchQuery: !!searchQuery.trim(),
                    });
                    // Se houver busca, garantir que o clique funcione
                    if (searchQuery.trim()) {
                      e.stopPropagation();
                      console.log('[CardSearchBase] Chamando handleCardSelect do CardToken (com busca)');
                      handleCardSelect(card);
                    } else {
                      console.log('[CardSearchBase] Deixando evento borbulhar para div pai');
                    }
                    // Caso contrário, deixar o evento borbulhar para o div pai
                  }}
                  onContextMenu={() => {}}
                  ownerName={ownerName(card)}
                  width={150}
                  height={210}
                  showBack={false}
                  forceShowFront={true}
                />
                {/* Botão de transformar embaixo da carta (apenas se tiver backImageUrl) */}
                {card.backImageUrl && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      flipCard(card.id);
                    }}
                    style={{
                      position: 'absolute',
                      bottom: '-24px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '40px',
                      height: '32px',
                      padding: '4px 6px',
                      backgroundColor: 'rgba(15, 23, 42, 0.9)',
                      border: '1px solid rgba(148, 163, 184, 0.3)',
                      borderRadius: '4px',
                      color: '#f8fafc',
                      cursor: 'pointer',
                      fontSize: '18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 2,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(15, 23, 42, 0.9)';
                    }}
                    title="Transform"
                  >
                    🔄
                  </button>
                )}
              </div>
            );
            })}
            </div>
          </div>
        ) : searchQuery.trim() ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
            Nenhuma carta encontrada
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
            {cards.filter((c) => c.ownerId === playerName).length === 0
              ? 'Nenhuma carta disponível'
              : showAllWhenEmpty
              ? 'Digite o nome da carta para filtrar'
              : 'Digite o nome da carta para buscar'}
          </div>
        )}

        {showZoneMenu && selectedCard && (
          <div
            style={{
              marginTop: '24px',
              padding: '16px',
              backgroundColor: 'rgba(30, 41, 59, 0.8)',
              borderRadius: '8px',
              border: '1px solid rgba(148, 163, 184, 0.3)',
            }}
          >
            <div style={{ marginBottom: '12px', color: '#f8fafc', fontSize: '14px', fontWeight: '500' }}>
              Mover {selectedCard.name} para:
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {availableZones.includes('battlefield') && (
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
              )}
              {availableZones.includes('hand') && (
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
              )}
              {availableZones.includes('library') && (
                <button
                  onClick={() => handleMoveToZone('library')}
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
                  📚 Library
                </button>
              )}
              {availableZones.includes('cemetery') && (
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
              )}
              <button
                onClick={() => {
                  setSelectedCard(null);
                  setShowZoneMenu(false);
                  setShowPlacementMenu(false);
                  setPendingZone(null);
                }}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#64748b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#475569';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#64748b';
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {showPlacementMenu && selectedCard && pendingZone && (
          <div
            style={{
              marginTop: '24px',
              padding: '16px',
              backgroundColor: 'rgba(30, 41, 59, 0.8)',
              borderRadius: '8px',
              border: '1px solid rgba(148, 163, 184, 0.3)',
            }}
          >
            <div style={{ marginBottom: '12px', color: '#f8fafc', fontSize: '14px', fontWeight: '500' }}>
              Como colocar {selectedCard.name} no {pendingZone === 'library' ? 'Deck' : 'Cemitério'}?
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={() => handlePlacementChoice('top')}
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
                ⬆️ Top
              </button>
              <button
                onClick={() => handlePlacementChoice('bottom')}
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
                ⬇️ Bottom
              </button>
              <button
                onClick={() => handlePlacementChoice('random')}
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
                🎲 Random
              </button>
              <button
                onClick={() => {
                  setShowPlacementMenu(false);
                  setPendingZone(null);
                  setShowZoneMenu(true);
                }}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#64748b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#475569';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#64748b';
                }}
              >
                ← Voltar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Overlay de carta zoomada */}
      {zoomedCard && (() => {
        const card = filteredCards.find((c) => c.id === zoomedCard);
        if (!card) return null;
        
        return (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10002,
              cursor: 'pointer',
            }}
            onClick={() => setZoomedCard(null)}
            onPointerDown={(e) => {
              if (e.button === 1 || e.button === 0) {
                e.preventDefault();
                e.stopPropagation();
                setZoomedCard(null);
              }
            }}
          >
            <div
              style={{
                transform: 'scale(2.5)',
                transformOrigin: 'center',
                pointerEvents: 'none',
              }}
            >
              <CardToken
                card={card}
                onPointerDown={() => {}}
                onClick={() => {}}
                onContextMenu={() => {}}
                ownerName={ownerName(card)}
                width={150}
                height={210}
                showBack={false}
                forceShowFront={true}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default CardSearchBase;

