import { beforeEach, describe, expect, it, vi } from 'vitest';

const peerControl = vi.hoisted(() => ({
  peers: [] as any[],
  lastConnection: null as null | { targetId: string; options: any; connection: any },
}));

vi.mock('peerjs', () => {
  class TinyEmitter {
    private listeners = new Map<string, ((...args: any[]) => void)[]>();

    on(event: string, handler: (...args: any[]) => void) {
      const handlers = this.listeners.get(event) ?? [];
      handlers.push(handler);
      this.listeners.set(event, handlers);
      return this;
    }

    emit(event: string, ...args: any[]) {
      this.listeners.get(event)?.forEach((handler) => handler(...args));
    }
  }

  class MockDataConnection extends TinyEmitter {
    public open = true;
    public metadata: any;

    constructor(public peer: string, public options?: any) {
      super();
      this.metadata = options?.metadata;
    }

    send = vi.fn();

    close = vi.fn(() => {
      this.open = false;
      this.emit('close');
    });
  }

  class MockPeer extends TinyEmitter {
    public id?: string;

    constructor(idOrOptions?: any, _options?: any) {
      super();
      if (typeof idOrOptions === 'string') {
        this.id = idOrOptions;
      }
      peerControl.peers.push(this);
    }

    connect(targetId: string, options?: any) {
      const connection = new MockDataConnection(targetId, options);
      peerControl.lastConnection = { targetId, options, connection };
      return connection;
    }

    destroy() {
      this.emit('close');
    }
  }

  return { default: MockPeer };
});

import { useGameStore } from './useGameStore';

describe('useGameStore room connections', () => {
  beforeEach(() => {
    peerControl.peers.length = 0;
    peerControl.lastConnection = null;
    useGameStore.getState().leaveRoom();
    useGameStore.getState().setPlayerName('');
  });

  it('creates a host room and marks the local player as connected once PeerJS opens', async () => {
    const store = useGameStore.getState();
    store.setPlayerName('Host Mage');
    const createPromise = store.createRoom(' test-room ', 'secret');
    
    // Aguardar um pouco mais para o peer ser criado (createPeerInstance é assíncrono)
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    expect(peerControl.peers.length).toBeGreaterThan(0);
    const hostPeer = peerControl.peers[peerControl.peers.length - 1];

    hostPeer.emit('open');
    
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

    expect(peerControl.peers.length).toBeGreaterThan(0);
    const peer = peerControl.peers[peerControl.peers.length - 1];
    peer.emit('open');

    const attempt = peerControl.lastConnection;
    expect(attempt?.targetId).toBe('alpha-room');
    expect(attempt?.options?.metadata).toMatchObject({
      password: 'pw123',
      name: 'Visiting Planeswalker',
    });

    attempt?.connection.emit('open');
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

    attempt?.connection.emit('data', {
      type: 'ROOM_STATE',
      board: remoteBoard,
      players: remotePlayers,
    });

    const nextState = useGameStore.getState();
    expect(nextState.status).toBe('connected');
    expect(nextState.board).toHaveLength(1);
    expect(nextState.players[0]?.name).toBe('Host Player');
  });
});
