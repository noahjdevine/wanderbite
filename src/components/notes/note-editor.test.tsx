import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveNoteReturnTarget } from '@/lib/notes/note-rules';

const REDEMPTION = '22222222-2222-4222-8222-222222222222';
const NOTE = '55555555-5555-4555-8555-555555555555';

const { push, saveBiteNote, toggleNoteVisibility } = vi.hoisted(() => ({
  push: vi.fn(),
  saveBiteNote: vi.fn(),
  toggleNoteVisibility: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

vi.mock('@/app/actions/bite-notes', () => ({
  saveBiteNote: (...args: unknown[]) => saveBiteNote(...args),
  toggleNoteVisibility: (...args: unknown[]) => toggleNoteVisibility(...args),
}));

import { FocusVisitFromHash } from '@/components/notes/focus-visit';
import { NoteEditor, type NoteEditorNote } from '@/components/notes/note-editor';

const existing: NoteEditorNote = {
  id: NOTE,
  rating: 4,
  note: 'Tacos',
  is_public: false,
};

describe('note return targets', () => {
  const hash = `#visit-${REDEMPTION}`;

  it('accepts the member surfaces and rejects everything else', () => {
    expect(resolveNoteReturnTarget('/challenges', REDEMPTION)).toBe(`/challenges${hash}`);
    expect(resolveNoteReturnTarget('/dashboard', REDEMPTION)).toBe(`/dashboard${hash}`);
    expect(resolveNoteReturnTarget('/journal', REDEMPTION)).toBe(`/journal${hash}`);
    expect(resolveNoteReturnTarget('/passport', REDEMPTION)).toBe(`/passport${hash}`);
    expect(resolveNoteReturnTarget('/journey', REDEMPTION)).toBe(`/journey${hash}`);
    expect(resolveNoteReturnTarget('/journey?view=journal', REDEMPTION)).toBe(
      `/journey?view=journal${hash}`,
    );
    expect(resolveNoteReturnTarget('/journey?view=passport', REDEMPTION)).toBe(
      `/journey?view=passport${hash}`,
    );
    expect(resolveNoteReturnTarget('/journey?view=map', REDEMPTION)).toBe(
      `/journey?view=map${hash}`,
    );
    expect(resolveNoteReturnTarget(`/challenges${hash}`, REDEMPTION)).toBe(`/challenges${hash}`);
    expect(resolveNoteReturnTarget(null, REDEMPTION)).toBe(`/journal${hash}`);
    expect(resolveNoteReturnTarget('   ', REDEMPTION)).toBe(`/journal${hash}`);

    for (const raw of [
      'https://evil.example/challenges',
      '//evil.example/challenges',
      '/challenges?next=https://evil.example',
      '/admin',
      'javascript:alert(1)',
      '/journey?view=billing',
      '/journey?view=journal&next=/admin',
      `\\evil.example`,
      `/challenges#visit-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    ]) {
      expect(resolveNoteReturnTarget(raw, REDEMPTION)).toBe(`/journal${hash}`);
    }
  });
});

describe('NoteEditor', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    push.mockReset();
    saveBiteNote.mockReset();
    toggleNoteVisibility.mockReset();
    saveBiteNote.mockResolvedValue({ ok: true });
    toggleNoteVisibility.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function render(node: ReactElement) {
    await act(async () => {
      root.render(node);
    });
    return container;
  }

  function button(label: string) {
    const found = [...container.querySelectorAll('button')].find((el) => el.textContent === label);
    if (!found) throw new Error(`missing button ${label}`);
    return found;
  }

  it('prefills an existing note and saves that same redemption', async () => {
    await render(
      <NoteEditor
        redemptionId={REDEMPTION}
        note={existing}
        returnTo="/journey?view=passport"
        restaurantName="North Grill"
      />,
    );
    expect(container.textContent).toContain('Edit memory');
    expect(container.textContent).toContain('North Grill');
    expect(container.querySelector('textarea')?.value).toBe('Tacos');
    expect(container.querySelector<HTMLInputElement>('input[value="4"]')?.checked).toBe(true);
    expect(container.querySelector('[data-note-visibility="private"]')?.textContent).toBe('Private');
    expect(container.textContent).not.toMatch(/dish/i);

    await act(async () => {
      button('Save').click();
    });
    expect(saveBiteNote).toHaveBeenCalledWith(REDEMPTION, 'Tacos', 4, false);
    expect(push).toHaveBeenCalledWith(`/journey?view=passport#visit-${REDEMPTION}`);
  });

  it('requires a rating and keeps a new note private until the switch is used', async () => {
    await render(
      <NoteEditor
        redemptionId={REDEMPTION}
        note={null}
        returnTo="/challenges"
        restaurantName="North Grill"
      />,
    );
    expect(container.textContent).toContain('Add memory');
    expect(container.querySelector('[data-note-visibility="private"]')).not.toBeNull();
    expect(container.querySelector('textarea')?.maxLength).toBe(280);

    await act(async () => {
      button('Save').click();
    });
    expect(saveBiteNote).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Pick a rating from 1 to 5 stars.');

    const area = container.querySelector('textarea');
    if (!area) throw new Error('missing note');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(area, 'x'.repeat(281));
      area.dispatchEvent(new Event('input', { bubbles: true }));
      container.querySelector<HTMLInputElement>('input[value="2"]')?.click();
      button('Make public').click();
    });
    expect(area.value).toHaveLength(280);
    expect(container.querySelector('[data-note-visibility="public"]')?.textContent).toBe('Public');
    expect(toggleNoteVisibility).not.toHaveBeenCalled();

    await act(async () => {
      button('Save').click();
    });
    expect(saveBiteNote).toHaveBeenCalledWith(REDEMPTION, 'x'.repeat(280), 2, true);
    expect(push).toHaveBeenCalledWith(`/challenges#visit-${REDEMPTION}`);
  });

  it('toggles a saved note through toggleNoteVisibility and falls back on a bad return', async () => {
    await render(
      <NoteEditor
        redemptionId={REDEMPTION}
        note={existing}
        returnTo="https://evil.example/challenges"
        restaurantName="North Grill"
      />,
    );
    await act(async () => {
      button('Make public').click();
    });
    expect(toggleNoteVisibility).toHaveBeenCalledWith(NOTE, true);
    expect(container.querySelector('[data-note-visibility="public"]')?.textContent).toBe('Public');

    await act(async () => {
      button('Cancel').click();
    });
    expect(push).toHaveBeenCalledWith(`/journal#visit-${REDEMPTION}`);
    expect(saveBiteNote).not.toHaveBeenCalled();
  });

  it('moves focus to the visit named in the hash', async () => {
    const target = document.createElement('div');
    target.id = `visit-${REDEMPTION}`;
    target.tabIndex = -1;
    document.body.appendChild(target);
    window.location.hash = `#visit-${REDEMPTION}`;
    await render(<FocusVisitFromHash />);
    expect(document.activeElement).toBe(target);
    target.remove();
  });
});
