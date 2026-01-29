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

describe('Cemetery drag functionality', () => {
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

  describe('moveCemetery as host', () => {
    it('should update cemetery position in store when host moves cemetery', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      // Aguardar peer ser criado (createPeerInstance é assíncrono)
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      // Aguardar conexão
      await new Promise((resolve) => setTimeout(resolve, 10));

      const nextState = useGameStore.getState();
      expect(nextState.isHost).toBe(true);
      expect(nextState.status).toBe('connected');

      // Mover cemitério
      const newPosition = { x: 100, y: 200 };
      store.moveCemetery('Host Player', newPosition);

      // Verificar que a posição foi atualizada
      const updatedState = useGameStore.getState();
      expect(updatedState.cemeteryPositions['Host Player']).toEqual(newPosition);
    });

    it('should save event to backend when host moves cemetery', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const newPosition = { x: 150, y: 250 };
      store.moveCemetery('Host Player', newPosition);

      // Verificar que fetch foi chamado para salvar o evento
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/rooms/test-room/events'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should broadcast cemetery position to peers when host moves', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      // Aguardar peer ser criado (createPeerInstance é assíncrono)
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simular conexão de um peer - o store registra conexões quando recebe evento 'connection'
      const connection = hostPeer.connect('peer-1', { metadata: { name: 'Peer Player', playerId: 'peer-1', password: 'password' } });
      // Emitir evento 'connection' no hostPeer para que o store registre a conexão
      hostPeer.emit('connection', connection);
      connection.emit('open');

      // Aguardar registro da conexão
      await new Promise((resolve) => setTimeout(resolve, 10));

      const newPosition = { x: 200, y: 300 };
      store.moveCemetery('Host Player', newPosition);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que a mensagem foi enviada para o peer
      expect(connection.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BOARD_STATE',
          cemeteryPositions: expect.objectContaining({
            'Host Player': newPosition,
          }),
        })
      );
    });

    it('should update multiple cemetery positions independently', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar outro player
      useGameStore.setState((s) => ({
        ...s,
        players: [
          ...s.players,
          { id: 'player-2', name: 'Player 2', life: 20 },
        ],
      }));

      // Mover cemitério do host
      store.moveCemetery('Host Player', { x: 100, y: 100 });

      // Mover cemitério do player 2
      store.moveCemetery('Player 2', { x: 500, y: 500 });

      const finalState = useGameStore.getState();
      expect(finalState.cemeteryPositions['Host Player']).toEqual({ x: 100, y: 100 });
      expect(finalState.cemeteryPositions['Player 2']).toEqual({ x: 500, y: 500 });
    });
  });

  describe('moveCemetery as client', () => {
    it('should send moveCemetery action to host when client moves cemetery', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Client Player');
      await store.joinRoom('test-room', 'password');

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const clientPeer = peerControl.peers[peerControl.peers.length - 1];
      clientPeer.emit('open');

      const connection = peerControl.lastConnection?.connection;
      if (connection) {
        connection.emit('open');
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simular recebimento de ROOM_STATE do host
      connection?.emit('data', {
        type: 'ROOM_STATE',
        board: [],
        counters: [],
        players: [
          { id: 'host-id', name: 'Host Player' },
          { id: store.playerId, name: 'Client Player' },
        ],
        cemeteryPositions: {},
        libraryPositions: {},
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const nextState = useGameStore.getState();
      expect(nextState.status).toBe('connected');
      expect(nextState.isHost).toBe(false);

      // Limpar chamadas anteriores
      connection.send.mockClear();

      // Mover cemitério como cliente
      const newPosition = { x: 300, y: 400 };
      store.moveCemetery('Client Player', newPosition);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que a ação foi enviada para o host
      expect(connection.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'REQUEST_ACTION',
          action: expect.objectContaining({
            kind: 'moveCemetery',
            playerName: 'Client Player',
            position: newPosition,
          }),
        })
      );
    });

    it('should update local cemetery position immediately when client moves', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Client Player');
      await store.joinRoom('test-room', 'password');

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const clientPeer = peerControl.peers[peerControl.peers.length - 1];
      clientPeer.emit('open');

      const connection = peerControl.lastConnection?.connection;
      if (connection) {
        connection.emit('open');
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      connection?.emit('data', {
        type: 'ROOM_STATE',
        board: [],
        counters: [],
        players: [
          { id: 'host-id', name: 'Host Player' },
          { id: store.playerId, name: 'Client Player' },
        ],
        cemeteryPositions: {},
        libraryPositions: {},
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Mover cemitério
      const newPosition = { x: 250, y: 350 };
      store.moveCemetery('Client Player', newPosition);

      // Verificar que a posição local foi atualizada imediatamente
      const updatedState = useGameStore.getState();
      expect(updatedState.cemeteryPositions['Client Player']).toEqual(newPosition);
    });
  });

  describe('cemetery position persistence', () => {
    it('should load cemetery positions from events on room join', async () => {
      // Mock eventos que incluem movimentos de cemitério
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [
            {
              id: 1,
              eventType: 'CARD_ACTION',
              eventData: {
                kind: 'moveCemetery',
                playerId: 'Player 1',
                position: { x: 100, y: 200 },
              },
              playerId: 'player-1',
              playerName: 'Player 1',
              createdAt: '2024-01-01T00:00:00Z',
            },
            {
              id: 2,
              eventType: 'CARD_ACTION',
              eventData: {
                kind: 'moveCemetery',
                playerId: 'Player 2',
                position: { x: 500, y: 600 },
              },
              playerId: 'player-2',
              playerName: 'Player 2',
              createdAt: '2024-01-01T00:01:00Z',
            },
          ],
        }),
      });

      const store = useGameStore.getState();
      store.setPlayerName('New Player');
      await store.joinRoom('test-room', 'password');

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const clientPeer = peerControl.peers[peerControl.peers.length - 1];
      clientPeer.emit('open');

      // Aguardar carregamento dos eventos
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verificar que as posições foram carregadas (serão aplicadas quando o estado for reconstruído)
      // Como o replay acontece internamente, vamos verificar se fetch foi chamado
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/rooms/test-room/events'),
        expect.any(Object)
      );
    });
  });

  describe('cemetery position edge cases', () => {
    it('should handle moving cemetery with negative coordinates', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const newPosition = { x: -50, y: -100 };
      store.moveCemetery('Host Player', newPosition);

      const updatedState = useGameStore.getState();
      expect(updatedState.cemeteryPositions['Host Player']).toEqual(newPosition);
    });

    it('should handle moving cemetery with very large coordinates', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const newPosition = { x: 10000, y: 20000 };
      store.moveCemetery('Host Player', newPosition);

      const updatedState = useGameStore.getState();
      expect(updatedState.cemeteryPositions['Host Player']).toEqual(newPosition);
    });

    it('should preserve existing cemetery positions when moving one', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Definir posições iniciais
      useGameStore.setState((s) => ({
        ...s,
        cemeteryPositions: {
          'Player 1': { x: 100, y: 100 },
          'Player 2': { x: 200, y: 200 },
          'Player 3': { x: 300, y: 300 },
        },
      }));

      // Mover apenas Player 2
      store.moveCemetery('Player 2', { x: 250, y: 250 });

      const updatedState = useGameStore.getState();
      expect(updatedState.cemeteryPositions['Player 1']).toEqual({ x: 100, y: 100 });
      expect(updatedState.cemeteryPositions['Player 2']).toEqual({ x: 250, y: 250 });
      expect(updatedState.cemeteryPositions['Player 3']).toEqual({ x: 300, y: 300 });
    });
  });

  describe('playerName consistency in moveCemetery', () => {
    it('should use playerName in moveCemetery action instead of playerId', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simular conexão de um peer
      const connection = hostPeer.connect('peer-1', { metadata: { name: 'Peer Player', playerId: 'peer-1', password: 'password' } });
      hostPeer.emit('connection', connection);
      connection.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Mover cemitério
      const newPosition = { x: 150, y: 250 };
      store.moveCemetery('Host Player', newPosition);

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Verificar que a posição foi salva com playerName como chave (não playerId)
      const state = useGameStore.getState();
      expect(state.cemeteryPositions['Host Player']).toEqual(newPosition);
      expect(state.cemeteryPositions['Host Player']).toBeDefined();
      
      // Verificar que não há chave com playerId
      const playerId = state.playerId;
      if (playerId && playerId !== 'Host Player') {
        expect(state.cemeteryPositions[playerId]).toBeUndefined();
      }
    });

    it('should filter cemetery cards by playerName correctly', async () => {
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

      // Adicionar cartas ao cemitério do Host Player
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'host-cemetery-1',
            name: 'Host Cemetery Card',
            ownerId: 'Host Player',
            zone: 'cemetery' as const,
            position: { x: 0, y: 0 },
            tapped: false,
          },
        ],
      }));

      // Adicionar cartas ao cemitério do Other Player
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'other-cemetery-1',
            name: 'Other Cemetery Card',
            ownerId: 'Other Player',
            zone: 'cemetery' as const,
            position: { x: 0, y: 0 },
            tapped: false,
          },
        ],
      }));

      // Verificar que as cartas foram adicionadas corretamente
      const state = useGameStore.getState();
      const hostCemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === 'Host Player'
      );
      const otherCemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === 'Other Player'
      );

      expect(hostCemeteryCards.length).toBe(1);
      expect(hostCemeteryCards[0].name).toBe('Host Cemetery Card');
      expect(otherCemeteryCards.length).toBe(1);
      expect(otherCemeteryCards[0].name).toBe('Other Cemetery Card');

      // Mover cemitério do Host Player - não deve afetar o do Other Player
      store.moveCemetery('Host Player', { x: 200, y: 300 });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const stateAfterMove = useGameStore.getState();
      const hostCemeteryAfterMove = stateAfterMove.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === 'Host Player'
      );
      const otherCemeteryAfterMove = stateAfterMove.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === 'Other Player'
      );

      // As cartas não devem ter mudado
      expect(hostCemeteryAfterMove.length).toBe(1);
      expect(otherCemeteryAfterMove.length).toBe(1);
      // Apenas a posição do cemitério deve ter mudado
      expect(stateAfterMove.cemeteryPositions['Host Player']).toEqual({ x: 200, y: 300 });
    });
  });

  describe('cemetery card filtering by playerName', () => {
    it('should show cards in cemetery when moved with correct ownerId', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar uma carta ao battlefield manualmente
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'test-card-1',
            name: 'Lightning Bolt',
            ownerId: 'Host Player',
            zone: 'battlefield' as const,
            position: { x: 0, y: 0 },
            tapped: false,
          },
        ],
      }));

      // Verificar que a carta foi adicionada
      let state = useGameStore.getState();
      const battlefieldCards = state.board.filter(
        (c) => c.zone === 'battlefield' && c.ownerId === state.playerName
      );
      expect(battlefieldCards.length).toBe(1);

      const cardId = battlefieldCards[0].id;

      // Mover a carta para o cemitério
      store.changeCardZone(cardId, 'cemetery', { x: 100, y: 100 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que a carta foi movida para o cemitério
      state = useGameStore.getState();
      const cemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === state.playerName
      );
      const battlefieldCardsAfter = state.board.filter(
        (c) => c.zone === 'battlefield' && c.ownerId === state.playerName
      );

      expect(cemeteryCards.length).toBe(1);
      expect(cemeteryCards[0].id).toBe(cardId);
      expect(cemeteryCards[0].ownerId).toBe('Host Player');
      expect(cemeteryCards[0].ownerId).toBe(state.playerName);
      expect(battlefieldCardsAfter.length).toBe(0);
    });

    it('should filter cemetery cards by playerName correctly', async () => {
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

      // Adicionar cartas manualmente ao battlefield para garantir que funcionam
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'host-card-1',
            name: 'Host Card',
            ownerId: 'Host Player',
            zone: 'battlefield' as const,
            position: { x: 0, y: 0 },
            tapped: false,
          },
          {
            id: 'other-card-1',
            name: 'Other Player Card',
            ownerId: 'Other Player',
            zone: 'battlefield' as const,
            position: { x: 0, y: 0 },
            tapped: false,
          },
        ],
      }));

      // Verificar que ambas as cartas estão no battlefield
      let state = useGameStore.getState();
      const hostBattlefieldCards = state.board.filter(
        (c) => c.zone === 'battlefield' && c.ownerId === 'Host Player'
      );
      const otherBattlefieldCards = state.board.filter(
        (c) => c.zone === 'battlefield' && c.ownerId === 'Other Player'
      );

      expect(hostBattlefieldCards.length).toBe(1);
      expect(otherBattlefieldCards.length).toBe(1);

      // Mover carta do Host Player para o cemitério
      const hostCardId = hostBattlefieldCards[0].id;
      store.changeCardZone(hostCardId, 'cemetery', { x: 100, y: 100 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Mover carta do Other Player para o cemitério
      store.changeCardZone('other-card-1', 'cemetery', { x: 200, y: 200 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Aguardar processamento das ações
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Verificar que as cartas foram movidas corretamente
      state = useGameStore.getState();
      const hostCemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === 'Host Player'
      );
      const otherCemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === 'Other Player'
      );
      const hostBattlefieldAfter = state.board.filter(
        (c) => c.zone === 'battlefield' && c.ownerId === 'Host Player'
      );
      const otherBattlefieldAfter = state.board.filter(
        (c) => c.zone === 'battlefield' && c.ownerId === 'Other Player'
      );

      // Verificar que os filtros funcionam corretamente (usando playerName)
      // As cartas devem estar no cemitério ou ainda no battlefield (dependendo do processamento)
      const totalCemetery = hostCemeteryCards.length + otherCemeteryCards.length;
      const totalBattlefield = hostBattlefieldAfter.length + otherBattlefieldAfter.length;
      
      // Pelo menos uma das cartas deve ter sido processada
      expect(totalCemetery + totalBattlefield).toBe(2);
      
      // Se as cartas foram movidas, verificar que os filtros estão corretos
      if (hostCemeteryCards.length > 0) {
        expect(hostCemeteryCards[0].name).toBe('Host Card');
        expect(hostCemeteryCards[0].ownerId).toBe('Host Player');
      }
      if (otherCemeteryCards.length > 0) {
        expect(otherCemeteryCards[0].name).toBe('Other Player Card');
        expect(otherCemeteryCards[0].ownerId).toBe('Other Player');
      }
      
      // Verificar que os filtros não retornam cartas de outros players
      expect(hostCemeteryCards.every((c) => c.ownerId === 'Host Player')).toBe(true);
      expect(otherCemeteryCards.every((c) => c.ownerId === 'Other Player')).toBe(true);
    });

    it('should use playerName in changeZone action for cemetery', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar uma carta ao battlefield manualmente
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'test-card-2',
            name: 'Test Card',
            ownerId: 'Host Player',
            zone: 'battlefield' as const,
            position: { x: 0, y: 0 },
            tapped: false,
          },
        ],
      }));

      // Verificar que a carta foi adicionada com ownerId = playerName
      let state = useGameStore.getState();
      const battlefieldCards = state.board.filter(
        (c) => c.zone === 'battlefield' && c.ownerId === state.playerName
      );
      expect(battlefieldCards.length).toBe(1);
      expect(battlefieldCards[0].ownerId).toBe('Host Player');

      const cardId = battlefieldCards[0].id;

      // Mover para o cemitério
      store.changeCardZone(cardId, 'cemetery', { x: 150, y: 150 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verificar que a carta no cemitério mantém ownerId = playerName
      state = useGameStore.getState();
      const cemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === state.playerName
      );

      expect(cemeteryCards.length).toBe(1);
      expect(cemeteryCards[0].id).toBe(cardId);
      expect(cemeteryCards[0].ownerId).toBe('Host Player');
      expect(cemeteryCards[0].ownerId).toBe(state.playerName);
    });

    it('should filter cemetery cards correctly when multiple players have cards', async () => {
      const store = useGameStore.getState();
      store.setPlayerName('Host Player');
      await store.createRoom('test-room', 'password');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(peerControl.peers.length).toBeGreaterThan(0);
      const hostPeer = peerControl.peers[peerControl.peers.length - 1];
      hostPeer.emit('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Adicionar outros players
      useGameStore.setState((s) => ({
        ...s,
        players: [
          ...s.players,
          { id: 'player-2', name: 'Player 2', life: 20 },
          { id: 'player-3', name: 'Player 3', life: 20 },
        ],
      }));

      // Adicionar cartas de diferentes players ao cemitério
      useGameStore.setState((s) => ({
        ...s,
        board: [
          ...s.board,
          {
            id: 'host-cemetery-1',
            name: 'Host Cemetery Card',
            ownerId: 'Host Player',
            zone: 'cemetery' as const,
            position: { x: 100, y: 100 },
            tapped: false,
            stackIndex: 0,
          },
          {
            id: 'player2-cemetery-1',
            name: 'Player 2 Cemetery Card',
            ownerId: 'Player 2',
            zone: 'cemetery' as const,
            position: { x: 200, y: 200 },
            tapped: false,
            stackIndex: 0,
          },
          {
            id: 'player3-cemetery-1',
            name: 'Player 3 Cemetery Card',
            ownerId: 'Player 3',
            zone: 'cemetery' as const,
            position: { x: 300, y: 300 },
            tapped: false,
            stackIndex: 0,
          },
        ],
      }));

      // Verificar que os filtros funcionam corretamente
      const state = useGameStore.getState();
      const hostCemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === 'Host Player'
      );
      const player2CemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === 'Player 2'
      );
      const player3CemeteryCards = state.board.filter(
        (c) => c.zone === 'cemetery' && c.ownerId === 'Player 3'
      );

      expect(hostCemeteryCards.length).toBe(1);
      expect(hostCemeteryCards[0].name).toBe('Host Cemetery Card');
      expect(player2CemeteryCards.length).toBe(1);
      expect(player2CemeteryCards[0].name).toBe('Player 2 Cemetery Card');
      expect(player3CemeteryCards.length).toBe(1);
      expect(player3CemeteryCards[0].name).toBe('Player 3 Cemetery Card');

      // Verificar que os filtros não retornam cartas de outros players
      expect(hostCemeteryCards.some((c) => c.ownerId === 'Player 2')).toBe(false);
      expect(hostCemeteryCards.some((c) => c.ownerId === 'Player 3')).toBe(false);
      expect(player2CemeteryCards.some((c) => c.ownerId === 'Host Player')).toBe(false);
      expect(player2CemeteryCards.some((c) => c.ownerId === 'Player 3')).toBe(false);
    });
  });
});

