/** Shown when a form was rendered for a different signed-in user. */
export const ACCOUNT_CHANGED_MESSAGE = 'Your account changed—reload';

export type RenderedAccountState = 'pending' | 'ready' | 'changed';

/** A missing or different session is not the user this form was rendered for. */
export function renderedAccountState(
  renderedForUserId: string,
  sessionUserId: string | null | undefined,
): Exclude<RenderedAccountState, 'pending'> {
  return sessionUserId === renderedForUserId ? 'ready' : 'changed';
}
