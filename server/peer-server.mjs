import { PeerServer } from 'peer';

const port = Number(process.env.PEER_PORT ?? process.env.PORT ?? 9000);
const host = process.env.PEER_HOST ?? '0.0.0.0';
const path = process.env.PEER_PATH ?? '/peerjs';
const allowDiscovery = process.env.PEER_ALLOW_DISCOVERY === 'true';

const server = PeerServer({
  port,
  host,
  path,
  proxied: process.env.PEER_PROXIED === 'true',
  allow_discovery: allowDiscovery,
});

server.on('connection', (client) => {
  console.log(`[peer] client connected: ${client.getId()}`);
});

server.on('disconnect', (client) => {
  console.log(`[peer] client disconnected: ${client.getId()}`);
});

console.log(`[peer] listening on ${host}:${port}${path}`);

