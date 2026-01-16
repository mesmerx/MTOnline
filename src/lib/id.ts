export const randomId = (): string => {
  const fallback = Math.random().toString(36).replace(/[^a-z0-9]+/gi, '').slice(0, 10);
  if (fallback.length >= 6) return fallback;
  const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
  return hasCrypto ? crypto.randomUUID() : `${Date.now()}${fallback}`;
};

