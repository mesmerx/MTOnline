import { beforeEach, describe, expect, it, vi } from 'vitest';

const wsControl = (globalThis as any).__WS_CONTROL__;
const openRoomAsHost = async (store: { roomId: string; playerId: string; playerName: string }, roomId: string) => {
  wsControl.openLast();
  wsControl.receiveLast({
    type: 'room:created',
    payload: {
      roomId,
      playerId: store.playerId,
      playerName: store.playerName || 'Host',
      socketId: 'socket-host',
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const openRoomAsClient = async (store: { roomId: string; playerId: string; playerName: string }, roomId: string) => {
  wsControl.openLast();
  wsControl.receiveLast({
    type: 'room:joined',
    payload: {
      roomId,
      playerId: store.playerId,
      playerName: store.playerName || 'Player',
      socketId: 'socket-client',
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
};

import { useGameStore } from './useGameStore';

describe('useGameStore room connections', () => {
  beforeEach(() => {
    wsControl.reset();
    useGameStore.getState().leaveRoom();
    useGameStore.getState().setPlayerName('');
  });

  it('creates a host room and marks the local player as connected once WS opens', async () => {
    const store = useGameStore.getState();
    store.setPlayerName('Host Mage');
    const createPromise = store.createRoom(' test-room ', 'secret');
    await createPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wsControl.sockets.length).toBeGreaterThan(0);
    await openRoomAsHost(store, 'test-room');
    
    // Aguardar a promise do createRoom completar
    await createPromise;

    const nextState = useGameStore.getState();
    expect(nextState.isHost).toBe(true);
    expect(nextState.status).toBe('connected');
    expect(nextState.roomId).toBe('test-room');
    expect(nextState.players[0]?.name).toBe('Host Mage');
  });

  it('joins an existing room and applies ROOM_STATE updates from host', async () => {
    const store = useGameStore.getState();
    store.setPlayerName('Visiting Planeswalker');
    await store.joinRoom('alpha-room', 'pw123');

    expect(wsControl.sockets.length).toBeGreaterThan(0);
    await openRoomAsClient(store, 'alpha-room');
    expect(useGameStore.getState().status).toBe('waiting');

    const remoteBoard = [
      {
        id: 'card-1',
        name: 'Island',
        ownerId: 'host',
        position: { x: 10, y: 20 },
        tapped: false,
      },
    ];
    const remotePlayers = [
      { id: 'host', name: 'Host Player' },
      { id: useGameStore.getState().playerId, name: 'Visiting Planeswalker' },
    ];

    wsControl.receiveLast({
      type: 'room:host_message',
      payload: {
        message: {
          type: 'ROOM_STATE',
          board: remoteBoard,
          players: remotePlayers,
        },
      },
    });

    const nextState = useGameStore.getState();
    expect(nextState.status).toBe('connected');
    expect(nextState.board).toHaveLength(1);
    expect(nextState.players[0]?.name).toBe('Host Player');
  });
});
