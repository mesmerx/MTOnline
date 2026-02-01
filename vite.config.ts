import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const host = env.VITE_CLIENT_HOST || '127.0.0.1';
	const parsedPort = Number(env.VITE_CLIENT_PORT);
	const port = Number.isFinite(parsedPort) ? parsedPort : 5173;
	const internalIp = env.INTERNAL_IP;
	const fallbackHost = env.VITE_CLIENT_HOST && env.VITE_CLIENT_HOST !== '0.0.0.0' ? env.VITE_CLIENT_HOST : 'localhost';
	const hmrHost = env.VITE_HMR_HOST || fallbackHost;
	const hmrClientPort = Number(env.VITE_HMR_CLIENT_PORT) || port;
	const hmrProtocol = env.VITE_HMR_PROTOCOL || (hmrHost === 'localhost' ? 'ws' : 'wss');

	const allowedHosts = [
		'mto.mesmer.tv',
		'.mesmer.tv',
		'localhost',
		'127.0.0.1',
	];
	if (internalIp) {
		allowedHosts.push(internalIp);
	}

	return {
		plugins: [react()],
		define: {
			'import.meta.env.VITE_INTERNAL_IP': JSON.stringify(internalIp || ''),
		},
		server: {
			host,
			port,
			allowedHosts,
			hmr: {
				protocol: hmrProtocol,
				host: hmrHost,
				clientPort: hmrClientPort,
				port,
			},
		},
		preview: {
			host,
			port,
			allowedHosts,
		},
	};
});
