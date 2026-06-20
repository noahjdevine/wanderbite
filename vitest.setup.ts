import { vi, beforeEach } from 'vitest';

// Common env vars used across tests; individual tests can override.
beforeEach(() => {
  vi.unstubAllEnvs();
});
