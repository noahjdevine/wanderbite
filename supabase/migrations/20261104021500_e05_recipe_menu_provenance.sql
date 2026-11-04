-- E05-A1 can store a later E05-B inspired-by recipe taken from a public menu.
-- This file does not retrieve or copy menu text. Not applied to hosted until approved.

alter table public.recipes
  add column description text,
  add column source_kind text,
  add column retrieved_at timestamptz,
  add column menu_wording text;

alter table public.recipes
  add constraint recipes_description_check check (
    description is null or char_length(btrim(description)) between 1 and 400
  ),
  add constraint recipes_source_kind_check check (
    source_kind is null or source_kind = 'public_menu'
  ),
  add constraint recipes_menu_wording_check check (
    menu_wording is null or menu_wording = 'paraphrase'
  ),
  add constraint recipes_public_menu_check check (
    source_kind is distinct from 'public_menu'
    or (
      recipe_type = 'inspired_by'
      and rights_basis = 'original'
      and source_url is not null
      and btrim(source_url) <> ''
      and retrieved_at is not null
      and description is not null
      and menu_wording = 'paraphrase'
    )
  );

comment on column public.recipes.description is
  'Paraphrased dish description. A public_menu row stores this paraphrase and cannot record verbatim menu copy.';

comment on column public.recipes.source_kind is
  'Provenance. public_menu is an inspired-by home recipe based on a restaurant public menu. Null for hand-curated rows.';

comment on column public.recipes.retrieved_at is
  'When that public menu was retrieved. Required when source_kind is public_menu.';

comment on column public.recipes.menu_wording is
  'Only paraphrase is a legal value. There is no verbatim setting.';
