import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useGameStore } from '../store/useGameStore';
import Board from './Board';

describe('Library render (browser)', () => {
  beforeEach(() => {
    useGameStore.setState({
      ...useGameStore.getState(),
      status: 'idle',
      isHost: false,
      hostConnection: undefined,
      playerId: 'p1',
      playerName: 't',
      players: [{ id: 'p1', name: 't' }],
      board: [],
    });
  });

  it('shows library stack after replaceLibrary in offline mode', async () => {
    const { replaceLibrary } = useGameStore.getState();
    replaceLibrary([
      { name: 'Birds of Paradise' },
      { name: 'Island' },
      { name: 'Forest' },
    ]);

    render(<Board />);

    await waitFor(() => {
      expect(screen.getByTestId('library-t')).toBeInTheDocument();
    });
  });
});





