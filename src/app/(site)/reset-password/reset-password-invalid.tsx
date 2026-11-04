import Link from 'next/link';
import { AuthScreen } from '@/components/auth/auth-screen';

export function ResetPasswordInvalid() {
  return (
    <AuthScreen
      title="Invalid or expired link"
      lede="This reset link may have expired. Request a new one from the login page."
    >
      <Link href="/forgot-password" className="wb-auth-submit">
        Request new reset link
      </Link>
    </AuthScreen>
  );
}
