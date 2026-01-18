import 'dotenv/config';
import { PeerServer } from 'peer';

const port = Number(process.env.PEER_PORT ?? process.env.PORT ?? 9910);
const host = process.env.PEER_HOST ?? '0.0.0.0';
const path = process.env.PEER_PATH ?? '/peerjs';
const allowDiscovery = process.env.PEER_ALLOW_DISCOVERY === 'true';

const server = PeerServer({
  host,
  port,
  secure: false,
  path,
  proxied: true,
  allow_discovery: true,
});

server.on('connection', (client) => {
  console.log(`[peer] client connected: ${client.getId()}`);
});

server.on('disconnect', (client) => {
  console.log(`[peer] client disconnected: ${client.getId()}`);
});

console.log(`[peer] listening on ${host}:${port}${path}`);

