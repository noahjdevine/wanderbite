export default async function ProfilePage() {
  // Deprecated: /profile has been replaced by /account.
  // Keep this route for old links/bookmarks.
  const { redirect } = await import('next/navigation');
  redirect('/account');
}
