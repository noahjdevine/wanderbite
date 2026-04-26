-- Display-only encrypted storage for WB- codes (partner verification still uses token_hash only).

alter table public.redemptions
  add column if not exists encrypted_code text,
  add column if not exists code_iv text;

comment on column public.redemptions.encrypted_code is
  'AES-256-GCM ciphertext + auth tag (base64). For user display recovery only; verification uses token_hash.';
comment on column public.redemptions.code_iv is
  'AES-GCM IV (base64, 12 bytes). Paired with encrypted_code.';
