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

describe('Hand drag to change zone functionality', () => {
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

  describe('drag from hand to battlefield', () => {
    it('should move card from hand to battlefield when dragged out', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar carta à mão
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'hand-card-1',
            name: 'Lightning Bolt',
            ownerId: 'Host Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 0,
          },
        ],
      }));

      // Verificar que a carta está na mão
      let state = useGameStore.getState();
      const handCards = state.board.filter(
        (c) => c.zone === 'hand' && c.ownerId === state.playerName
      );
      expect(handCards.length).toBe(1);
      expect(handCards[0].ownerId).toBe('Host Player');

      // Mover para o battlefield (simulando drag para fora da hand)
      store.changeCardZone('hand-card-1', 'battlefield', { x: 100, y: 100 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que a carta foi movida
      state = useGameStore.getState();
      const battlefieldCards = state.board.filter(
        (c) => c.zone === 'battlefield' && c.ownerId === state.playerName
      );
      const handCardsAfter = state.board.filter(
        (c) => c.zone === 'hand' && c.ownerId === state.playerName
      );

      expect(battlefieldCards.length).toBe(1);
      expect(battlefieldCards[0].id).toBe('hand-card-1');
      expect(battlefieldCards[0].ownerId).toBe('Host Player');
      expect(battlefieldCards[0].ownerId).toBe(state.playerName);
      expect(handCardsAfter.length).toBe(0);
    });

    it('should maintain ownerId as playerName when moving from hand to battlefield', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar carta à mão
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'hand-to-battlefield-1',
            name: 'Creature',
            ownerId: 'Host Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 0,
          },
        ],
      }));

      // Mover para battlefield
      store.changeCardZone('hand-to-battlefield-1', 'battlefield', { x: 200, y: 200 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que ownerId permanece como playerName
      const state = useGameStore.getState();
      const card = state.board.find((c) => c.id === 'hand-to-battlefield-1');
      expect(card).toBeDefined();
      expect(card?.zone).toBe('battlefield');
      expect(card?.ownerId).toBe('Host Player');
      expect(card?.ownerId).toBe(state.playerName);
    });
  });

  describe('drag from hand to cemetery', () => {
    it('should move card from hand to cemetery when dragged out', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar carta à mão
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'hand-to-cemetery-1',
            name: 'Card to Discard',
            ownerId: 'Host Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 0,
          },
        ],
      }));

      // Verificar que a carta está na mão
      let state = useGameStore.getState();
      const handCards = state.board.filter(
        (c) => c.zone === 'hand' && c.ownerId === state.playerName
      );
      expect(handCards.length).toBe(1);

      // Mover para o cemitério
      store.changeCardZone('hand-to-cemetery-1', 'cemetery', { x: 0, y: 0 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que a carta foi movida
      state = useGameStore.getState();
      const cemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === state.playerName
      );
      const handCardsAfter = state.board.filter(
        (c) => c.zone === 'hand' && c.ownerId === state.playerName
      );

      expect(cemeteryCards.length).toBe(1);
      expect(cemeteryCards[0].id).toBe('hand-to-cemetery-1');
      expect(cemeteryCards[0].ownerId).toBe('Host Player');
      expect(cemeteryCards[0].ownerId).toBe(state.playerName);
      expect(handCardsAfter.length).toBe(0);
    });

    it('should maintain ownerId as playerName when moving from hand to cemetery', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar carta à mão
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'hand-cemetery-test',
            name: 'Test Card',
            ownerId: 'Host Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 0,
          },
        ],
      }));

      // Mover para cemitério
      store.changeCardZone('hand-cemetery-test', 'cemetery', { x: 0, y: 0 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que ownerId permanece como playerName
      const state = useGameStore.getState();
      const card = state.board.find((c) => c.id === 'hand-cemetery-test');
      expect(card).toBeDefined();
      expect(card?.zone).toBe('cemetery');
      expect(card?.ownerId).toBe('Host Player');
      expect(card?.ownerId).toBe(state.playerName);
    });
  });

  describe('drag from hand to library', () => {
    it('should move card from hand to library when dragged out', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar carta à mão
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'hand-to-library-1',
            name: 'Card to Library',
            ownerId: 'Host Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 0,
          },
        ],
      }));

      // Verificar que a carta está na mão
      let state = useGameStore.getState();
      const handCards = state.board.filter(
        (c) => c.zone === 'hand' && c.ownerId === state.playerName
      );
      expect(handCards.length).toBe(1);

      // Mover para a library
      store.changeCardZone('hand-to-library-1', 'library', { x: 0, y: 0 }, 'top');
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que a carta foi movida
      state = useGameStore.getState();
      const libraryCards = state.board.filter(
        (c) => c.zone === 'library' && c.ownerId === state.playerName
      );
      const handCardsAfter = state.board.filter(
        (c) => c.zone === 'hand' && c.ownerId === state.playerName
      );

      expect(libraryCards.length).toBe(1);
      expect(libraryCards[0].id).toBe('hand-to-library-1');
      expect(libraryCards[0].ownerId).toBe('Host Player');
      expect(libraryCards[0].ownerId).toBe(state.playerName);
      expect(handCardsAfter.length).toBe(0);
    });
  });

  describe('drag from hand maintains ownerId consistency', () => {
    it('should maintain ownerId as playerName through hand to battlefield to cemetery', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar carta à mão
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'hand-multi-zone',
            name: 'Multi Zone Card',
            ownerId: 'Host Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 0,
          },
        ],
      }));

      // Hand → Battlefield
      store.changeCardZone('hand-multi-zone', 'battlefield', { x: 100, y: 100 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      let state = useGameStore.getState();
      let card = state.board.find((c) => c.id === 'hand-multi-zone');
      expect(card?.zone).toBe('battlefield');
      expect(card?.ownerId).toBe('Host Player');
      expect(card?.ownerId).toBe(state.playerName);

      // Battlefield → Cemetery
      store.changeCardZone('hand-multi-zone', 'cemetery', { x: 0, y: 0 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      state = useGameStore.getState();
      card = state.board.find((c) => c.id === 'hand-multi-zone');
      expect(card?.zone).toBe('cemetery');
      expect(card?.ownerId).toBe('Host Player');
      expect(card?.ownerId).toBe(state.playerName);
    });

    it('should filter cards correctly after moving from hand to battlefield', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar outro player
      useGameStore.setState((s) => ({
        ...s,
        players: [
          ...s.players,
          { id: 'player-2', name: 'Other Player', life: 20 },
        ],
      }));

      // Adicionar cartas à mão de ambos os players
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'host-hand-1',
            name: 'Host Hand Card',
            ownerId: 'Host Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 0,
          },
          {
            id: 'other-hand-1',
            name: 'Other Hand Card',
            ownerId: 'Other Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 0,
          },
        ],
      }));

      // Mover carta do Host Player para o battlefield
      store.changeCardZone('host-hand-1', 'battlefield', { x: 100, y: 100 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que os filtros funcionam corretamente
      const state = useGameStore.getState();
      const hostBattlefieldCards = state.board.filter(
        (c) => c.zone === 'battlefield' && c.ownerId === 'Host Player'
      );
      const hostHandCards = state.board.filter(
        (c) => c.zone === 'hand' && c.ownerId === 'Host Player'
      );
      const otherHandCards = state.board.filter(
        (c) => c.zone === 'hand' && c.ownerId === 'Other Player'
      );

      expect(hostBattlefieldCards.length).toBe(1);
      expect(hostBattlefieldCards[0].name).toBe('Host Hand Card');
      expect(hostHandCards.length).toBe(0);
      expect(otherHandCards.length).toBe(1);
      expect(otherHandCards[0].name).toBe('Other Hand Card');

      // Verificar que os filtros não retornam cartas de outros players
      expect(hostBattlefieldCards.every((c) => c.ownerId === 'Host Player')).toBe(true);
      expect(otherHandCards.every((c) => c.ownerId === 'Other Player')).toBe(true);
    });
  });
});



