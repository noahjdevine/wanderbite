import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { JournalReflection } from '@/app/actions/journal-reflections';
import { REFLECTION_LIMITS } from '@/lib/notes/reflection';

const REDEMPTION = '22222222-2222-4222-8222-222222222222';
const NOTE = '55555555-5555-4555-8555-555555555555';
const HANDOFF_URL = 'https://search.google.com/local/writereview?placeid=ChIJplaceid1';
const DRAFT = 'Unpublished patio note';

const { push, saveBiteNote, toggleNoteVisibility, saveJournalReflection, getGoogleReviewHandoffForRedemption } =
  vi.hoisted(() => ({
    push: vi.fn(),
    saveBiteNote: vi.fn(),
    toggleNoteVisibility: vi.fn(),
    saveJournalReflection: vi.fn(),
    getGoogleReviewHandoffForRedemption: vi.fn(),
  }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

vi.mock('@/app/actions/bite-notes', () => ({
  saveBiteNote: (...args: unknown[]) => saveBiteNote(...args),
  toggleNoteVisibility: (...args: unknown[]) => toggleNoteVisibility(...args),
}));

vi.mock('@/app/actions/journal-reflections', () => ({
  saveJournalReflection: (...args: unknown[]) => saveJournalReflection(...args),
  getGoogleReviewHandoffForRedemption: (...args: unknown[]) =>
    getGoogleReviewHandoffForRedemption(...args),
}));

import { NoteEditor } from '@/components/notes/note-editor';
import { JournalReflectionSection } from '@/components/notes/reflection-editor';

const reflection: JournalReflection = {
  id: '77777777-7777-4777-8777-777777777777',
  redemption_id: REDEMPTION,
  bite_note_id: null,
  favorite_bite: 'Tacos',
  atmosphere: 'Quiet patio',
  return_interest: 'maybe',
  companion_label: 'Alex',
  unpublished_review_draft: DRAFT,
  created_at: '2026-11-06T00:00:00.000Z',
  updated_at: '2026-11-06T00:00:00.000Z',
};

function valueOf(element: HTMLElement): string {
  return (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
}

function section(props: Partial<ComponentProps<typeof JournalReflectionSection>> = {}) {
  return (
    <JournalReflectionSection
      enabled
      redemptionId={REDEMPTION}
      initialReflection={null}
      {...props}
    />
  );
}

describe('JournalReflectionSection', () => {
  beforeEach(() => {
    saveBiteNote.mockReset();
    toggleNoteVisibility.mockReset();
    saveJournalReflection.mockReset();
    getGoogleReviewHandoffForRedemption.mockReset();
    push.mockReset();
    saveBiteNote.mockResolvedValue({ ok: true });
    saveJournalReflection.mockResolvedValue({ ok: true });
    getGoogleReviewHandoffForRedemption.mockResolvedValue({
      ok: true,
      url: HANDOFF_URL,
      source: 'place_id',
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders nothing when disabled, including a reflection that was passed in', () => {
    render(section({ enabled: false, initialReflection: reflection }));
    expect(screen.queryByRole('heading', { name: 'Private reflection' })).toBeNull();
    expect(screen.queryByDisplayValue('Tacos')).toBeNull();
    expect(screen.queryByText(DRAFT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Get Google review link' })).toBeNull();
    expect(screen.queryByRole('button', { name: /publish/i })).toBeNull();
    expect(saveJournalReflection).not.toHaveBeenCalled();
    expect(getGoogleReviewHandoffForRedemption).not.toHaveBeenCalled();
  });

  it('saves an empty reflection without truncating or publishing', async () => {
    render(section());
    expect(screen.getByRole('heading', { name: 'Private reflection' })).toBeTruthy();
    expect(screen.getByText(/Stays off your public note until you publish/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /publish/i })).toBeNull();
    expect(document.body.textContent).toContain('Journal');
    expect(document.body.textContent).not.toContain('Timeline');

    fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }));
    await waitFor(() => {
      expect(saveJournalReflection).toHaveBeenCalledWith(REDEMPTION, {
        favorite_bite: '',
        atmosphere: '',
        return_interest: null,
        companion_label: '',
        unpublished_review_draft: '',
      });
    });
    const payload = saveJournalReflection.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.bite_note_id).toBeUndefined();
    expect((await screen.findByRole('status')).textContent).toContain('Saved');
  });

  it('shows a saved reflection and refuses newlines and over-long text without writing', async () => {
    render(section({ initialReflection: reflection }));
    const favorite = screen.getByLabelText('Favorite bite');
    expect(valueOf(favorite)).toBe('Tacos');
    expect(valueOf(screen.getByLabelText('Atmosphere'))).toBe('Quiet patio');
    expect(valueOf(screen.getByLabelText('Would you go back?'))).toBe('maybe');
    expect(valueOf(screen.getByLabelText('Who you went with'))).toBe('Alex');
    expect(valueOf(screen.getByLabelText('Review draft'))).toBe(DRAFT);

    const tooLong = 'x'.repeat(REFLECTION_LIMITS.favorite_bite + 1);
    fireEvent.change(favorite, { target: { value: tooLong } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }));
    expect(screen.getByRole('alert').textContent).toContain('Favorite bite must be 120 characters or less.');
    expect(valueOf(favorite)).toBe(tooLong);
    expect(saveJournalReflection).not.toHaveBeenCalled();

    fireEvent.change(favorite, { target: { value: 'line\nbreak' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }));
    expect(screen.getByRole('alert').textContent).toContain(
      'Favorite bite cannot include line breaks or control characters.',
    );
    expect(valueOf(favorite)).toBe('line\nbreak');
    expect(saveJournalReflection).not.toHaveBeenCalled();
  });

  it('shows a server refusal on the field and does not mark the reflection saved', async () => {
    saveJournalReflection.mockResolvedValue({ ok: false, code: 'too_long', field: 'atmosphere' });
    render(section());
    fireEvent.change(screen.getByLabelText('Atmosphere'), { target: { value: 'Short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Atmosphere must be 280 characters or less.');
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(valueOf(screen.getByLabelText('Atmosphere'))).toBe('Short');
  });

  it('shows a return-interest refusal from the action', async () => {
    saveJournalReflection.mockResolvedValue({
      ok: false,
      code: 'invalid_return_interest',
      field: 'return_interest',
    });
    render(section());
    fireEvent.change(screen.getByLabelText('Would you go back?'), { target: { value: 'yes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Choose yes, maybe, or no.');
    });
    expect(saveJournalReflection).toHaveBeenCalledWith(
      REDEMPTION,
      expect.objectContaining({ return_interest: 'yes' }),
    );
  });

  it('copies and opens the handoff URL without the draft or a second window', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(section({ initialReflection: reflection }));

    fireEvent.click(screen.getByRole('button', { name: 'Get Google review link' }));
    const link = await screen.findByRole('link', { name: 'Open Google review' });
    expect(getGoogleReviewHandoffForRedemption).toHaveBeenCalledTimes(1);
    expect(getGoogleReviewHandoffForRedemption).toHaveBeenCalledWith(REDEMPTION);
    expect(link.getAttribute('href')).toBe(HANDOFF_URL);
    expect(link.getAttribute('href')).not.toContain(DRAFT);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    expect(screen.getByText(/Opens search.google.com/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(HANDOFF_URL);
    });
    expect(writeText.mock.calls[0]?.[0]).not.toContain(DRAFT);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Google review link' })).toBeNull();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('shows a selectable link when the clipboard fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(section());
    fireEvent.click(screen.getByRole('button', { name: 'Get Google review link' }));
    await screen.findByRole('link', { name: 'Open Google review' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    const field = await screen.findByRole('textbox', { name: 'Google review link' });
    expect(valueOf(field)).toBe(HANDOFF_URL);
    expect((field as HTMLInputElement).readOnly).toBe(true);
  });

  it('shows a calm message when the restaurant has no Google destination', async () => {
    getGoogleReviewHandoffForRedemption.mockResolvedValue({ ok: false, code: 'missing_destination' });
    render(section({ initialReflection: reflection }));
    fireEvent.click(screen.getByRole('button', { name: 'Get Google review link' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'This restaurant does not have a Google review link yet.',
      );
    });
    expect(screen.queryByRole('link', { name: 'Open Google review' })).toBeNull();
    expect(screen.getByRole('alert').textContent).not.toContain(DRAFT);
    expect(screen.getByRole('alert').textContent).not.toContain('maps.google.com');
    expect(document.querySelector('a[href*="google"]')).toBeNull();
  });

  it('shows a calm message when the place id cannot be used', async () => {
    getGoogleReviewHandoffForRedemption.mockResolvedValue({ ok: false, code: 'invalid_place_id' });
    render(section());
    fireEvent.click(screen.getByRole('button', { name: 'Get Google review link' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'This restaurant does not have a usable Google place id',
      );
    });
    expect(screen.queryByRole('link', { name: 'Open Google review' })).toBeNull();
  });

  it('keeps the bite-note form working beside the reflection section', async () => {
    render(
      <>
        <NoteEditor
          redemptionId={REDEMPTION}
          note={{ id: NOTE, rating: 4, note: 'Tacos', is_public: false }}
          returnTo="/journal"
          restaurantName="North Grill"
        />
        {section({ initialReflection: reflection })}
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Edit memory' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Private reflection' })).toBeTruthy();
    expect(valueOf(screen.getByLabelText('Note'))).toBe('Tacos');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(saveBiteNote).toHaveBeenCalledWith(REDEMPTION, 'Tacos', 4, false);
    });
    expect(saveJournalReflection).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(`/journal#visit-${REDEMPTION}`);
  });
});
