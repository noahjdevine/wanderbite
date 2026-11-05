import type { ReactNode } from 'react';

/** Night intro and cream sheet for /account. One h1, shared by the loaded page and the load error. */
export function AccountShell({ children }: { children: ReactNode }) {
  return (
    <div className="wb-account">
      <main>
        <header className="wb-account-band">
          <div className="wb-account-band-inner">
            <h1>Your account</h1>
            <p>Manage your profile, preferences, and subscription.</p>
          </div>
        </header>
        <div className="wb-account-sheet">
          <div className="wb-account-body">{children}</div>
        </div>
      </main>
    </div>
  );
}
