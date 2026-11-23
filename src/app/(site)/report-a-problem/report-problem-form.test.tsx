import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const submitSiteProblemReport = vi.hoisted(() => vi.fn());

vi.mock('@/app/actions/site-problem-reports', () => ({
  submitSiteProblemReport,
}));

import { ReportProblemForm } from './report-problem-form';

const SHORT = 'Please tell us a little more (at least 10 characters).';
const LONG = 'That is a bit long. Please keep it under 2000 characters.';

function whatHappened() {
  return screen.getByLabelText('What happened?') as HTMLTextAreaElement;
}

function send() {
  fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
}

describe('Report a problem field message', () => {
  afterEach(() => {
    cleanup();
    submitSiteProblemReport.mockReset();
  });

  it('shows an on-page message for empty or short text and does not submit', () => {
    render(<ReportProblemForm initialPage="/pricing" showEmail />);
    const field = whatHappened();
    expect(field.required).toBe(true);
    expect(field.minLength).toBe(10);
    expect(field.maxLength).toBe(2000);

    send();
    expect(screen.getByRole('alert').textContent).toBe(SHORT);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe('what-happened-error');
    expect(document.getElementById('what-happened-error')).toBe(screen.getByRole('alert'));
    expect(submitSiteProblemReport).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: 'too short' } });
    send();
    expect(screen.getByRole('alert').textContent).toBe(SHORT);
    expect(submitSiteProblemReport).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '          ' } });
    send();
    expect(screen.getByRole('alert').textContent).toBe(SHORT);
    expect(submitSiteProblemReport).not.toHaveBeenCalled();
  });

  it('shows an on-page message when the text is over 2000 characters and does not submit', () => {
    render(<ReportProblemForm initialPage="" showEmail={false} />);
    const field = whatHappened();
    field.removeAttribute('maxLength');
    fireEvent.change(field, { target: { value: 'a'.repeat(2001) } });
    send();
    expect(screen.getByRole('alert').textContent).toBe(LONG);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe('what-happened-error');
    expect(submitSiteProblemReport).not.toHaveBeenCalled();
  });

  it('clears the field message once the note is long enough to send', async () => {
    submitSiteProblemReport.mockResolvedValue({
      ok: false,
      code: 'rate_limited',
      message: 'Please wait.',
    });
    render(<ReportProblemForm initialPage="/pricing" showEmail />);
    send();
    expect(screen.getByRole('alert').textContent).toBe(SHORT);

    fireEvent.change(whatHappened(), { target: { value: 'The map pin was wrong.' } });
    send();
    expect(screen.queryByText(SHORT)).toBeNull();
    expect(whatHappened().getAttribute('aria-invalid')).toBeNull();
    expect(submitSiteProblemReport).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Please wait.');
    });
    expect(screen.queryByText(SHORT)).toBeNull();
  });

  it('puts a server what-happened rejection under the field', async () => {
    submitSiteProblemReport.mockResolvedValue({
      ok: false,
      code: 'what_happened',
      message: LONG,
    });
    render(<ReportProblemForm initialPage="" showEmail={false} />);
    fireEvent.change(whatHappened(), { target: { value: 'The map pin was wrong.' } });
    send();
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(LONG);
    });
    expect(whatHappened().getAttribute('aria-invalid')).toBe('true');
    expect(whatHappened().getAttribute('aria-describedby')).toBe('what-happened-error');
  });
});
