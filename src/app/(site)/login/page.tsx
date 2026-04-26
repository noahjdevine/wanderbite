import { redirect } from 'next/navigation';

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/** @deprecated Use `/signin` — kept for bookmarks and old links. */
export default async function LoginPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const redirectTo = sp.redirectTo;
  const q = new URLSearchParams();
  if (typeof redirectTo === 'string' && redirectTo) {
    q.set('redirectTo', redirectTo);
  }
  const suffix = q.toString() ? `?${q.toString()}` : '';
  redirect(`/signin${suffix}`);
}
