import { vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Common env vars used across tests; individual tests can override.
beforeEach(() => {
  vi.unstubAllEnvs();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem('wb_seen_stamps');
    } catch {
      // A test that blocks storage still has to start from a quiet unlock.
    }
  }
});
