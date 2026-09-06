import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([
  [true, '', '/api'],
  [false, '', 'http://localhost:5000/api'],
  [true, 'https://api.example.test/api/', 'https://api.example.test/api'],
])('report downloads use the configured API in production=%s', async (production, override, base) => {
  vi.stubEnv('PROD', production);
  vi.stubEnv('VITE_API_URL', override);
  const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Sign in required' }) });
  vi.stubGlobal('fetch', fetch);
  const { downloadReport } = await import('./downloadReport');
  await expect(downloadReport({ type: 'bookings' })).rejects.toThrow('Sign in required');
  expect(fetch).toHaveBeenCalledWith(`${base}/reports?type=bookings&format=csv`, { credentials: 'include' });
});
