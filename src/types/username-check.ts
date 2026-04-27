export type UsernameAvailability =
  | 'available'
  | 'taken'
  | 'invalid'
  | 'too_short'
  | 'too_long'
  | 'unchanged';

export type CheckUsernameResult =
  | { ok: true; status: UsernameAvailability }
  | { ok: false; error: string };

