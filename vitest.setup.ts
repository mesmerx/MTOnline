import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
globalThis.__PEER_DEBUG__ = false;

type WsMessageEvent = { data: string };

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event?: Event) => void) | null = null;
  onmessage: ((event: WsMessageEvent) => void) | null = null;
  onclose: ((event?: Event) => void) | null = null;
  onerror: ((event?: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  });

  constructor(public url: string) {
    wsControl.sockets.push(this);
  }
}

const wsControl = {
  sockets: [] as MockWebSocket[],
  reset() {
    this.sockets.length = 0;
  },
  last() {
    return this.sockets[this.sockets.length - 1];
  },
  open(socket: MockWebSocket | undefined) {
    if (!socket) return;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();
  },
  receive(socket: MockWebSocket | undefined, message: unknown) {
    if (!socket) return;
    socket.onmessage?.({ data: JSON.stringify(message) });
  },
  openLast() {
    this.open(this.last());
  },
  receiveLast(message: unknown) {
    this.receive(this.last(), message);
  },
};

globalThis.__WS_CONTROL__ = wsControl;

// Force WebSocket to be mocked in all test environments (node + browser).
try {
  Object.defineProperty(globalThis, 'WebSocket', {
    value: MockWebSocket as unknown as typeof WebSocket,
    writable: true,
    configurable: true,
  });
} catch {
  // Fallback for environments where defineProperty is restricted.
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
}
