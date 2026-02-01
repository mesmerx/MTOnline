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

  it('applies library, cemetery, and exile positions from BOARD_STATE', async () => {
    const store = useGameStore.getState();
    store.setPlayerName('Visitor');
    await store.joinRoom('beta-room', 'pw123');

    await openRoomAsClient(store, 'beta-room');
    expect(useGameStore.getState().status).toBe('waiting');

    wsControl.receiveLast({
      type: 'room:host_message',
      payload: {
        message: {
          type: 'BOARD_STATE',
          board: [],
          cemeteryPositions: { Visitor: { x: 11, y: 22 } },
          libraryPositions: { Visitor: { x: 33, y: 44 } },
          exilePositions: { Visitor: { x: 55, y: 66 } },
        },
      },
    });

    const nextState = useGameStore.getState();
    expect(nextState.cemeteryPositions.Visitor).toEqual({ x: 11, y: 22 });
    expect(nextState.libraryPositions.Visitor).toEqual({ x: 33, y: 44 });
    expect(nextState.exilePositions.Visitor).toEqual({ x: 55, y: 66 });
  });

  it('applies library position updates from LIBRARY_POSITION messages', async () => {
    const store = useGameStore.getState();
    store.setPlayerName('Visitor');
    await store.joinRoom('gamma-room', 'pw123');

    await openRoomAsClient(store, 'gamma-room');
    expect(useGameStore.getState().status).toBe('waiting');

    wsControl.receiveLast({
      type: 'room:host_message',
      payload: {
        message: {
          type: 'LIBRARY_POSITION',
          playerName: 'Visitor',
          position: { x: 77, y: 88 },
        },
      },
    });

    const nextState = useGameStore.getState();
    expect(nextState.libraryPositions.Visitor).toEqual({ x: 77, y: 88 });
  });

  it('forwards room:client_message to the host connection', async () => {
    const store = useGameStore.getState();
    store.setPlayerName('Host');
    await store.createRoom('host-room', '');
    await openRoomAsHost(store, 'host-room');

    wsControl.receiveLast({
      type: 'room:client_joined',
      payload: {
        roomId: 'host-room',
        playerId: 'p2',
        playerName: 'Guest',
        socketId: 'socket-guest',
      },
    });

    const connection = useGameStore.getState().connections.p2;
    let received: unknown = null;
    connection?.on('data', (data: unknown) => {
      received = data;
    });

    wsControl.receiveLast({
      type: 'room:client_message',
      payload: {
        roomId: 'host-room',
        playerId: 'p2',
        message: { type: 'PING', payload: { value: 1 } },
      },
    });

    expect(received).toEqual({ type: 'PING', payload: { value: 1 } });
  });

  it('forwards room:host_message to the client hostConnection', async () => {
    const store = useGameStore.getState();
    store.setPlayerName('Client');
    await store.joinRoom('client-room', '');
    await openRoomAsClient(store, 'client-room');

    const hostConnection = useGameStore.getState().hostConnection;
    let received: unknown = null;
    hostConnection?.on('data', (data: unknown) => {
      received = data;
    });

    wsControl.receiveLast({
      type: 'room:host_message',
      payload: {
        message: { type: 'PONG', payload: { value: 2 } },
      },
    });

    expect(received).toEqual({ type: 'PONG', payload: { value: 2 } });
  });
});
