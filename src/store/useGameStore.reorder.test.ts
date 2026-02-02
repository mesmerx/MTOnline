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

// Mock fetch para evitar chamadas reais à API
global.fetch = vi.fn();

import { useGameStore } from './useGameStore';

describe('Reorder hand functionality', () => {
  beforeEach(() => {
    wsControl.reset();
            vi.clearAllMocks();
    useGameStore.getState().leaveRoom();
    useGameStore.getState().setPlayerName('');
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    });
  });

  describe('reorderHandCard as host', () => {
    it('should reorder hand cards correctly using playerName', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wsControl.sockets.length).toBeGreaterThan(0);
      await openRoomAsHost(store, store.roomId);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar várias cartas à mão
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'hand-card-1',
            name: 'Card 1',
            ownerId: 'Host Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 0,
          },
          {
            id: 'hand-card-2',
            name: 'Card 2',
            ownerId: 'Host Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 1,
          },
          {
            id: 'hand-card-3',
            name: 'Card 3',
            ownerId: 'Host Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 2,
          },
        ],
      }));

      // Verificar ordem inicial
      let state = useGameStore.getState();
      let handCards = state.board
        .filter((c) => c.zone === 'hand' && c.ownerId === state.playerName)
        .sort((a, b) => (a.handIndex ?? 0) - (b.handIndex ?? 0));

      expect(handCards.length).toBe(3);
      expect(handCards[0].id).toBe('hand-card-1');
      expect(handCards[1].id).toBe('hand-card-2');
      expect(handCards[2].id).toBe('hand-card-3');

      // Reordenar: mover card-1 para o final (índice 2)
      store.reorderHandCard('hand-card-1', 2);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar nova ordem
      state = useGameStore.getState();
      handCards = state.board
        .filter((c) => c.zone === 'hand' && c.ownerId === state.playerName)
        .sort((a, b) => (a.handIndex ?? 0) - (b.handIndex ?? 0));

      expect(handCards.length).toBe(3);
      expect(handCards[0].id).toBe('hand-card-2');
      expect(handCards[1].id).toBe('hand-card-3');
      expect(handCards[2].id).toBe('hand-card-1');
      expect(handCards[2].handIndex).toBe(2);
    });

    it('should only reorder cards with ownerId matching playerName', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wsControl.sockets.length).toBeGreaterThan(0);
      await openRoomAsHost(store, store.roomId);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar outro player
      useGameStore.setState((s) => ({
        ...s,
        players: [
          ...s.players,
          { id: 'player-2', name: 'Other Player', life: 20 },
        ],
      }));

      // Adicionar cartas de ambos os players à mão
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'host-hand-1',
            name: 'Host Card 1',
            ownerId: 'Host Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 0,
          },
          {
            id: 'host-hand-2',
            name: 'Host Card 2',
            ownerId: 'Host Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 1,
          },
          {
            id: 'other-hand-1',
            name: 'Other Card 1',
            ownerId: 'Other Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 0,
          },
        ],
      }));

      // Reordenar carta do Host Player
      store.reorderHandCard('host-hand-1', 1);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que apenas as cartas do Host Player foram reordenadas
      const state = useGameStore.getState();
      const hostHandCards = state.board
        .filter((c) => c.zone === 'hand' && c.ownerId === 'Host Player')
        .sort((a, b) => (a.handIndex ?? 0) - (b.handIndex ?? 0));
      const otherHandCards = state.board
        .filter((c) => c.zone === 'hand' && c.ownerId === 'Other Player')
        .sort((a, b) => (a.handIndex ?? 0) - (b.handIndex ?? 0));

      expect(hostHandCards.length).toBe(2);
      expect(hostHandCards[0].id).toBe('host-hand-2');
      expect(hostHandCards[1].id).toBe('host-hand-1');
      expect(hostHandCards[1].handIndex).toBe(1);

      // Cartas do Other Player não devem ter sido afetadas
      expect(otherHandCards.length).toBe(1);
      expect(otherHandCards[0].id).toBe('other-hand-1');
      expect(otherHandCards[0].handIndex).toBe(0);
    });

    it('should not reorder if card is not in hand', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wsControl.sockets.length).toBeGreaterThan(0);
      await openRoomAsHost(store, store.roomId);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar carta ao battlefield (não na mão)
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'battlefield-card',
            name: 'Battlefield Card',
            ownerId: 'Host Player',
            zone: 'battlefield' as const,
            position: { x: 100, y: 100 },
            tapped: false,
          },
        ],
      }));

      const stateBefore = useGameStore.getState();
      const cardBefore = stateBefore.board.find((c) => c.id === 'battlefield-card');

      // Tentar reordenar (não deve fazer nada)
      store.reorderHandCard('battlefield-card', 0);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stateAfter = useGameStore.getState();
      const cardAfter = stateAfter.board.find((c) => c.id === 'battlefield-card');

      // A carta não deve ter sido alterada
      expect(cardAfter).toEqual(cardBefore);
    });

    it('should not reorder if card ownerId does not match playerName', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wsControl.sockets.length).toBeGreaterThan(0);
      await openRoomAsHost(store, store.roomId);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar outro player
      useGameStore.setState((s) => ({
        ...s,
        players: [
          ...s.players,
          { id: 'player-2', name: 'Other Player', life: 20 },
        ],
      }));

      // Adicionar carta do Other Player à mão
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'other-hand-card',
            name: 'Other Hand Card',
            ownerId: 'Other Player',
            zone: 'hand' as const,
            position: { x: 0, y: 0 },
            tapped: false,
            handIndex: 0,
          },
        ],
      }));

      const stateBefore = useGameStore.getState();
      const cardBefore = stateBefore.board.find((c) => c.id === 'other-hand-card');

      // Tentar reordenar carta do Other Player (não deve fazer nada)
      store.reorderHandCard('other-hand-card', 1);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stateAfter = useGameStore.getState();
      const cardAfter = stateAfter.board.find((c) => c.id === 'other-hand-card');

      // A carta não deve ter sido alterada
      expect(cardAfter).toEqual(cardBefore);
    });
  });

  describe('reorderHandCard maintains handIndex consistency', () => {
    it('should update all handIndex values sequentially after reorder', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wsControl.sockets.length).toBeGreaterThan(0);
      await openRoomAsHost(store, store.roomId);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar 5 cartas à mão
      const cards = Array.from({ length: 5 }, (_, i) => ({
        id: `hand-card-${i + 1}`,
        name: `Card ${i + 1}`,
        ownerId: 'Host Player',
        zone: 'hand' as const,
        position: { x: 0, y: 0 },
        tapped: false,
        handIndex: i,
      }));

      useGameStore.setState((s) => ({
        ...s,
        board: [...s.board, ...cards],
      }));

      // Reordenar: mover card-1 (índice 0) para o final (índice 4)
      store.reorderHandCard('hand-card-1', 4);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que todos os handIndex estão sequenciais
      const state = useGameStore.getState();
      const handCards = state.board
        .filter((c) => c.zone === 'hand' && c.ownerId === state.playerName)
        .sort((a, b) => (a.handIndex ?? 0) - (b.handIndex ?? 0));

      expect(handCards.length).toBe(5);
      handCards.forEach((card, index) => {
        expect(card.handIndex).toBe(index);
      });

      // Verificar ordem correta
      expect(handCards[0].id).toBe('hand-card-2');
      expect(handCards[1].id).toBe('hand-card-3');
      expect(handCards[2].id).toBe('hand-card-4');
      expect(handCards[3].id).toBe('hand-card-5');
      expect(handCards[4].id).toBe('hand-card-1');
    });
  });
});





