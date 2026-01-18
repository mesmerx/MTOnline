import 'dotenv/config';
import Turn from 'node-turn';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TurnData = require('node-turn/lib/data.js');
['readBit', 'writeBit', 'readUncontiguous', 'writeUncontiguous', 'writeWord'].forEach((method) => {
  if (typeof Buffer.prototype[method] !== 'function' && typeof TurnData.prototype[method] === 'function') {
    // Node 22 slices no longer inherit custom prototypes; copy node-turn helpers onto Buffer to prevent crashes.
    Object.defineProperty(Buffer.prototype, method, {
      value: TurnData.prototype[method],
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }
});

const parseList = (value, fallback = []) => {
  if (!value) return fallback;
  const list = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
};

const parseExternalIps = (value) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!trimmed.includes('=')) {
    return trimmed;
  }
  const entries = {};
  trimmed.split(',').forEach((pair) => {
    const [localIp, externalIp] = pair.split('=').map((token) => token.trim());
    if (localIp && externalIp) {
      entries[localIp] = externalIp;
    }
  });
  return Object.keys(entries).length ? entries : undefined;
};

const numericEnv = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const listeningPort = numericEnv(process.env.TURN_PORT ?? process.env.PORT, 3478);
const listeningIps = parseList(process.env.TURN_LISTENING_IPS, ['0.0.0.0']);
const relayIps = parseList(process.env.TURN_RELAY_IPS);
const minPort = numericEnv(process.env.TURN_MIN_PORT, 49152);
const maxPort = numericEnv(process.env.TURN_MAX_PORT, 65535);
const realm = process.env.TURN_REALM || 'mtonline.local';
const authMech = process.env.TURN_AUTH_MECH || undefined;
const username = process.env.TURN_USERNAME;
const password = process.env.TURN_PASSWORD;
const debugLevel = process.env.TURN_DEBUG_LEVEL || 'WARN';
const externalIps = parseExternalIps(process.env.TURN_EXTERNAL_IPS);

const credentials = {};
if (username && password) {
  credentials[username] = password;
}

const formatDebugPayload = (payload) => {
  if (payload instanceof Error) {
    return `${payload.message}\n${payload.stack ?? ''}`.trim();
  }
  if (typeof payload === 'string') {
    return payload;
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
};

const logDebug = (level, message) => {
  // Logs desabilitados para evitar interferência na comunicação
};

const serverOptions = {
  listeningPort,
  listeningIps,
  realm,
  minPort,
  maxPort,
  debugLevel,
  debug: logDebug,
};

if (relayIps.length) {
  serverOptions.relayIps = relayIps;
}

if (externalIps) {
  serverOptions.externalIps = externalIps;
}

const resolvedAuthMech = authMech || (Object.keys(credentials).length ? 'long-term' : 'none');
serverOptions.authMech = resolvedAuthMech;

if (Object.keys(credentials).length) {
  serverOptions.credentials = credentials;
} else if (resolvedAuthMech !== 'none') {
  console.warn('[turn] no credentials configured; falling back to authMech "none"');
  serverOptions.authMech = 'none';
}

const server = new Turn(serverOptions);
server.start();

console.log(
  `[turn] listening on ${listeningIps.join(',')}:${listeningPort} | auth=${serverOptions.authMech} | realm=${realm}`,
);

const shutdown = () => {
  console.log('[turn] shutting down');
  server.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
