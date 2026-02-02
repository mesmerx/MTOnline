import { useEffect, useRef, useState } from 'react';
import Board from './components/Board';
import MenuBar from './components/MenuBar';
import UIConfigAdmin from './components/UIConfigAdmin';
import { useGameStore } from './store/useGameStore';

const App = () => {
  const status = useGameStore((state) => state?.status ?? 'idle');
  const error = useGameStore((state) => state?.error);
  const checkAuth = useGameStore((state) => state?.checkAuth);
  const roomId = useGameStore((state) => state?.roomId ?? '');
  const roomPassword = useGameStore((state) => state?.roomPassword ?? '');
  const isHost = useGameStore((state) => state?.isHost ?? false);
  const playerName = useGameStore((state) => state?.playerName ?? '');
  const setPlayerName = useGameStore((state) => state?.setPlayerName);
  const createRoom = useGameStore((state) => state?.createRoom);
  const joinRoom = useGameStore((state) => state?.joinRoom);
  const hasReconnected = useRef(false);
  const hasProcessedQueryParams = useRef(false);
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    if (checkAuth) {
      checkAuth();
    }
  }, [checkAuth]);

  useEffect(() => {
    const handlePop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  // Processar query parameters da URL
  useEffect(() => {
    if (hasProcessedQueryParams.current) return;
    if (status !== 'idle') return; // Só processar se estiver em idle
    
    const urlParams = new URLSearchParams(window.location.search);
    const queryRoomId = urlParams.get('roomId');
    const queryPassword = urlParams.get('password');
    const queryPlayerName = urlParams.get('playerName');

    // Se não houver query params, não fazer nada
    if (!queryRoomId && !queryPlayerName) return;

    hasProcessedQueryParams.current = true;

    // Definir nome do player se fornecido
    if (queryPlayerName && queryPlayerName.trim()) {
      setPlayerName(queryPlayerName.trim());
    }

    // Se houver roomId, primeiro tentar criar, se falhar então tentar join
    if (queryRoomId) {
      const trimmedRoomId = queryRoomId.trim();
      const trimmedPassword = queryPassword?.trim() || '';

      // Pequeno delay para garantir que o playerName foi definido
      setTimeout(() => {
        createRoom(trimmedRoomId, trimmedPassword);

        // Timeout para detectar se o create falhou (peer ID já em uso ou outro erro)
        const timeoutId = setTimeout(() => {
          const currentStatus = useGameStore.getState().status;
          const currentRoomId = useGameStore.getState().roomId;
          const currentError = useGameStore.getState().error;
          
          // Se ainda está em erro ou initializing após 3 segundos, tentar join
          if (
            (currentStatus === 'error' || currentStatus === 'initializing') && 
            currentRoomId === trimmedRoomId &&
            (currentError?.includes('taken') || currentError?.includes('unavailable') || currentError?.includes('ID'))
          ) {
            // Limpar erro e tentar join
            useGameStore.setState({ error: undefined, status: 'idle' });
            joinRoom(trimmedRoomId, trimmedPassword);
          } else if (currentStatus === 'error' && currentRoomId === trimmedRoomId) {
            // Se houver outro tipo de erro após 3 segundos, também tentar join
            useGameStore.setState({ error: undefined, status: 'idle' });
            joinRoom(trimmedRoomId, trimmedPassword);
          }
        }, 3000);

        // Limpar timeout se conectar com sucesso ou mudar de sala
        const unsubscribe = useGameStore.subscribe((state) => {
          if (state.status === 'connected' || (state.roomId && state.roomId !== trimmedRoomId)) {
            clearTimeout(timeoutId);
            unsubscribe();
          }
        });
      }, 100);
    }
  }, [status, setPlayerName, joinRoom, createRoom]);

  // Atualizar URL com query parameters quando entrar na sala
  useEffect(() => {
    if (status === 'connected' && roomId && playerName) {
      const url = new URL(window.location.href);
      url.searchParams.set('roomId', roomId);
      if (roomPassword) {
        url.searchParams.set('password', roomPassword);
      }
      url.searchParams.set('playerName', playerName);
      window.history.replaceState({}, '', url.toString());
    } else if (status === 'idle' && !roomId) {
      // Limpar apenas roomId e password quando sair da sala, manter playerName
      const url = new URL(window.location.href);
      url.searchParams.delete('roomId');
      url.searchParams.delete('password');
      window.history.replaceState({}, '', url.toString());
    }
  }, [status, roomId, roomPassword, playerName]);

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

  if (path.startsWith('/admin/ui-config')) {
    return (
      <div className="app-shell">
        {error && <div className="error-banner">{error}</div>}
        <main className="board-fullscreen">
          <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600 }}>UI Config</div>
            <button
              type="button"
              onClick={() => {
                window.history.pushState({}, '', '/');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(148, 163, 184, 0.4)',
                background: 'transparent',
                color: '#f8fafc',
                cursor: 'pointer',
              }}
            >
              Back to game
            </button>
          </div>
          <div style={{ padding: '16px' }}>
            <UIConfigAdmin />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {error && <div className="error-banner">{error}</div>}

      <main className="board-fullscreen">
        <MenuBar />
        <Board />
      </main>
    </div>
  );
};

export default App;
