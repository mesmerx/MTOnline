import React, { useState, useRef, useEffect } from 'react';
import type { Counter, Point } from '../store/useGameStore';

interface CounterTokenProps {
  counter: Counter;
  isCurrentPlayer: boolean;
  onMove: (counterId: string, position: Point) => void;
  onModify: (counterId: string, delta?: number, deltaX?: number, deltaY?: number, setValue?: number, setX?: number, setY?: number) => void;
  onRemove: (counterId: string) => void;
  onContextMenu?: (counter: Counter, event: React.MouseEvent) => void;
  boardRef?: React.RefObject<HTMLDivElement>;
  viewMode?: 'unified' | 'individual' | 'separated';
  convertMouseToSeparatedCoordinates?: (mouseX: number, mouseY: number, playerId: string, rect: DOMRect) => { x: number; y: number } | null;
  convertMouseToUnifiedCoordinates?: (mouseX: number, mouseY: number, rect: DOMRect) => { x: number; y: number };
}

const CounterToken: React.FC<CounterTokenProps> = ({
  counter,
  isCurrentPlayer,
  onMove,
  onModify,
  onRemove,
  onContextMenu,
  boardRef,
  viewMode = 'unified',
  convertMouseToSeparatedCoordinates,
  convertMouseToUnifiedCoordinates,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [showMenu, setShowMenu] = useState(false);
  const [inputValueX, setInputValueX] = useState('');
  const [inputValueY, setInputValueY] = useState('');
  const [inputValue, setInputValue] = useState(''); // Para contador numeral
  const counterRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isCurrentPlayer) return;
    if (e.button !== 0) return; // Apenas botão esquerdo
    
    e.stopPropagation();
    setIsDragging(true);
    
    // Calcular offset no espaço base (1920x1080)
    if (boardRef?.current) {
      const rect = boardRef.current.getBoundingClientRect();
      let mouseX = e.clientX;
      let mouseY = e.clientY;
      
      // Converter coordenadas do mouse baseado no modo
      let coords: { x: number; y: number } | null = null;
      if (viewMode === 'separated' && convertMouseToSeparatedCoordinates) {
        coords = convertMouseToSeparatedCoordinates(mouseX, mouseY, counter.ownerId, rect);
      } else if (convertMouseToUnifiedCoordinates) {
        coords = convertMouseToUnifiedCoordinates(mouseX, mouseY, rect);
      }
      
      if (coords) {
        // Offset é a diferença entre a posição do mouse e a posição atual do contador
        setDragOffset({
          x: coords.x - counter.position.x,
          y: coords.y - counter.position.y,
        });
      }
    }
    
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDragging || !isCurrentPlayer || !boardRef?.current) return;
    
    const rect = boardRef.current.getBoundingClientRect();
    let mouseX = e.clientX;
    let mouseY = e.clientY;
    
    // Converter coordenadas do mouse baseado no modo
    let coords: { x: number; y: number } | null = null;
    if (viewMode === 'separated' && convertMouseToSeparatedCoordinates) {
      coords = convertMouseToSeparatedCoordinates(mouseX, mouseY, counter.ownerId, rect);
    } else if (convertMouseToUnifiedCoordinates) {
      coords = convertMouseToUnifiedCoordinates(mouseX, mouseY, rect);
    }
    
    if (!coords) return;
    
    // Calcular nova posição subtraindo o offset
    const newX = coords.x - dragOffset.x;
    const newY = coords.y - dragOffset.y;
    
    // Posição absoluta no board (espaço base 1920x1080)
    const absolutePosition: Point = {
      x: newX,
      y: newY,
    };
    
    onMove(counter.id, absolutePosition);
  };

  const handlePointerUp = () => {
    if (isDragging) {
      setIsDragging(false);
    }
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      return () => {
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
      };
    }
  }, [isDragging, dragOffset, onMove, counter.id]);

  const handleContextMenuClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isCurrentPlayer) {
      if (onContextMenu) {
        onContextMenu(counter, e);
      } else {
        setShowMenu(true);
      }
    }
  };

  const handleMenuAction = (action: string) => {
    if (counter.type === 'numeral') {
      if (action === 'add') {
        onModify(counter.id, 1);
        // Não fechar o menu
      } else if (action === 'subtract') {
        onModify(counter.id, -1);
        // Não fechar o menu
      } else if (action === 'set') {
        const value = parseInt(inputValue, 10);
        if (!isNaN(value) && value >= 0) {
          onModify(counter.id, undefined, undefined, undefined, value);
        }
        setInputValue('');
        // Não fechar o menu
      } else if (action === 'remove') {
        onRemove(counter.id);
        setShowMenu(false); // Fechar apenas ao remover
      }
    } else if (counter.type === 'plus') {
      if (action === 'addX') {
        onModify(counter.id, undefined, 1);
        // Não fechar o menu
      } else if (action === 'subtractX') {
        onModify(counter.id, undefined, -1);
        // Não fechar o menu
      } else if (action === 'addY') {
        onModify(counter.id, undefined, undefined, 1);
        // Não fechar o menu
      } else if (action === 'subtractY') {
        onModify(counter.id, undefined, undefined, -1);
        // Não fechar o menu
      } else if (action === 'setX') {
        const value = parseInt(inputValueX, 10);
        if (!isNaN(value)) {
          onModify(counter.id, undefined, undefined, undefined, undefined, value);
        }
        setInputValueX('');
        // Não fechar o menu
      } else if (action === 'setY') {
        const value = parseInt(inputValueY, 10);
        if (!isNaN(value)) {
          onModify(counter.id, undefined, undefined, undefined, undefined, undefined, value);
        }
        setInputValueY('');
        // Não fechar o menu
      } else if (action === 'remove') {
        onRemove(counter.id);
        setShowMenu(false); // Fechar apenas ao remover
      }
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // Não fechar se clicar dentro do menu ou no contador
      if (menuRef.current && !menuRef.current.contains(target) && 
          counterRef.current && !counterRef.current.contains(target)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      // Usar setTimeout para evitar que o evento de abertura do menu feche imediatamente
      const timeoutId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
      
      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showMenu]);

  const displayText = counter.type === 'numeral' 
    ? String(counter.value ?? 0)
    : `+${counter.plusX ?? 0}/+${counter.plusY ?? 0}`;

  // Função para renderizar d4 (tetraedro 3D)
  const renderD4 = (value: number) => {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: '200px',
      }}>
        <div style={{
          width: '32px',
          height: '32px',
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: 'rotateX(20deg) rotateY(-20deg)',
        }}>
          {/* Face frontal */}
          <div style={{
            position: 'absolute',
            width: 0,
            height: 0,
            borderLeft: '16px solid transparent',
            borderRight: '16px solid transparent',
            borderBottom: '28px solid #ffffff',
            borderTop: 'none',
            transform: 'translateZ(8px)',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
          }}>
            <div style={{
              position: 'absolute',
              top: '12px',
              left: '-8px',
              color: '#000000',
              fontSize: '12px',
              fontWeight: 'bold',
              textAlign: 'center',
              width: '16px',
            }}>
              {value}
            </div>
          </div>
          {/* Face esquerda */}
          <div style={{
            position: 'absolute',
            width: 0,
            height: 0,
            borderLeft: '16px solid transparent',
            borderRight: '16px solid transparent',
            borderBottom: '28px solid #e5e5e5',
            borderTop: 'none',
            transform: 'rotateY(-120deg) translateZ(8px)',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
          }} />
          {/* Face direita */}
          <div style={{
            position: 'absolute',
            width: 0,
            height: 0,
            borderLeft: '16px solid transparent',
            borderRight: '16px solid transparent',
            borderBottom: '28px solid #d0d0d0',
            borderTop: 'none',
            transform: 'rotateY(120deg) translateZ(8px)',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
          }} />
        </div>
      </div>
    );
  };


  // Função para renderizar d6 (cubo simples com pontos)
  const renderD6 = (value: number) => {
    const dots: number[][] = {
      1: [[1, 1]],
      2: [[0, 0], [2, 2]],
      3: [[0, 0], [1, 1], [2, 2]],
      4: [[0, 0], [0, 2], [2, 0], [2, 2]],
      5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
      6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
    };
    
    const positions = dots[value as keyof typeof dots] || [];
    
    return (
      <div style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#ffffff',
        border: '2px solid #000000',
        borderRadius: '4px',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        padding: '4px',
      }}>
        {positions.map(([row, col], index) => (
          <div
            key={index}
            style={{
              gridColumn: col + 1,
              gridRow: row + 1,
              backgroundColor: '#000000',
              borderRadius: '50%',
              width: '8px',
              height: '8px',
              justifySelf: 'center',
              alignSelf: 'center',
            }}
          />
        ))}
      </div>
    );
  };

  return (
    <>
      <div
        ref={counterRef}
        style={{
          position: 'absolute',
          left: `${counter.position.x}px`,
          top: `${counter.position.y}px`,
          backgroundColor: counter.type === 'numeral' && (counter.value ?? 0) >= 1 && (counter.value ?? 0) <= 6 ? 'transparent' : (counter.type === 'numeral' ? '#ffffff' : '#3b82f6'),
          color: counter.type === 'numeral' ? '#000000' : 'white',
          borderRadius: counter.type === 'numeral' && (counter.value ?? 0) >= 1 && (counter.value ?? 0) <= 6 ? '0' : '8px',
          width: '48px',
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: counter.type === 'numeral' && (counter.value ?? 0) >= 1 && (counter.value ?? 0) <= 6 ? '0px' : (counter.type === 'numeral' ? '18px' : '12px'),
          fontWeight: 'bold',
          border: counter.type === 'numeral' && (counter.value ?? 0) >= 1 && (counter.value ?? 0) <= 6 ? 'none' : '3px solid #000000',
          boxShadow: counter.type === 'numeral' && (counter.value ?? 0) >= 1 && (counter.value ?? 0) <= 6 ? 'none' : '0 4px 12px rgba(0, 0, 0, 0.6), inset 0 2px 4px rgba(255, 255, 255, 0.3)',
          zIndex: 100,
          cursor: isCurrentPlayer ? (isDragging ? 'grabbing' : 'grab') : 'default',
          userSelect: 'none',
          touchAction: 'none',
          transform: counter.type === 'numeral' && (counter.value ?? 0) >= 1 && (counter.value ?? 0) <= 6 ? 'none' : 'perspective(100px) rotateX(5deg) rotateY(-5deg)',
          overflow: 'visible',
        }}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenuClick}
      >
        {counter.type === 'numeral' && (counter.value ?? 0) >= 1 && (counter.value ?? 0) <= 6 ? (
          renderD6(counter.value ?? 0)
        ) : (
          displayText
        )}
      </div>
      
      {showMenu && isCurrentPlayer && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: `${counter.position.x + 50}px`,
            top: `${counter.position.y}px`,
            backgroundColor: 'rgba(30, 41, 59, 0.95)',
            border: '1px solid rgba(148, 163, 184, 0.3)',
            borderRadius: '8px',
            padding: '8px',
            zIndex: 1000,
            minWidth: '200px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
          }}
        >
          {counter.type === 'numeral' ? (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleMenuAction('add');
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                ➕ Adicionar 1
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleMenuAction('subtract');
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                ➖ Subtrair 1
              </button>
              <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', margin: '4px 0' }} />
              <div style={{ display: 'flex', gap: '4px', padding: '4px' }}>
                <input
                  type="number"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Valor"
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    backgroundColor: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                    borderRadius: '4px',
                    color: '#f8fafc',
                    fontSize: '14px',
                  }}
                />
                <button
                  onClick={() => handleMenuAction('set')}
                  style={{
                    padding: '4px 12px',
                    backgroundColor: '#3b82f6',
                    border: 'none',
                    borderRadius: '4px',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  Definir
                </button>
              </div>
              <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', margin: '4px 0' }} />
              <button
                onClick={() => handleMenuAction('remove')}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                🗑️ Remover
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: '12px', color: '#94a3b8', padding: '4px 8px', marginBottom: '4px' }}>
                +X/+Y
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleMenuAction('addX');
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                ➕ +X: +1
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleMenuAction('subtractX');
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                ➖ +X: -1
              </button>
              <div style={{ display: 'flex', gap: '4px', padding: '4px', alignItems: 'center' }}>
                <label style={{ color: '#94a3b8', fontSize: '12px', minWidth: '20px' }}>X:</label>
                <input
                  type="number"
                  value={inputValueX}
                  onChange={(e) => setInputValueX(e.target.value)}
                  placeholder="X"
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    backgroundColor: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                    borderRadius: '4px',
                    color: '#f8fafc',
                    fontSize: '14px',
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMenuAction('setX');
                  }}
                  style={{
                    padding: '4px 12px',
                    backgroundColor: '#3b82f6',
                    border: 'none',
                    borderRadius: '4px',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  Definir X
                </button>
              </div>
              <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', margin: '4px 0' }} />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleMenuAction('addY');
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                ➕ +Y: +1
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleMenuAction('subtractY');
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                ➖ +Y: -1
              </button>
              <div style={{ display: 'flex', gap: '4px', padding: '4px', alignItems: 'center' }}>
                <label style={{ color: '#94a3b8', fontSize: '12px', minWidth: '20px' }}>Y:</label>
                <input
                  type="number"
                  value={inputValueY}
                  onChange={(e) => setInputValueY(e.target.value)}
                  placeholder="Y"
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    backgroundColor: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                    borderRadius: '4px',
                    color: '#f8fafc',
                    fontSize: '14px',
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMenuAction('setY');
                  }}
                  style={{
                    padding: '4px 12px',
                    backgroundColor: '#3b82f6',
                    border: 'none',
                    borderRadius: '4px',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  Definir Y
                </button>
              </div>
              <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', margin: '4px 0' }} />
              <button
                onClick={() => handleMenuAction('remove')}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                🗑️ Remover
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default CounterToken;

