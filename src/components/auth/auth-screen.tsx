import type { ReactNode } from 'react';

type AuthScreenProps = {
  title: string;
  lede?: ReactNode;
  notice?: ReactNode;
  marker?: ReactNode;
  children: ReactNode;
};

/** Night glass frame for the public auth routes. The form is in the first paint. */
export function AuthScreen({ title, lede, notice, marker, children }: AuthScreenProps) {
  return (
    <main className="wb-dark wb-auth-page">
      <div className="wb-auth-glow" aria-hidden="true">
        <span className="wb-aurora wb-auth-glow-a" />
        <span className="wb-aurora-2 wb-auth-glow-b" />
      </div>
      <div className="wb-glass-card wb-auth-card">
        {marker}
        <h1 className="wb-auth-title">{title}</h1>
        {lede ? <p className="wb-auth-lead">{lede}</p> : null}
        {notice}
        <div className="wb-auth-body">{children}</div>
      </div>
    </main>
  );
}
