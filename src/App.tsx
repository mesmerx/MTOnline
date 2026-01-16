import { useEffect, useRef } from 'react';
import Board from './components/Board';
import MenuBar from './components/MenuBar';
import { useGameStore } from './store/useGameStore';

const App = () => {
  const status = useGameStore((state) => state?.status ?? 'idle');
  const error = useGameStore((state) => state?.error);
  const hydrateDecks = useGameStore((state) => state?.hydrateDecks);
  const roomId = useGameStore((state) => state?.roomId ?? '');
  const roomPassword = useGameStore((state) => state?.roomPassword ?? '');
  const isHost = useGameStore((state) => state?.isHost ?? false);
  const playerName = useGameStore((state) => state?.playerName ?? '');
  const createRoom = useGameStore((state) => state?.createRoom);
  const joinRoom = useGameStore((state) => state?.joinRoom);
  const hasReconnected = useRef(false);

  useEffect(() => {
    if (hydrateDecks) {
      hydrateDecks();
    }
  }, [hydrateDecks]);

  // Reconectar automaticamente após F5 se houver sessão salva
  useEffect(() => {
    if (roomId && status === 'idle' && playerName && !hasReconnected.current) {
      hasReconnected.current = true;
      // Pequeno delay para garantir que tudo está inicializado
      const timer = setTimeout(() => {
        if (isHost && createRoom) {
          createRoom(roomId, roomPassword);
        } else if (!isHost && joinRoom) {
          joinRoom(roomId, roomPassword);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
    // Reset flag quando sair da sala
    if (!roomId) {
      hasReconnected.current = false;
    }
  }, [roomId, status, isHost, playerName, roomPassword, createRoom, joinRoom]);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <h1>MTOnline</h1>
          <p className="subtitle">Peer-to-peer Magic rooms with collaborative boards.</p>
        </div>
        <div className="status-pill">
          <span>Status: {status}</span>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <main className="board-fullscreen">
        <MenuBar />
        <Board />
      </main>
    </div>
  );
};

export default App;
