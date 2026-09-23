import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminMfaGate } from './admin-mfa-gate';

const beginAdminMfaEnrollment = vi.hoisted(() => vi.fn());
const verifyAdminMfaEnrollment = vi.hoisted(() => vi.fn());
const verifyAdminMfaChallenge = vi.hoisted(() => vi.fn());

vi.mock('./mfa-actions', () => ({
  beginAdminMfaEnrollment,
  verifyAdminMfaEnrollment,
  verifyAdminMfaChallenge,
}));

describe('AdminMfaGate', () => {
  let root: Root;

  beforeEach(() => {
    beginAdminMfaEnrollment.mockReset();
    verifyAdminMfaEnrollment.mockReset();
    verifyAdminMfaChallenge.mockReset();
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById('root')!);
  });

  it('shows first enrollment without dashboard data', async () => {
    beginAdminMfaEnrollment.mockResolvedValue({
      ok: true,
      factorId: '50000000-0000-4000-8000-0000000000aa',
      qrCode: 'data:image/svg+xml;utf-8,<svg></svg>',
      secret: 'SECRETKEY',
    });
    await act(async () => {
      root.render(<AdminMfaGate mode="enroll" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('SECRETKEY');
    expect(document.body.textContent).toContain('Lost your authenticator');
    expect(document.body.textContent).toContain('audit record');
    expect(document.querySelector('img')?.getAttribute('alt')).toBe('Authenticator QR code');
    expect(document.body.textContent).not.toContain('@');
    root.unmount();
  });

  it('shows the sign-in challenge and no enrollment shortcut', async () => {
    await act(async () => {
      root.render(<AdminMfaGate mode="challenge" />);
    });
    expect(beginAdminMfaEnrollment).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('no way to skip this check');
    expect(document.body.textContent).toContain('signs out every active session');
    root.unmount();
  });
});
