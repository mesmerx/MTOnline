declare global {
  // eslint-disable-next-line no-var
  var __PEER_DEBUG__: boolean | undefined;
}

const isDebug = () => import.meta.env.VITE_DEBUG_PEER === 'true';

export const debugLog = (...args: unknown[]) => {
  if (globalThis.__PEER_DEBUG__ ?? isDebug()) {
  }
  void args;
};
