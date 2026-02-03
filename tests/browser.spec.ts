import { test, expect } from '@playwright/test';

const mockWebSocket = async (page: Parameters<typeof test>[0]['page']) => {
  await page.routeWebSocket('**', (ws) => {
    ws.onMessage((message) => {
      let payload: { type?: string } | null = null;
      try {
        payload = JSON.parse(message);
      } catch {
        return;
      }
      if (!payload?.type) return;

      if (payload.type === 'room:create') {
        ws.send(JSON.stringify({ type: 'room:created' }));
      }
      if (payload.type === 'room:join') {
        ws.send(JSON.stringify({ type: 'room:joined' }));
      }
    });
  });
};

const waitForConnected = async (page: Parameters<typeof test>[0]['page']) => {
  await page.waitForFunction(() => {
    const store = (window as unknown as { __GAME_STORE__?: { getState?: () => { status?: string } } }).__GAME_STORE__;
    return store?.getState?.().status === 'connected';
  });
};

test.describe('Board (playwright)', () => {
  test.beforeEach(async ({ page }) => {
    await mockWebSocket(page);
    await page.route('**/me', (route) => route.fulfill({ status: 401, body: '{}', contentType: 'application/json' }));
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as { __GAME_STORE__?: unknown }).__GAME_STORE__);
    await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('t');
      state?.createRoom?.('test-room', '');
    });
    await waitForConnected(page);
    await page.evaluate(() => {
      const minimize = document.querySelector('.menu-bar .menu-minimize') as HTMLButtonElement | null;
      minimize?.click();
    });
  });

  test('moves exile stack after drag', async ({ page }) => {
    const stack = page.locator('.exile-stack').first();
    await expect(stack).toBeVisible();

    const box = await stack.boundingBox();
    if (!box) {
      throw new Error('Exile stack not found');
    }

    const startX = box.x + 10;
    const startY = box.y + 10;
    const endX = box.x + 80;
    const endY = box.y + 80;

    await page.dispatchEvent('.exile-stack', 'pointerdown', { clientX: startX, clientY: startY, button: 0 });
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, button: 0 }));
    }, { x: endX, y: endY });
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0 }));
    }, { x: endX, y: endY });

    await page.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const pos = store?.getState?.().exilePositions?.t;
      return pos && (pos.x !== 0 || pos.y !== 0);
    });

    const pos = await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return store?.getState?.().exilePositions?.t;
    });
    expect(pos).toBeDefined();
  });

  test('moves cemetery stack after drag', async ({ page }) => {
    const stack = page.locator('.cemetery-stack').first();
    await expect(stack).toBeVisible();

    const box = await stack.boundingBox();
    if (!box) {
      throw new Error('Cemetery stack not found');
    }

    const startX = box.x + 10;
    const startY = box.y + 10;
    const endX = box.x + 80;
    const endY = box.y + 80;

    await page.dispatchEvent('.cemetery-stack', 'pointerdown', { clientX: startX, clientY: startY, button: 0 });
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, button: 0 }));
    }, { x: endX, y: endY });
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0 }));
    }, { x: endX, y: endY });

    await page.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const pos = store?.getState?.().cemeteryPositions?.t;
      return pos && (pos.x !== 0 || pos.y !== 0);
    });
  });

  test('moves commander stack after drag', async ({ page }) => {
    const stack = page.locator('.commander-stack').first();
    await expect(stack).toBeVisible();

    const box = await stack.boundingBox();
    if (!box) {
      throw new Error('Commander stack not found');
    }

    const startX = box.x + 10;
    const startY = box.y + 10;
    const endX = box.x + 90;
    const endY = box.y + 90;

    await page.dispatchEvent('.commander-stack', 'pointerdown', { clientX: startX, clientY: startY, button: 0 });
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, button: 0 }));
    }, { x: endX, y: endY });
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0 }));
    }, { x: endX, y: endY });

    await page.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const pos = store?.getState?.().commanderPositions?.t;
      return pos && (pos.x !== 0 || pos.y !== 0);
    });
  });

  test('moves tokens stack after drag', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { setState?: (fn: any) => void } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: [
          {
            id: 'token-1',
            name: 'Treasure',
            ownerId: 't',
            position: { x: 0, y: 0 },
            tapped: false,
            zone: 'tokens',
            stackIndex: 0,
          },
        ],
        tokensPositions: {
          t: { x: 20, y: 200 },
        },
      }));
    });

    const stack = page.locator('.tokens-stack').first();
    await expect(stack).toBeVisible();

    const box = await stack.boundingBox();
    if (!box) {
      throw new Error('Tokens stack not found');
    }

    const startX = box.x + 10;
    const startY = box.y + 10;
    const endX = box.x + 80;
    const endY = box.y + 80;

    await page.dispatchEvent('.tokens-stack', 'pointerdown', { clientX: startX, clientY: startY, button: 0 });
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, button: 0 }));
    }, { x: endX, y: endY });
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0 }));
    }, { x: endX, y: endY });

    await page.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const pos = store?.getState?.().tokensPositions?.t;
      return pos && (pos.x !== 20 || pos.y !== 200);
    });
  });

  test('adds token copy to battlefield from tokens search', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { setState?: (fn: any) => void } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: [
          {
            id: 'token-1',
            name: 'Treasure',
            ownerId: 't',
            position: { x: 0, y: 0 },
            tapped: false,
            zone: 'tokens',
            stackIndex: 0,
          },
        ],
        tokensPositions: {
          t: { x: 20, y: 200 },
        },
      }));
    });

    await page.evaluate(() => {
      const button = document.querySelector('[data-testid="tokens-search-button-t"]') as HTMLButtonElement | null;
      button?.click();
    });
    await page.getByRole('heading', { name: '🔍 Search Token' }).waitFor();
    await page.getByRole('button', { name: '➕ Add to battlefield' }).click();

    await page.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      const battlefieldCopies = state?.board?.filter?.((c: any) => c.name === 'Treasure' && c.zone === 'battlefield') || [];
      const tokens = state?.board?.filter?.((c: any) => c.name === 'Treasure' && c.zone === 'tokens') || [];
      return battlefieldCopies.length === 1 && tokens.length === 1;
    });
  });

  test('double click on battlefield card toggles tap', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { setState?: (fn: any) => void } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: [
          {
            id: 'tap-test-1',
            name: 'Tap Test Card',
            ownerId: 't',
            position: { x: 300, y: 300 },
            tapped: false,
            zone: 'battlefield',
            isCommander: false,
            commanderDeaths: 0,
            imageUrl: 'https://example.com/tap-test.png',
          },
        ],
      }));
    });

    const card = page.locator('.card-token', { has: page.locator('img[alt="Tap Test Card"]') }).first();
    await expect(card).toBeVisible();
    await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      store?.getState?.().toggleTap?.('tap-test-1');
    });

    await page.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const cardState = store?.getState?.().board?.find?.((c: any) => c.id === 'tap-test-1');
      return !!cardState?.tapped;
    });
  });

  test('shift-dragging commander card moves card, not commander zone', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any; setState?: (fn: any) => void } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: [
          {
            id: 'commander-card-1',
            name: 'Commander Card',
            ownerId: 't',
            position: { x: 40, y: 40 },
            tapped: false,
            zone: 'commander',
            isCommander: true,
            commanderDeaths: 0,
            stackIndex: 0,
          },
        ],
        commanderPositions: {
          t: { x: 20, y: 20 },
        },
      }));
    });

    const card = page.locator('.commander-stack .card-token').first();
    await expect(card).toBeVisible();

    const box = await card.boundingBox();
    if (!box) {
      throw new Error('Commander card not found');
    }

    const startX = box.x + 10;
    const startY = box.y + 10;
    const endX = box.x + 90;
    const endY = box.y + 90;

    await page.dispatchEvent('.commander-stack .card-token', 'pointerdown', { clientX: startX, clientY: startY, button: 0, shiftKey: true });
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, button: 0, shiftKey: true }));
    }, { x: endX, y: endY });
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0, shiftKey: true }));
    }, { x: endX, y: endY });

    await page.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      const pos = state?.commanderPositions?.t;
      const card = state?.board?.find?.((c: any) => c.id === 'commander-card-1');
      return pos?.x === 20 && pos?.y === 20 && card?.position && (card.position.x !== 40 || card.position.y !== 40);
    });
  });

  test('renders library stack after replaceLibrary', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      store?.getState?.().replaceLibrary([
        { name: 'Birds of Paradise' },
        { name: 'Island' },
        { name: 'Forest' },
      ]);
    });

    await expect(page.getByTestId('library-t')).toBeVisible();
  });

  test('selects deck top card and draws on double click', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { setState?: (fn: any) => void } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: [
          {
            id: 'lib-1',
            name: 'Library Top',
            ownerId: 't',
            position: { x: 0, y: 0 },
            tapped: false,
            zone: 'library',
            stackIndex: 2,
          },
          {
            id: 'lib-2',
            name: 'Library Second',
            ownerId: 't',
            position: { x: 0, y: 0 },
            tapped: false,
            zone: 'library',
            stackIndex: 1,
          },
        ],
        libraryPositions: {
          t: { x: 40, y: 40 },
        },
      }));
    });

    const stack = page.getByTestId('library-t');
    await expect(stack).toBeVisible();
    const topCard = stack.locator('.card-token').first();
    await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      store?.getState?.().drawFromLibrary?.();
    });

    await page.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      return state?.board?.some?.((c: any) => c.id === 'lib-1' && c.zone === 'hand');
    });
  });
});

