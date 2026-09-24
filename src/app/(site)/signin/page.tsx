import { SignInForm } from './sign-in-form';

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    redirectTo?: string | string[];
    reset?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  return (
    <SignInForm
      redirectTo={firstParam(params.redirectTo)}
      resetSuccess={firstParam(params.reset) === 'success'}
      sessionError={firstParam(params.error) === 'session'}
    />
  );
}
