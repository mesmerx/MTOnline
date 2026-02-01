import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { useGameStore } from '../store/useGameStore';
import Board from './Board';

describe('Exile drag (browser)', () => {
  beforeEach(() => {
    useGameStore.setState({
      ...useGameStore.getState(),
      status: 'connected',
      isHost: true,
      playerId: 'p1',
      playerName: 't',
      players: [{ id: 'p1', name: 't' }],
      board: [],
      exilePositions: {},
    });
  });

  it('moves exile stack after drag', async () => {
    const { container } = render(<Board />);
    const stack = await waitFor(() => {
      const el = container.querySelector('.exile-stack') as HTMLElement | null;
      if (!el) throw new Error('Exile stack not found');
      return el;
    });

    fireEvent.pointerDown(stack, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(window, { clientX: 260, clientY: 260 });
    fireEvent.pointerUp(window, { clientX: 260, clientY: 260 });

    const pos = useGameStore.getState().exilePositions['t'];
    expect(pos).toBeDefined();
    expect(pos.x).not.toBe(0);
    expect(pos.y).not.toBe(0);
  });

  it('moves exile stack after drag in separated view', async () => {
    useGameStore.setState({
      ...useGameStore.getState(),
      viewMode: 'separated',
    });

    const { container } = render(<Board />);
    const stack = await waitFor(() => {
      const el = container.querySelector('.exile-stack') as HTMLElement | null;
      if (!el) throw new Error('Exile stack not found');
      return el;
    });

    fireEvent.pointerDown(stack, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(window, { clientX: 260, clientY: 260 });
    fireEvent.pointerUp(window, { clientX: 260, clientY: 260 });

    const pos = useGameStore.getState().exilePositions['t'];
    expect(pos).toBeDefined();
    expect(pos.x).not.toBe(0);
    expect(pos.y).not.toBe(0);
  });
});

