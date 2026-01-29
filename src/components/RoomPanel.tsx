import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useGameStore } from '../store/useGameStore';
import classNames from 'classnames';

const RoomPanel = () => {
  const playerName = useGameStore((state) => state.playerName);
  const setPlayerName = useGameStore((state) => state.setPlayerName);
  const status = useGameStore((state) => state.status);
  const roomId = useGameStore((state) => state.roomId);
  const isHost = useGameStore((state) => state.isHost);
  const players = useGameStore((state) => state.players);
  const createRoom = useGameStore((state) => state.createRoom);
  const joinRoom = useGameStore((state) => state.joinRoom);
  const leaveRoom = useGameStore((state) => state.leaveRoom);
  const [localRoomId, setLocalRoomId] = useState(roomId);
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const roomPassword = useGameStore((state) => state.roomPassword);

  const inRoom = status !== 'idle';
  const canSubmit = Boolean(playerName && localRoomId);

  const statusLabel = useMemo(() => {
    if (status === 'connected' && isHost) {
      return 'Hosting';
    }
    if (status === 'connected') {
      return 'Connected';
    }
    return status;
  }, [status, isHost]);

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!playerName || !playerName.trim()) return;
    createRoom(localRoomId, password);
  };

  const onJoin = (event: FormEvent) => {
    event.preventDefault();
    if (!playerName || !playerName.trim() || !localRoomId) return;
    joinRoom(localRoomId, password);
  };

  useEffect(() => {
    if (roomId) {
      setLocalRoomId(roomId);
    }
  }, [roomId]);

  const copyRoomLink = () => {
    if (!roomId || !playerName) return;
    
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('roomId', roomId);
    if (roomPassword) {
      url.searchParams.set('password', roomPassword);
    }
    url.searchParams.set('playerName', playerName);
    
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch((err) => {
      console.error('Erro ao copiar link:', err);
    });
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Room</h2>
        <span className={classNames('status-chip', status)}>
          {statusLabel}
        </span>
      </div>

      <label className="field">
        <span>Display name</span>
        <input
          type="text"
          placeholder="Chandra"
          value={playerName}
          onChange={(event) => setPlayerName(event.target.value)}
          disabled={inRoom}
        />
        {inRoom && (
          <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
            Name cannot be changed while in a room
          </div>
        )}
      </label>

      <form className="room-form">
        <label className="field">
          <span>Room ID</span>
          <input
            type="text"
            placeholder="alpha-betagamma"
            value={localRoomId}
            onChange={(event) => setLocalRoomId(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            placeholder="secret phrase"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <div className="button-row">
          <button className="primary" onClick={onCreate} disabled={!playerName || !playerName.trim()}>
            Create
          </button>
          <button onClick={onJoin} disabled={!canSubmit}>
            Join
          </button>
          <button type="button" className="ghost" onClick={leaveRoom} disabled={!inRoom}>
            Leave
          </button>
        </div>
      </form>

      {roomId && (
        <div className="hint">
          <div style={{ marginBottom: '8px' }}>
            Share your room id <code>{roomId}</code> with friends. Everyone must use the same password.
          </div>
          <button
            type="button"
            className="primary"
            onClick={copyRoomLink}
            style={{ width: '100%', marginTop: '8px' }}
          >
            {copied ? '✓ Link copiado!' : '📋 Copiar link da sala'}
          </button>
        </div>
      )}

      <div className="player-list">
        <h3>Players ({players.length})</h3>
        {players.length === 0 && <p className="muted">No one is connected yet.</p>}
        {players.map((player) => {
          const isSelf = player.name === playerName;
          const isRoomHost = player.name === players[0]?.name;
          return (
            <div key={player.id} className="player-pill">
              <span>{player.name}</span>
              {isSelf && <span className="tag">you</span>}
              {isRoomHost && <span className="tag">host</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RoomPanel;
