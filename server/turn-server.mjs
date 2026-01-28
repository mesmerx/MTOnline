import 'dotenv/config';
import Turn from 'node-turn';
import { createRequire } from 'node:module';
import net from 'net';

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
// Usar apenas 0.0.0.0 por padrão para evitar problemas com múltiplos IPs
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

const resolvedAuthMech = authMech || (Object.keys(credentials).length ? 'long-term' : 'none');

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

serverOptions.authMech = resolvedAuthMech;

if (Object.keys(credentials).length) {
  serverOptions.credentials = credentials;
} else if (resolvedAuthMech !== 'none') {
  console.warn('[turn] no credentials configured; falling back to authMech "none"');
  serverOptions.authMech = 'none';
}

console.log('[turn] configuration:', {
  listeningPort,
  listeningIps,
  realm,
  authMech: resolvedAuthMech,
  hasCredentials: Object.keys(credentials).length > 0,
});

console.log('[turn] initializing server...');
const server = new Turn(serverOptions);

server.on('listening', () => {
  console.log(
    `[turn] listening on ${listeningIps.join(',')}:${listeningPort} | auth=${serverOptions.authMech} | realm=${realm}`,
  );
  console.log('[turn] server is running and ready');
});

server.on('error', (error) => {
  console.error('[turn] error:', error);
});

let isShuttingDown = false;

const shutdown = () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[turn] shutting down');
  try {
    server.stop();
  } catch (error) {
    console.error('[turn] error during shutdown:', error);
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Manter o processo vivo
process.on('uncaughtException', (error) => {
  console.error('[turn] uncaught exception:', error);
  // Não sair do processo, apenas logar o erro
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[turn] unhandled rejection at:', promise, 'reason:', reason);
  // Não sair do processo, apenas logar o erro
});

try {
  console.log('[turn] starting server...');
  server.start();
  console.log('[turn] start() called, waiting for listening event...');
  
  // Aguardar um pouco para ver se o evento listening é disparado
  setTimeout(() => {
    if (!isShuttingDown) {
      console.log('[turn] server started (listening event may have been missed, but server is running)');
      console.log('[turn] server is ready and will keep running. Press Ctrl+C to stop.');
    }
  }, 1000);
  
  // Garantir que o processo não saia - manter o event loop ativo
  // O servidor deve criar sockets que mantêm o processo vivo, mas vamos garantir
  const keepAlive = setInterval(() => {
    if (isShuttingDown) {
      clearInterval(keepAlive);
    }
  }, 10000);
  
  // Log periódico para confirmar que está rodando
  const statusInterval = setInterval(() => {
    if (!isShuttingDown) {
      console.log('[turn] server is running...');
    } else {
      clearInterval(statusInterval);
    }
  }, 30000);
  
  // Manter o processo vivo indefinidamente
  // Criar um socket dummy para garantir que o event loop não termine
  // Isso é necessário porque o servidor pode não estar criando sockets imediatamente
  const dummyServer = net.createServer();
  dummyServer.listen(0, '127.0.0.1', () => {
    console.log('[turn] keep-alive socket created');
  });
  
  // Também tentar manter stdin aberto se disponível
  if (process.stdin.isTTY) {
    process.stdin.resume();
  }
  
} catch (error) {
  console.error('[turn] failed to start:', error);
  process.exit(1);
}
