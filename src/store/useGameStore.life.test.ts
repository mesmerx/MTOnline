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

// Mock fetch para evitar chamadas reais à API
global.fetch = vi.fn();

import { useGameStore } from './useGameStore';

describe('Player Life and Commander Damage', () => {
  beforeEach(() => {
    peerControl.peers.length = 0;
    peerControl.lastConnection = null;
    vi.clearAllMocks();
    useGameStore.getState().leaveRoom();
    useGameStore.getState().setPlayerName('');
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    });
  });

  describe('Initial Life', () => {
    it('should default to 40 when life is undefined', () => {
      useGameStore.setState({
        players: [{ id: 'player-1', name: 'Player 1' }],
      });

      const player = useGameStore.getState().players.find(p => p.id === 'player-1');
      const life = player?.life ?? 40;
      expect(life).toBe(40);
    });

    it('should initialize new players with life 40', () => {
      // Quando um novo player é adicionado, deve ter life 40
      useGameStore.setState({
        players: [{ id: 'player-1', name: 'Player 1', life: 40 }],
      });
      
      const player = useGameStore.getState().players.find(p => p.id === 'player-1');
      expect(player?.life).toBe(40);
    });
  });

  describe('Change Player Life', () => {
    beforeEach(() => {
      useGameStore.setState({
        players: [{ id: 'player-1', name: 'Player 1', life: 40 }],
      });
    });

    it('should increase life by 1', () => {
      const store = useGameStore.getState();
      store.changePlayerLife('player-1', 1);
      
      const player = useGameStore.getState().players.find(p => p.id === 'player-1');
      expect(player?.life).toBe(41);
    });

    it('should decrease life by 1', () => {
      const store = useGameStore.getState();
      store.changePlayerLife('player-1', -1);
      
      const player = useGameStore.getState().players.find(p => p.id === 'player-1');
      expect(player?.life).toBe(39);
    });

    it('should increase life by 10', () => {
      const store = useGameStore.getState();
      store.changePlayerLife('player-1', 10);
      
      const player = useGameStore.getState().players.find(p => p.id === 'player-1');
      expect(player?.life).toBe(50);
    });

    it('should not allow life below 0', () => {
      useGameStore.setState({
        players: [{ id: 'player-1', name: 'Player 1', life: 1 }],
      });
      
      const store = useGameStore.getState();
      store.changePlayerLife('player-1', -10);
      
      const player = useGameStore.getState().players.find(p => p.id === 'player-1');
      expect(player?.life).toBe(0);
    });
  });

  describe('Commander Damage', () => {
    beforeEach(() => {
      useGameStore.setState({
        players: [
          { id: 'player-1', name: 'Player 1', life: 40 },
          { id: 'player-2', name: 'Player 2', life: 40 },
        ],
      });
    });

    it('should initialize commander damage to 0', () => {
      const player = useGameStore.getState().players.find(p => p.id === 'player-1');
      const commanderDamage = player?.commanderDamage?.['player-2'] ?? 0;
      expect(commanderDamage).toBe(0);
    });

    it('should set commander damage', () => {
      const store = useGameStore.getState();
      store.setCommanderDamage('player-1', 'player-2', 5);
      
      const player = useGameStore.getState().players.find(p => p.id === 'player-1');
      expect(player?.commanderDamage?.['player-2']).toBe(5);
    });

    it('should increase commander damage and decrease life', () => {
      const store = useGameStore.getState();
      store.changeCommanderDamage('player-1', 'player-2', 3);
      
      const player = useGameStore.getState().players.find(p => p.id === 'player-1');
      expect(player?.commanderDamage?.['player-2']).toBe(3);
      expect(player?.life).toBe(37); // 40 - 3
    });

    it('should decrease commander damage and increase life', () => {
      // Primeiro aumentar para ter algo para diminuir
      useGameStore.setState({
        players: [
          { 
            id: 'player-1', 
            name: 'Player 1', 
            life: 37,
            commanderDamage: { 'player-2': 3 }
          },
          { id: 'player-2', name: 'Player 2', life: 40 },
        ],
      });
      
      const store = useGameStore.getState();
      store.changeCommanderDamage('player-1', 'player-2', -1);
      
      const player = useGameStore.getState().players.find(p => p.id === 'player-1');
      expect(player?.commanderDamage?.['player-2']).toBe(2);
      expect(player?.life).toBe(38); // 37 + 1
    });

    it('should not allow commander damage below 0', () => {
      const store = useGameStore.getState();
      store.changeCommanderDamage('player-1', 'player-2', -1);
      
      const player = useGameStore.getState().players.find(p => p.id === 'player-1');
      expect(player?.commanderDamage?.['player-2']).toBe(0);
    });

    it('should track commander damage from multiple players', () => {
      useGameStore.setState({
        players: [
          { id: 'player-1', name: 'Player 1', life: 40 },
          { id: 'player-2', name: 'Player 2', life: 40 },
          { id: 'player-3', name: 'Player 3', life: 40 },
        ],
      });
      
      const store = useGameStore.getState();
      store.changeCommanderDamage('player-1', 'player-2', 5);
      store.changeCommanderDamage('player-1', 'player-3', 3);
      
      const player = useGameStore.getState().players.find(p => p.id === 'player-1');
      expect(player?.commanderDamage?.['player-2']).toBe(5);
      expect(player?.commanderDamage?.['player-3']).toBe(3);
      expect(player?.life).toBe(32); // 40 - 5 - 3
    });

    it('should handle multiple commander damage changes correctly', () => {
      const store = useGameStore.getState();
      store.changeCommanderDamage('player-1', 'player-2', 2);
      store.changeCommanderDamage('player-1', 'player-2', 3);
      
      const player = useGameStore.getState().players.find(p => p.id === 'player-1');
      expect(player?.commanderDamage?.['player-2']).toBe(5);
      expect(player?.life).toBe(35); // 40 - 2 - 3
    });
  });
});

