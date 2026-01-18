import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const host = env.VITE_CLIENT_HOST || '127.0.0.1';
	const parsedPort = Number(env.VITE_CLIENT_PORT);
	const port = Number.isFinite(parsedPort) ? parsedPort : 5173;

	return {
		plugins: [react()],
		server: {
			host,
			port,
			allowedHosts: [
				'mto.mesmer.tv',
				'.mesmer.tv',
				'localhost',
				'127.0.0.1',
			],
		},
		preview: {
			host,
			port,
			allowedHosts: [
				'mto.mesmer.tv',
				'.mesmer.tv',
				'localhost',
				'127.0.0.1',
			],
		},
	};
});
