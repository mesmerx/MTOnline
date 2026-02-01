import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';

describe('Commander zone', () => {
  beforeEach(() => {
    useGameStore.getState().leaveRoom();
    useGameStore.getState().setPlayerName('CommanderPlayer');
  });

  it('sets a commander and moves it to commander zone', () => {
    const cardId = 'card-1';
    useGameStore.setState((s) => ({
      ...s,
      isHost: true,
      roomId: 'test-room',
      board: [
        {
          id: cardId,
          name: 'Legendary Hero',
          ownerId: 'CommanderPlayer',
          position: { x: 0, y: 0 },
          tapped: false,
          zone: 'battlefield',
        },
      ],
    }));

    useGameStore.getState().setCommander(cardId, { x: 10, y: 20 });

    const card = useGameStore.getState().board.find((c) => c.id === cardId);
    expect(card?.zone).toBe('commander');
    expect(card?.isCommander).toBe(true);
    expect(card?.commanderDeaths).toBe(0);
  });

  it('increments commander death count when sending from battlefield to commander zone', () => {
    const cardId = 'card-2';
    useGameStore.setState((s) => ({
      ...s,
      isHost: true,
      roomId: 'test-room',
      board: [
        {
          id: cardId,
          name: 'Legendary Champion',
          ownerId: 'CommanderPlayer',
          position: { x: 0, y: 0 },
          tapped: false,
          zone: 'battlefield',
          isCommander: true,
          commanderDeaths: 1,
        },
      ],
    }));

    useGameStore.getState().changeCardZone(cardId, 'commander', { x: 0, y: 0 });

    const card = useGameStore.getState().board.find((c) => c.id === cardId);
    expect(card?.zone).toBe('commander');
    expect(card?.commanderDeaths).toBe(2);
  });

  it('moves commander zone position', () => {
    useGameStore.setState((s) => ({
      ...s,
      isHost: true,
      roomId: 'test-room',
      commanderPositions: {
        CommanderPlayer: { x: 10, y: 20 },
      },
    }));

    useGameStore.getState().moveCommander('CommanderPlayer', { x: 200, y: 300 });

    const state = useGameStore.getState();
    expect(state.commanderPositions.CommanderPlayer).toEqual({ x: 200, y: 300 });
  });
});

