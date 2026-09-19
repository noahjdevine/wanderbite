import { afterEach, describe, expect, it, vi } from 'vitest';

const evaluateCspReportIntake = vi.fn();
const parseCspReportBody = vi.fn();
const clientIpFromRequest = vi.fn();

vi.mock('@/lib/csp-report', () => ({
  clientIpFromRequest: (...args: unknown[]) => clientIpFromRequest(...args),
  evaluateCspReportIntake: (...args: unknown[]) => evaluateCspReportIntake(...args),
  parseCspReportBody: (...args: unknown[]) => parseCspReportBody(...args),
}));

describe('POST /api/csp-report', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 413 for oversized bodies and never parses them', async () => {
    clientIpFromRequest.mockReturnValue('203.0.113.10');
    evaluateCspReportIntake.mockResolvedValue('too_large');
    const { POST } = await import('./route');
    const response = await POST(
      new Request('https://wanderbite.co/api/csp-report', {
        method: 'POST',
        body: '{}',
      }),
    );
    expect(response.status).toBe(413);
    expect(parseCspReportBody).not.toHaveBeenCalled();
  });

  it('acknowledges dropped and sanitized reports with 204 and does not echo payloads', async () => {
    clientIpFromRequest.mockReturnValue('203.0.113.10');
    evaluateCspReportIntake.mockResolvedValue('drop');
    const { POST } = await import('./route');
    const dropped = await POST(
      new Request('https://wanderbite.co/api/csp-report', {
        method: 'POST',
        body: JSON.stringify({ 'csp-report': { 'document-uri': '/x?code=WB-1' } }),
      }),
    );
    expect(dropped.status).toBe(204);
    expect(await dropped.text()).toBe('');
    expect(parseCspReportBody).not.toHaveBeenCalled();

    evaluateCspReportIntake.mockResolvedValue('allow');
    parseCspReportBody.mockReturnValue([
      {
        effectiveDirective: 'script-src',
        disposition: 'report',
        documentUri: 'https://wanderbite.co/x',
        blockedUri: null,
        sourceFile: null,
        statusCode: null,
        lineNumber: null,
      },
    ]);
    const allowed = await POST(
      new Request('https://wanderbite.co/api/csp-report', {
        method: 'POST',
        body: '{}',
      }),
    );
    expect(allowed.status).toBe(204);
    expect(await allowed.text()).toBe('');
  });
});

describe('GET /api/csp-report', () => {
  it('rejects non-POST collection', async () => {
    const { GET } = await import('./route');
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });
});
