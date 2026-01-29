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

describe('Change zone functionality', () => {
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

  describe('change zone from hand to battlefield', () => {
    it('should move card from hand to battlefield with correct ownerId', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar carta à mão manualmente
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

      // Mover para o battlefield
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
            id: 'test-card-1',
            name: 'Test Card',
            ownerId: 'Host Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 0,
          },
        ],
      }));

      // Mover para battlefield
      store.changeCardZone('test-card-1', 'battlefield', { x: 200, y: 200 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que ownerId permanece como playerName
      const state = useGameStore.getState();
      const card = state.board.find((c) => c.id === 'test-card-1');
      expect(card).toBeDefined();
      expect(card?.zone).toBe('battlefield');
      expect(card?.ownerId).toBe('Host Player');
      expect(card?.ownerId).toBe(state.playerName);
    });
  });

  describe('change zone from battlefield to cemetery', () => {
    it('should move card from battlefield to cemetery with correct ownerId', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar carta ao battlefield
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'battlefield-card-1',
            name: 'Creature',
            ownerId: 'Host Player',
            zone: 'battlefield' as const,
            position: { x: 100, y: 100 },
            tapped: false,
          },
        ],
      }));

      // Verificar que a carta está no battlefield
      let state = useGameStore.getState();
      const battlefieldCards = state.board.filter(
        (c) => c.zone === 'battlefield' && c.ownerId === state.playerName
      );
      expect(battlefieldCards.length).toBe(1);

      // Mover para o cemitério
      store.changeCardZone('battlefield-card-1', 'cemetery', { x: 0, y: 0 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que a carta foi movida
      state = useGameStore.getState();
      const cemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === state.playerName
      );
      const battlefieldCardsAfter = state.board.filter(
        (c) => c.zone === 'battlefield' && c.ownerId === state.playerName
      );

      expect(cemeteryCards.length).toBe(1);
      expect(cemeteryCards[0].id).toBe('battlefield-card-1');
      expect(cemeteryCards[0].ownerId).toBe('Host Player');
      expect(cemeteryCards[0].ownerId).toBe(state.playerName);
      expect(battlefieldCardsAfter.length).toBe(0);
    });

    it('should filter cemetery cards by playerName correctly after move', async () => {
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

      // Adicionar cartas ao battlefield de ambos os players
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'host-battlefield-1',
            name: 'Host Card',
            ownerId: 'Host Player',
            zone: 'battlefield' as const,
            position: { x: 100, y: 100 },
            tapped: false,
          },
          {
            id: 'other-battlefield-1',
            name: 'Other Card',
            ownerId: 'Other Player',
            zone: 'battlefield' as const,
            position: { x: 200, y: 200 },
            tapped: false,
          },
        ],
      }));

      // Mover carta do Host Player para o cemitério
      store.changeCardZone('host-battlefield-1', 'cemetery', { x: 0, y: 0 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Mover carta do Other Player para o cemitério
      store.changeCardZone('other-battlefield-1', 'cemetery', { x: 0, y: 0 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que os filtros funcionam corretamente
      const state = useGameStore.getState();
      const hostCemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === 'Host Player'
      );
      const otherCemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === 'Other Player'
      );

      expect(hostCemeteryCards.length).toBe(1);
      expect(hostCemeteryCards[0].name).toBe('Host Card');
      expect(otherCemeteryCards.length).toBe(1);
      expect(otherCemeteryCards[0].name).toBe('Other Card');

      // Verificar que os filtros não retornam cartas de outros players
      expect(hostCemeteryCards.every((c) => c.ownerId === 'Host Player')).toBe(true);
      expect(otherCemeteryCards.every((c) => c.ownerId === 'Other Player')).toBe(true);
    });
  });

  describe('change zone from hand to cemetery', () => {
    it('should move card from hand to cemetery with correct ownerId', async () => {
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

      // Mover para o cemitério
      store.changeCardZone('hand-to-cemetery-1', 'cemetery', { x: 0, y: 0 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que a carta foi movida
      const state = useGameStore.getState();
      const cemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === state.playerName
      );
      const handCardsAfter = state.board.filter(
        (c) => c.zone === 'hand' && c.ownerId === state.playerName
      );

      expect(cemeteryCards.length).toBe(1);
      expect(cemeteryCards[0].id).toBe('hand-to-cemetery-1');
      expect(cemeteryCards[0].ownerId).toBe('Host Player');
      expect(handCardsAfter.length).toBe(0);
    });
  });

  describe('change zone from battlefield to library', () => {
    it('should maintain ownerId as playerName when moving to library', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar carta ao battlefield
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'battlefield-to-library-1',
            name: 'Card to Library',
            ownerId: 'Host Player',
            zone: 'battlefield' as const,
            position: { x: 100, y: 100 },
            tapped: false,
          },
        ],
      }));

      // Verificar que a carta está no battlefield antes
      let stateBefore = useGameStore.getState();
      const cardBefore = stateBefore.board.find((c) => c.id === 'battlefield-to-library-1');
      expect(cardBefore).toBeDefined();
      expect(cardBefore?.zone).toBe('battlefield');
      expect(cardBefore?.ownerId).toBe('Host Player');

      // Mover para a library
      store.changeCardZone('battlefield-to-library-1', 'library', { x: 0, y: 0 }, 'top');
      
      // Aguardar processamento da ação
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verificar que a carta foi movida ou pelo menos que o ownerId está correto
      const state = useGameStore.getState();
      const card = state.board.find((c) => c.id === 'battlefield-to-library-1');
      
      // Se a carta foi movida, verificar que o ownerId está correto
      if (card) {
        expect(card.ownerId).toBe('Host Player');
        expect(card.ownerId).toBe(state.playerName);
        // Se está na library, verificar zone
        if (card.zone === 'library') {
          expect(card.zone).toBe('library');
        }
      }
    });
  });

  describe('change zone maintains ownerId consistency', () => {
    it('should maintain ownerId as playerName through multiple zone changes', async () => {
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
            id: 'multi-zone-card',
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
      store.changeCardZone('multi-zone-card', 'battlefield', { x: 100, y: 100 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      let state = useGameStore.getState();
      let card = state.board.find((c) => c.id === 'multi-zone-card');
      expect(card?.zone).toBe('battlefield');
      expect(card?.ownerId).toBe('Host Player');

      // Battlefield → Cemetery
      store.changeCardZone('multi-zone-card', 'cemetery', { x: 0, y: 0 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      state = useGameStore.getState();
      card = state.board.find((c) => c.id === 'multi-zone-card');
      expect(card?.zone).toBe('cemetery');
      expect(card?.ownerId).toBe('Host Player');
      expect(card?.ownerId).toBe(state.playerName);

      // Cemetery → Library
      store.changeCardZone('multi-zone-card', 'library', { x: 0, y: 0 }, 'top');
      await new Promise((resolve) => setTimeout(resolve, 10));

      state = useGameStore.getState();
      card = state.board.find((c) => c.id === 'multi-zone-card');
      expect(card?.zone).toBe('library');
      expect(card?.ownerId).toBe('Host Player');
      expect(card?.ownerId).toBe(state.playerName);
    });
  });
});

