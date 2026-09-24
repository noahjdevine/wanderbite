import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

const POST_FORMS = [
  'src/app/(site)/signin/sign-in-form.tsx',
  'src/app/(site)/signup/page.tsx',
  'src/app/(site)/forgot-password/page.tsx',
  'src/app/(site)/reset-password/reset-password-form.tsx',
  'src/app/partner/partner-login-form.tsx',
  'src/app/partner/[slug]/partner-slug-login.tsx',
  'src/app/(site)/admin/admin-client.tsx',
  'src/app/(site)/admin/admin-mfa-gate.tsx',
];

describe('G17-B credential POST', () => {
  it('submits credential forms through useActionState and never method=get', () => {
    for (const rel of POST_FORMS) {
      const file = source(rel);
      expect(file, rel).toMatch(/useActionState/);
      expect(file, rel).not.toMatch(/method\s*=\s*['"]get['"]/i);
    }
  });

  it('names password, pin, verification code, and authenticator code only on those POST forms', () => {
    const named = POST_FORMS.filter((rel) =>
      /name=["'](password|pin|verification_code|code)["']/.test(source(rel)),
    );
    expect(named).toEqual([
      'src/app/(site)/signin/sign-in-form.tsx',
      'src/app/(site)/signup/page.tsx',
      'src/app/(site)/reset-password/reset-password-form.tsx',
      'src/app/partner/partner-login-form.tsx',
      'src/app/partner/[slug]/partner-slug-login.tsx',
      'src/app/(site)/admin/admin-client.tsx',
      'src/app/(site)/admin/admin-mfa-gate.tsx',
    ]);
    expect(source('src/components/partner/partner-redeem-client.tsx')).not.toMatch(
      /name=["']code["']/,
    );
  });

  it('revalidates sign-in redirectTo on the server and keeps both destination branches', () => {
    const action = source('src/app/actions/credential-sign-in.ts');
    expect(action).toMatch(/resolveSignInDestination/);
    expect(action).toMatch(/user_profiles/);
    expect(action).not.toMatch(/console\.(log|info|debug|error)\(/);
  });

  it('runs Google import as create then attach', () => {
    const action = source('src/app/(site)/admin/actions-import.ts');
    const fn = action.slice(action.indexOf('export async function importRestaurantFromGoogle'));
    const createAt = fn.indexOf('addRestaurant(formData)');
    const attachAt = fn.indexOf('attachGoogleMetadataToLatestRestaurantByName');
    expect(createAt).toBeGreaterThan(-1);
    expect(attachAt).toBeGreaterThan(createAt);
    expect(source('src/lib/google-import-outcome.ts')).toContain(
      'Restaurant added, but Google metadata was not saved.',
    );
    expect(source('src/app/(site)/admin/admin-client.tsx')).toContain(
      'GOOGLE_IMPORT_PARTIAL_MESSAGE',
    );
  });

  it('does not create an authenticator factor from the enroll POST', () => {
    const mfa = source('src/app/(site)/admin/mfa-actions.ts');
    const enroll = mfa.slice(mfa.indexOf('export async function verifyAdminMfaEnrollmentFromForm'));
    expect(enroll).not.toMatch(/beginAdminMfaEnrollment/);
    expect(enroll).toMatch(/ENROLL_JS_REQUIRED/);
    expect(mfa).toMatch(/Turn on JavaScript to display the QR code/);
    expect(source('src/app/(site)/admin/admin-mfa-gate.tsx')).not.toMatch(
      /mode === 'enroll' && !factorId/,
    );
  });
});
