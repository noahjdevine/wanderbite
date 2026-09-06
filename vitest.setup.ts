import { vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Common env vars used across tests; individual tests can override.
beforeEach(() => {
  vi.unstubAllEnvs();
});
