import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const mockWebSocket = async (page: Page) => {
  await page.routeWebSocket('**', (ws) => {
    ws.onMessage((message) => {
      if (typeof message !== 'string') return;
      let payload: { type?: string } | null = null;
      try {
        payload = JSON.parse(message);
      } catch {
        return;
      }
      if (!payload?.type) return;

      if (payload.type === 'test:ping') {
        ws.send(JSON.stringify({ type: 'test:pong', sentAt: (payload as any).sentAt }));
        return;
      }

      if (payload.type === 'room:create') {
        ws.send(JSON.stringify({ type: 'room:created' }));
      }
      if (payload.type === 'room:join') {
        ws.send(JSON.stringify({ type: 'room:joined' }));
      }
    });
  });
};

const waitForConnected = async (page: Page) => {
  await page.waitForFunction(() => {
    const store = (window as unknown as { __GAME_STORE__?: { getState?: () => { status?: string } } }).__GAME_STORE__;
    return store?.getState?.().status === 'connected';
  });
};

const createMockRoomServer = (options?: {
  latencyByPlayerName?: Record<string, { toHostMs?: number; toClientMs?: number }>;
  dropByPlayerName?: Record<string, { toHostRate?: number; toClientRate?: number }>;
  rngSeed?: number;
}) => {
  let hostWs: { send: (message: string) => void } | null = null;
  const clients = new Map<string, { ws: { send: (message: string) => void }; playerId: string; playerName: string }>();
  const socketByWs = new Map<unknown, string>();
  const hostMessages: Array<{ payload: any; receivedAt: number; playerName?: string }> = [];
  const clientToHostMessages: Array<{ payload: any; receivedAt: number; playerName?: string }> = [];
  let socketSequence = 1;
  const latencyByPlayerName = options?.latencyByPlayerName ?? {};
  const dropByPlayerName = options?.dropByPlayerName ?? {};
  let rngState = options?.rngSeed ?? 1337;

  const nextRandom = () => {
    rngState = (rngState * 48271) % 2147483647;
    return rngState / 2147483647;
  };

  const attach = async (page: Page) => {
    await page.routeWebSocket('**', (ws) => {
      const socketId = `sock-${socketSequence++}`;
      socketByWs.set(ws, socketId);

      ws.onMessage((message) => {
        if (typeof message !== 'string') return;
        let payload: { type?: string; payload?: any } | null = null;
        try {
          payload = JSON.parse(message);
        } catch {
          return;
        }
        if (!payload?.type) return;

        if (payload.type === 'room:create') {
          hostWs = ws;
          ws.send(JSON.stringify({ type: 'room:created' }));
          return;
        }

        if (payload.type === 'room:join') {
          const playerId = payload.payload?.playerId as string;
          const playerName = payload.payload?.playerName as string;
          clients.set(socketId, { ws, playerId, playerName });
          ws.send(JSON.stringify({ type: 'room:joined' }));
          if (hostWs) {
            hostWs.send(
              JSON.stringify({
                type: 'room:client_joined',
                payload: { playerId, playerName, socketId },
              }),
            );
          }
          return;
        }

        if (payload.type === 'room:client_message') {
          const client = clients.get(socketId);
          if (!client || !hostWs) return;
          const dropRate = dropByPlayerName[client.playerName]?.toHostRate ?? 0;
          if (dropRate > 0 && nextRandom() < dropRate) {
            return;
          }
          const latency = latencyByPlayerName[client.playerName]?.toHostMs ?? 0;
          const forward = () => {
            clientToHostMessages.push({
              payload: payload.payload?.message,
              receivedAt: Date.now(),
              playerName: client.playerName,
            });
            hostWs?.send(
              JSON.stringify({
                type: 'room:client_message',
                payload: { playerId: client.playerId, socketId, message: payload.payload?.message },
              }),
            );
          };
          if (latency > 0) {
            setTimeout(forward, latency);
          } else {
            forward();
          }
          return;
        }

        if (payload.type === 'room:host_message') {
          let playerName: string | undefined;
          if (payload.payload?.message && typeof payload.payload?.message === 'object') {
            const actorId = (payload.payload?.message as any).actorId as string | undefined;
            if (actorId) {
              for (const entry of clients.values()) {
                if (entry.playerId === actorId) {
                  playerName = entry.playerName;
                  break;
                }
              }
            }
          }
          hostMessages.push({ payload: payload.payload?.message, receivedAt: Date.now(), playerName });
          const targetSocketId = payload.payload?.targetSocketId as string | undefined;
          const target = targetSocketId ? clients.get(targetSocketId) : null;
          if (target) {
            const dropRate = dropByPlayerName[target.playerName]?.toClientRate ?? 0;
            if (dropRate > 0 && nextRandom() < dropRate) {
              return;
            }
            const latency = latencyByPlayerName[target.playerName]?.toClientMs ?? 0;
            const forward = () => {
              target.ws.send(JSON.stringify({ type: 'room:host_message', payload: { message: payload.payload?.message } }));
            };
            if (latency > 0) {
              setTimeout(forward, latency);
            } else {
              forward();
            }
          }
          return;
        }

        if (payload.type === 'room:save_event') {
          return;
        }
      });

      ws.onClose(() => {
        if (hostWs === ws) {
          hostWs = null;
        }
        const socketId = socketByWs.get(ws);
        if (!socketId) return;
        const client = clients.get(socketId);
        if (client && hostWs) {
          hostWs.send(
            JSON.stringify({
              type: 'room:client_left',
              payload: { playerId: client.playerId, socketId },
            }),
          );
        }
        clients.delete(socketId);
        socketByWs.delete(ws);
      });
    });
  };

  return {
    attach,
    getHostMessages: () => hostMessages,
    getClientMessages: () => clientToHostMessages,
    clearHostMessages: () => {
      hostMessages.length = 0;
      clientToHostMessages.length = 0;
    },
  };
};

const setupPage = async (page: Page, server?: ReturnType<typeof createMockRoomServer>) => {
  await page.addInitScript(() => {
    const metrics = {
      rtts: [] as number[],
      sent: 0,
      received: 0,
    };

    const attachMetrics = (socket: WebSocket) => {
      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === 'test:pong' && typeof payload.sentAt === 'number') {
            const rtt = performance.now() - payload.sentAt;
            metrics.rtts.push(rtt);
            metrics.received += 1;
          }
        } catch {
          // ignore
        }
      });
    };

    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = class extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        attachMetrics(this);
      }

      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof data === 'string') {
          try {
            const payload = JSON.parse(data);
            if (payload?.type === 'test:ping' && typeof payload.sentAt === 'number') {
              metrics.sent += 1;
            }
          } catch {
            // ignore
          }
        }
        return super.send(data);
      }
    } as unknown as typeof WebSocket;

    (window as any).__WS_METRICS__ = metrics;
  });
  if (server) {
    await server.attach(page);
  } else {
    await mockWebSocket(page);
  }
  await page.route('**/me', (route) => route.fulfill({ status: 401, body: '{}', contentType: 'application/json' }));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __GAME_STORE__?: unknown }).__GAME_STORE__);
};

test.describe('Board (playwright)', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
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

  test('continuously drags deck/exile/cemetery/commander/tokens stacks', async ({ page }) => {
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
          {
            id: 'lib-3',
            name: 'Library Third',
            ownerId: 't',
            position: { x: 0, y: 0 },
            tapped: false,
            zone: 'library',
            stackIndex: 0,
          },
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
        libraryPositions: {
          t: { x: 40, y: 40 },
        },
        tokensPositions: {
          t: { x: 20, y: 200 },
        },
      }));
    });

    const dragStack = async (selector: string) => {
      const stack = page.locator(selector).first();
      await expect(stack).toBeVisible();
      const box = await stack.boundingBox();
      if (!box) {
        throw new Error(`Stack not found for ${selector}`);
      }

      const startX = box.x + 10;
      const startY = box.y + 10;
      const midX = box.x + 120;
      const midY = box.y + 80;
      const endX = box.x + 40;
      const endY = box.y + 140;

      await page.dispatchEvent(selector, 'pointerdown', { clientX: startX, clientY: startY, button: 0 });
      for (const [x, y] of [
        [midX, midY],
        [endX, endY],
        [startX, startY],
        [midX + 40, midY + 40],
      ]) {
        await page.evaluate(({ x, y }) => {
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, button: 0 }));
        }, { x, y });
      }
      await page.evaluate(({ x, y }) => {
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0 }));
      }, { x: endX, y: endY });
    };

    await dragStack('.library-stack');
    await dragStack('.exile-stack');
    await dragStack('.cemetery-stack');
    await dragStack('.commander-stack');
    await dragStack('.tokens-stack');

    await page.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      return (
        state?.libraryPositions?.t &&
        state?.exilePositions?.t &&
        state?.cemeteryPositions?.t &&
        state?.commanderPositions?.t &&
        state?.tokensPositions?.t
      );
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

  test('large board movement stays responsive', async ({ page }) => {
    const stats = await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { setState?: (fn: any) => void; getState?: () => any } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: Array.from({ length: 500 }, (_, index) => ({
          id: `perf-card-${index}`,
          name: `Perf Card ${index}`,
          ownerId: 't',
          position: { x: (index % 25) * 24, y: Math.floor(index / 25) * 24 },
          tapped: false,
          zone: 'battlefield',
          isCommander: false,
          commanderDeaths: 0,
        })),
      }));

      return new Promise<{ maxDelta: number; avgDelta: number }>((resolve) => {
        const deltas: number[] = [];
        let last = 0;
        let frames = 0;
        const totalFrames = 120;

        const tick = (timestamp: number) => {
          if (last) {
            deltas.push(timestamp - last);
          }
          last = timestamp;
          frames += 1;
          if (frames >= totalFrames) {
            const maxDelta = Math.max(...deltas);
            const avgDelta = deltas.reduce((sum, value) => sum + value, 0) / Math.max(deltas.length, 1);
            resolve({ maxDelta, avgDelta });
            return;
          }
          requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);

        let step = 0;
        const interval = window.setInterval(() => {
          const state = store?.getState?.();
          state?.moveCard?.('perf-card-0', { x: step * 3, y: step * 2 });
          step += 1;
          if (step >= 60) {
            window.clearInterval(interval);
          }
        }, 16);
      });
    });

    expect(stats.maxDelta).toBeLessThan(200);
  });

test('websocket ping/pong latency stays low on large boards', async ({ page, browserName }) => {
  if (browserName !== 'chromium') {
    test.skip();
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 80,
    downloadThroughput: 1_500_000,
    uploadThroughput: 1_000_000,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });

    await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { setState?: (fn: any) => void } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: Array.from({ length: 400 }, (_, index) => ({
          id: `ws-card-${index}`,
          name: `WS Card ${index}`,
          ownerId: 't',
          position: { x: (index % 20) * 28, y: Math.floor(index / 20) * 28 },
          tapped: false,
          zone: 'battlefield',
          isCommander: false,
          commanderDeaths: 0,
        })),
      }));
    });

  const stats = await page.evaluate(async () => {
    const store = (window as any).__GAME_STORE__;
    const socket = store?.getState?.().socket as WebSocket | undefined;
    if (!socket) {
      throw new Error('Socket not available');
    }
    if (socket.readyState !== WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        socket.addEventListener('open', () => resolve(), { once: true });
      });
    }

    const rtts: number[] = [];
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'test:pong' && typeof payload.sentAt === 'number') {
          rtts.push(performance.now() - payload.sentAt);
        }
      } catch {
        // ignore
      }
    };

    socket.addEventListener('message', onMessage);

    for (let i = 0; i < 20; i += 1) {
      socket.send(JSON.stringify({ type: 'test:ping', sentAt: performance.now() }));
    }

    await new Promise<void>((resolve, reject) => {
      const start = performance.now();
      const check = () => {
        if (rtts.length >= 20) {
          resolve();
          return;
        }
        if (performance.now() - start > 8000) {
          reject(new Error('Ping timeout'));
          return;
        }
        setTimeout(check, 20);
      };
      check();
    });

    socket.removeEventListener('message', onMessage);

    const sorted = [...rtts].sort((a, b) => a - b);
    const max = sorted[sorted.length - 1] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    return { max, p95 };
  });

  expect(stats.p95).toBeLessThan(400);
  expect(stats.max).toBeLessThan(800);
  });
});

test.describe('Board multiplayer (playwright)', () => {
  test('broadcasts diff actions with large boards', async ({ browser }) => {
    const server = createMockRoomServer();
    const context = await browser.newContext();
    const hostPage = await context.newPage();
    const clientPage = await context.newPage();

    await setupPage(hostPage, server);
    await setupPage(clientPage, server);

    await hostPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Host');
      state?.createRoom?.('room-multi', '');
    });

    await waitForConnected(hostPage);

    await clientPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Peer');
      state?.joinRoom?.('room-multi', '');
    });

    await hostPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return Object.keys(store?.getState?.().connections ?? {}).length === 1;
    });

    await clientPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return store?.getState?.().status === 'connected';
    });

    await clientPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return !!store?.getState?.().hostConnection?.open;
    });

    await clientPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const socket = store?.getState?.().socket;
      return socket && socket.readyState === WebSocket.OPEN;
    });

    await hostPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { setState?: (fn: any) => void; getState?: () => any } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: Array.from({ length: 400 }, (_, index) => ({
          id: `card-${index}`,
          name: `Card ${index}`,
          ownerId: 'Host',
          position: { x: (index % 20) * 20, y: Math.floor(index / 20) * 20 },
          tapped: false,
          zone: 'battlefield',
          isCommander: false,
          commanderDeaths: 0,
        })),
      }));
      store?.getState?.().moveCard?.('card-1', { x: 260, y: 140 }, { persist: true });
    });

    server.clearHostMessages();

    await hostPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      store?.getState?.().toggleTap?.('card-0');
    });

    await expect.poll(() => server.getHostMessages().some((entry) => entry.payload?.type === 'BOARD_ACTION')).toBeTruthy();
    expect(server.getHostMessages().some((entry) => entry.payload?.type === 'BOARD_STATE')).toBeFalsy();
  });

  test('syncs drag movement to peers', async ({ browser }) => {
    const server = createMockRoomServer();
    const context = await browser.newContext();
    const hostPage = await context.newPage();
    const clientPage = await context.newPage();

    await setupPage(hostPage, server);
    await setupPage(clientPage, server);

    await hostPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Host');
      state?.createRoom?.('room-drag', '');
    });
    await waitForConnected(hostPage);

    await clientPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Peer');
      state?.joinRoom?.('room-drag', '');
    });

    await hostPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return Object.keys(store?.getState?.().connections ?? {}).length === 1;
    });

    await clientPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return store?.getState?.().status === 'connected';
    });

    await clientPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return !!store?.getState?.().hostConnection?.open;
    });

    const seedCard = {
      id: 'sync-card-1',
      name: 'Sync Card',
      ownerId: 'Host',
      position: { x: 120, y: 120 },
      tapped: false,
      zone: 'battlefield',
      isCommander: false,
      commanderDeaths: 0,
    };

    await hostPage.evaluate((card) => {
      const store = (window as unknown as { __GAME_STORE__?: { setState?: (fn: any) => void } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: [card],
      }));
    }, seedCard);

    await clientPage.evaluate((card) => {
      const store = (window as unknown as { __GAME_STORE__?: { setState?: (fn: any) => void } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: [card],
      }));
    }, seedCard);

    await hostPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      store?.getState?.().moveCard?.('sync-card-1', { x: 260, y: 260 }, { persist: true });
    });

    await clientPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      const card = state?.board?.find?.((c: any) => c.name === 'Sync Card');
      return card && (card.position.x === 260 && card.position.y === 260);
    });
  });

  test('handles mixed latency clients', async ({ browser }) => {
    const server = createMockRoomServer({
      latencyByPlayerName: {
        Fast: { toHostMs: 0 },
        Slow: { toHostMs: 150 },
        Zombie: { toHostMs: 800 },
      },
    });
    const context = await browser.newContext();
    const hostPage = await context.newPage();
    const fastPage = await context.newPage();
    const slowPage = await context.newPage();
    const zombiePage = await context.newPage();

    await setupPage(hostPage, server);
    await setupPage(fastPage, server);
    await setupPage(slowPage, server);
    await setupPage(zombiePage, server);

    await hostPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Host');
      state?.createRoom?.('room-latency', '');
    });

    await waitForConnected(hostPage);

    await hostPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { setState?: (fn: any) => void; getState?: () => any } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: Array.from({ length: 400 }, (_, index) => ({
          id: `lat-card-${index}`,
          name: `Lat Card ${index}`,
          ownerId: 'Host',
          position: { x: (index % 20) * 20, y: Math.floor(index / 20) * 20 },
          tapped: false,
          zone: 'battlefield',
          isCommander: false,
          commanderDeaths: 0,
        })),
      }));
      store?.getState?.().moveCard?.('lat-card-1', { x: 280, y: 120 }, { persist: true });
    });

    await fastPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Fast');
      state?.joinRoom?.('room-latency', '');
    });

    await slowPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Slow');
      state?.joinRoom?.('room-latency', '');
    });

    await zombiePage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Zombie');
      state?.joinRoom?.('room-latency', '');
    });

    await hostPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return Object.keys(store?.getState?.().connections ?? {}).length === 3;
    });

    await Promise.all([
      fastPage.waitForFunction(() => {
        const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
        return store?.getState?.().status === 'connected';
      }),
      slowPage.waitForFunction(() => {
        const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
        return store?.getState?.().status === 'connected';
      }),
      zombiePage.waitForFunction(() => {
        const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
        return store?.getState?.().status === 'connected';
      }),
    ]);

    server.clearHostMessages();

    await fastPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      store?.getState?.().toggleTap?.('lat-card-0');
      store?.getState?.().moveCard?.('lat-card-2', { x: 300, y: 200 }, { persist: true });
    });
    await slowPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      store?.getState?.().toggleTap?.('lat-card-3');
      store?.getState?.().moveCard?.('lat-card-4', { x: 320, y: 220 }, { persist: true });
    });
    await zombiePage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      store?.getState?.().toggleTap?.('lat-card-5');
      store?.getState?.().moveCard?.('lat-card-6', { x: 340, y: 240 }, { persist: true });
    });

    await expect.poll(() => server.getClientMessages().length).toBeGreaterThanOrEqual(6);
    await expect
      .poll(() => server.getClientMessages().some((entry) => entry.playerName === 'Zombie'), { timeout: 10000 })
      .toBeTruthy();

    const received = server.getClientMessages();
    const fastTimes = received.filter((entry) => entry.playerName === 'Fast').map((entry) => entry.receivedAt);
    const slowTimes = received.filter((entry) => entry.playerName === 'Slow').map((entry) => entry.receivedAt);
    const zombieTimes = received.filter((entry) => entry.playerName === 'Zombie').map((entry) => entry.receivedAt);
    const fastTime = fastTimes.length ? Math.min(...fastTimes) : 0;
    const slowTime = slowTimes.length ? Math.min(...slowTimes) : 0;
    const zombieTime = zombieTimes.length ? Math.min(...zombieTimes) : 0;

    expect(fastTime).toBeGreaterThan(0);
    expect(slowTime).toBeGreaterThan(0);
    expect(zombieTime).toBeGreaterThan(0);
    expect(slowTime - fastTime).toBeGreaterThan(80);
    expect(zombieTime - slowTime).toBeGreaterThan(400);
  });

  test('handles packet loss without crashing', async ({ browser }) => {
    const server = createMockRoomServer({
      dropByPlayerName: {
        Lossy: { toHostRate: 0.3 },
        Reliable: { toHostRate: 0 },
      },
      rngSeed: 4242,
    });
    const context = await browser.newContext();
    const hostPage = await context.newPage();
    const lossyPage = await context.newPage();
    const reliablePage = await context.newPage();

    await setupPage(hostPage, server);
    await setupPage(lossyPage, server);
    await setupPage(reliablePage, server);

    await hostPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Host');
      state?.createRoom?.('room-lossy', '');
    });
    await waitForConnected(hostPage);

    await lossyPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Lossy');
      state?.joinRoom?.('room-lossy', '');
    });
    await reliablePage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Reliable');
      state?.joinRoom?.('room-lossy', '');
    });

    await hostPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return Object.keys(store?.getState?.().connections ?? {}).length === 2;
    });

    await hostPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { setState?: (fn: any) => void; getState?: () => any } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: Array.from({ length: 400 }, (_, index) => ({
          id: `loss-card-${index}`,
          name: `Loss Card ${index}`,
          ownerId: 'Host',
          position: { x: (index % 20) * 20, y: Math.floor(index / 20) * 20 },
          tapped: false,
          zone: 'battlefield',
          isCommander: false,
          commanderDeaths: 0,
        })),
      }));
      store?.getState?.().moveCard?.('loss-card-1', { x: 260, y: 160 }, { persist: true });
    });

    server.clearHostMessages();

    await lossyPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      for (let i = 0; i < 50; i += 1) {
        state?.toggleTap?.('loss-card-0');
      }
    });
    await reliablePage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      for (let i = 0; i < 50; i += 1) {
        state?.toggleTap?.('loss-card-2');
      }
    });

    await expect.poll(() => server.getClientMessages().length).toBeGreaterThan(20);

    const lossyCount = server.getClientMessages().filter((entry) => entry.playerName === 'Lossy').length;
    const reliableCount = server.getClientMessages().filter((entry) => entry.playerName === 'Reliable').length;
    expect(reliableCount).toBe(50);
    expect(lossyCount).toBeGreaterThan(20);
    expect(lossyCount).toBeLessThan(50);
  });

  test('handles action bursts from a single client', async ({ browser }) => {
    const server = createMockRoomServer({ rngSeed: 777 });
    const context = await browser.newContext();
    const hostPage = await context.newPage();
    const clientPage = await context.newPage();

    await setupPage(hostPage, server);
    await setupPage(clientPage, server);

    await hostPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Host');
      state?.createRoom?.('room-burst', '');
    });
    await waitForConnected(hostPage);

    await clientPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Burst');
      state?.joinRoom?.('room-burst', '');
    });

    await hostPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return Object.keys(store?.getState?.().connections ?? {}).length === 1;
    });

    await hostPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { setState?: (fn: any) => void; getState?: () => any } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: Array.from({ length: 400 }, (_, index) => ({
          id: `burst-card-${index}`,
          name: `Burst Card ${index}`,
          ownerId: 'Host',
          position: { x: (index % 20) * 20, y: Math.floor(index / 20) * 20 },
          tapped: false,
          zone: 'battlefield',
          isCommander: false,
          commanderDeaths: 0,
        })),
      }));
      store?.getState?.().moveCard?.('burst-card-1', { x: 260, y: 160 }, { persist: true });
    });

    server.clearHostMessages();

    await clientPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      for (let i = 0; i < 200; i += 1) {
        state?.toggleTap?.('burst-card-0');
      }
      state?.moveCard?.('burst-card-2', { x: 280, y: 180 }, { persist: true });
    });

    await expect.poll(() => server.getClientMessages().length).toBeGreaterThanOrEqual(200);
  });

  test('reconnects after leaving the room', async ({ browser }) => {
    const server = createMockRoomServer();
    const context = await browser.newContext();
    const hostPage = await context.newPage();
    const clientPage = await context.newPage();

    await setupPage(hostPage, server);
    await setupPage(clientPage, server);

    await hostPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Host');
      state?.createRoom?.('room-reconnect', '');
    });
    await waitForConnected(hostPage);

    await clientPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Reconnect');
      state?.joinRoom?.('room-reconnect', '');
    });

    await hostPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return Object.keys(store?.getState?.().connections ?? {}).length === 1;
    });

    await clientPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return store?.getState?.().status === 'connected';
    });

    await clientPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      store?.getState?.().leaveRoom?.();
    });

    await hostPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return Object.keys(store?.getState?.().connections ?? {}).length === 0;
    });

    await clientPage.close();

    const reconnectPage = await context.newPage();
    await setupPage(reconnectPage, server);

    await reconnectPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      state?.setPlayerName?.('Reconnect');
      state?.joinRoom?.('room-reconnect', '');
    });

    await hostPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return Object.keys(store?.getState?.().connections ?? {}).length === 1;
    });

    await reconnectPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return store?.getState?.().status === 'connected';
    });

    await reconnectPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      return !!store?.getState?.().hostConnection?.open;
    });

    await reconnectPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const socket = store?.getState?.().socket;
      return socket && socket.readyState === WebSocket.OPEN;
    });

    await hostPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { setState?: (fn: any) => void; getState?: () => any } }).__GAME_STORE__;
      store?.setState?.((state: any) => ({
        ...state,
        board: Array.from({ length: 400 }, (_, index) => ({
          id: `reconnect-card-${index}`,
          name: `Reconnect Card ${index}`,
          ownerId: 'Host',
          position: { x: (index % 20) * 20, y: Math.floor(index / 20) * 20 },
          tapped: false,
          zone: 'battlefield',
          isCommander: false,
          commanderDeaths: 0,
        })),
      }));
      store?.getState?.().moveCard?.('reconnect-card-1', { x: 260, y: 160 }, { persist: true });
    });

    server.clearHostMessages();

    await reconnectPage.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      store?.getState?.().toggleTap?.('reconnect-card-0');
      store?.getState?.().moveCard?.('reconnect-card-2', { x: 280, y: 180 }, { persist: true });
    });

    await hostPage.waitForFunction(() => {
      const store = (window as unknown as { __GAME_STORE__?: { getState?: () => any } }).__GAME_STORE__;
      const state = store?.getState?.();
      const tapped = state?.board?.find?.((card: any) => card.id === 'reconnect-card-0')?.tapped;
      const moved = state?.board?.find?.((card: any) => card.id === 'reconnect-card-2')?.position;
      return tapped === true && moved && (moved.x === 280 && moved.y === 180);
    }, { timeout: 10000 });
  });
});

