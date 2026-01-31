import { useEffect, useMemo, useState } from 'react';
import MenuModal from './MenuModal';
import RoomPanel from './RoomPanel';
import DeckManager from './DeckManager';
import CardSearch from './CardSearch';
import Login from './Login';
import { useGameStore } from '../store/useGameStore';

type ModalKey = 'room' | 'decks' | 'search' | 'account';

const POSITION_KEY = 'mtonline.menuBarPosition';
const MINIMIZED_KEY = 'mtonline.menuBarMinimized';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const loadPosition = () => {
  if (typeof window === 'undefined') {
    return { x: 24, y: 24 };
  }
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return { x: 24, y: 24 };
    const parsed = JSON.parse(raw) as { x: number; y: number };
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
      return parsed;
    }
  } catch {
    // ignore
  }
  return { x: 24, y: 24 };
};

const loadMinimized = () => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(MINIMIZED_KEY) === 'true';
};

const MenuBar = () => {
  const resetBoard = useGameStore((state) => state.resetBoard);
  const status = useGameStore((state) => state.status);
  const [activeModal, setActiveModal] = useState<ModalKey | null>(null);
  const [position, setPosition] = useState(loadPosition);
  const [minimized, setMinimized] = useState(loadMinimized);
  const [dragging, setDragging] = useState<{ offsetX: number; offsetY: number } | null>(null);

  const modals = useMemo(
    () => ({
      room: { title: 'Room', icon: '🧩', content: <RoomPanel /> },
      decks: { title: 'Decks', icon: '📚', content: <DeckManager /> },
      search: { title: 'Card search', icon: '🔍', content: <CardSearch /> },
      account: { title: 'Account', icon: '👤', content: <Login /> },
    }),
    []
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (event: PointerEvent) => {
      const maxX = window.innerWidth - 64;
      const maxY = window.innerHeight - 64;
      const nextX = clamp(event.clientX - dragging.offsetX, 8, maxX);
      const nextY = clamp(event.clientY - dragging.offsetY, 8, maxY);
      setPosition({ x: nextX, y: nextY });
    };

    const handleUp = () => {
      setDragging(null);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragging, position]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MINIMIZED_KEY, minimized ? 'true' : 'false');
  }, [minimized]);

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    setDragging({ offsetX: event.clientX - position.x, offsetY: event.clientY - position.y });
  };

  const closeModal = () => setActiveModal(null);

  if (minimized) {
    return (
      <div
        className="menu-bar-minimized"
        style={{ top: position.y, left: position.x }}
        onClick={() => setMinimized(false)}
        title="Open menu"
      >
        <span className="menu-icon">☰</span>
      </div>
    );
  }

  return (
    <>
      <div className="menu-bar" style={{ top: position.y, left: position.x }}>
        <div className="menu-bar-header" onPointerDown={startDrag}>
          <span className="menu-drag-handle">⋮⋮</span>
          <button type="button" className="menu-minimize" onClick={() => setMinimized(true)}>
            –
          </button>
        </div>
        <div className="menu-buttons">
          {(Object.keys(modals) as ModalKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`menu-button ${activeModal === key ? 'active' : ''}`}
              onClick={() => setActiveModal(activeModal === key ? null : key)}
              title={modals[key].title}
            >
              <span className="menu-icon">{modals[key].icon}</span>
            </button>
          ))}
          <button
            type="button"
            className="menu-button"
            onClick={() => resetBoard()}
            disabled={status === 'idle'}
            title="Reset Board"
          >
            <span className="menu-icon">🔁</span>
          </button>
        </div>
      </div>

      {activeModal && (
        <MenuModal
          isOpen={!!activeModal}
          onClose={closeModal}
          title={modals[activeModal].title}
          icon={modals[activeModal].icon}
        >
          {modals[activeModal].content}
        </MenuModal>
      )}
    </>
  );
};

export default MenuBar;
