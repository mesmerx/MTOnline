import { useState, useRef, useEffect } from 'react';
import RoomPanel from './RoomPanel';
import ConnectionSettings from './ConnectionSettings';
import DeckManager from './DeckManager';
import CardSearch from './CardSearch';
import Login from './Login';
import MenuModal from './MenuModal';
import { useGameStore } from '../store/useGameStore';

const MenuBar = () => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 16, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const minimizedRef = useRef<HTMLDivElement>(null);
  const resetBoard = useGameStore((state) => state.resetBoard);

  const toggleMenu = (menu: string) => {
    setOpenMenu(openMenu === menu ? null : menu);
    if (isMinimized) {
      setIsMinimized(false);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const ref = isMinimized ? minimizedRef.current : menuRef.current;
    if (!ref) return;
    
    const rect = ref.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setDragStartPos({ x: e.clientX, y: e.clientY });
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = Math.abs(e.clientX - dragStartPos.x);
      const deltaY = Math.abs(e.clientY - dragStartPos.y);
      
      // Só considera drag se moveu mais de 5px
      if (deltaX > 5 || deltaY > 5) {
        setPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y,
        });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const deltaX = Math.abs(e.clientX - dragStartPos.x);
      const deltaY = Math.abs(e.clientY - dragStartPos.y);
      
      // Se não moveu muito, considera como clique
      if (deltaX < 5 && deltaY < 5 && isMinimized) {
        setIsMinimized(false);
      }
      
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, dragStartPos, isMinimized]);

  return (
    <>
      {isMinimized ? (
        <div
          ref={minimizedRef}
          className="menu-bar-minimized"
          style={{
            left: `${position.x}px`,
            top: `${position.y}px`,
            cursor: isDragging ? 'grabbing' : 'grab',
          }}
          onMouseDown={handleMouseDown}
          title="Click to expand, drag to move"
        >
          <span className="menu-icon">☰</span>
        </div>
      ) : (
        <div
          ref={menuRef}
          className="menu-bar"
          style={{
            left: `${position.x}px`,
            top: `${position.y}px`,
            cursor: isDragging ? 'grabbing' : 'grab',
          }}
          onMouseDown={handleMouseDown}
        >
          <div className="menu-bar-header">
            <span className="menu-drag-handle">☰</span>
            <button
              type="button"
              className="menu-minimize"
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(true);
                setOpenMenu(null);
              }}
              title="Minimize"
            >
              −
            </button>
          </div>
          <div className="menu-buttons">
            <button
              type="button"
              className={openMenu === 'room' ? 'menu-button active' : 'menu-button'}
              onClick={() => toggleMenu('room')}
              title="Room Settings"
              data-testid="menu-room-button"
            >
              <span className="menu-icon">🏠</span>
            </button>
            <button
              type="button"
              className={openMenu === 'connection' ? 'menu-button active' : 'menu-button'}
              onClick={() => toggleMenu('connection')}
              title="Connection Settings"
            >
              <span className="menu-icon">🔌</span>
            </button>
            <button
              type="button"
              className={openMenu === 'deck' ? 'menu-button active' : 'menu-button'}
              onClick={() => toggleMenu('deck')}
              title="Deck Manager"
            >
              <span className="menu-icon">📚</span>
            </button>
            <button
              type="button"
              className={openMenu === 'search' ? 'menu-button active' : 'menu-button'}
              onClick={() => toggleMenu('search')}
              title="Card Search"
            >
              <span className="menu-icon">🔍</span>
            </button>
            <button
              type="button"
              className={openMenu === 'login' ? 'menu-button active' : 'menu-button'}
              onClick={() => toggleMenu('login')}
              title="Login / Account"
            >
              <span className="menu-icon">👤</span>
            </button>
            <button
              type="button"
              className="menu-button"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm('Tem certeza que deseja resetar o board? Todas as cartas serão removidas.')) {
                  resetBoard();
                }
              }}
              title="Reset Board"
            >
              <span className="menu-icon">🗑️</span>
            </button>
          </div>
        </div>
      )}

      <MenuModal
        isOpen={openMenu === 'room'}
        onClose={() => setOpenMenu(null)}
        title="Room"
        icon="🏠"
      >
        <RoomPanel />
      </MenuModal>

      <MenuModal
        isOpen={openMenu === 'connection'}
        onClose={() => setOpenMenu(null)}
        title="Connection"
        icon="🔌"
      >
        <ConnectionSettings />
      </MenuModal>

      <MenuModal
        isOpen={openMenu === 'deck'}
        onClose={() => setOpenMenu(null)}
        title="Deck Manager"
        icon="📚"
      >
        <DeckManager onClose={() => setOpenMenu(null)} />
      </MenuModal>

      <MenuModal
        isOpen={openMenu === 'search'}
        onClose={() => setOpenMenu(null)}
        title="Card Search"
        icon="🔍"
      >
        <CardSearch />
      </MenuModal>

      <MenuModal
        isOpen={openMenu === 'login'}
        onClose={() => setOpenMenu(null)}
        title="Account"
        icon="👤"
      >
        <Login />
      </MenuModal>
    </>
  );
};

export default MenuBar;

