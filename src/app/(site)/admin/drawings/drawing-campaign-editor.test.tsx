import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawingCampaignCreate, DrawingCampaignEdit } from '@/app/(site)/admin/drawings/drawing-campaign-editor';
import { CAMPAIGN_EDITOR_MAX_PRIZES } from '@/lib/drawings/campaign-editor';

const refresh = vi.hoisted(() => vi.fn());
const createDrawingCampaignAction = vi.hoisted(() => vi.fn());
const updateDrawingCampaignAction = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('./actions', () => ({
  createDrawingCampaignAction,
  updateDrawingCampaignAction,
}));

const QUARTERS = ['2027-Q1', '2027-Q2', '2027-Q3', '2027-Q4'];

function fillEqualBudget() {
  fireEvent.change(screen.getByLabelText('Total budget (dollars)'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Fulfillment allowance (dollars)'), { target: { value: '20' } });
  fireEvent.change(screen.getByLabelText('Prize label'), { target: { value: 'Dinner for two' } });
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Unit value (dollars)'), { target: { value: '40' } });
}

describe('drawing campaign editor', () => {
  beforeEach(() => {
    refresh.mockReset();
    createDrawingCampaignAction.mockReset();
    updateDrawingCampaignAction.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('adds and removes prize rows, and stops at 10', () => {
    render(<DrawingCampaignCreate quarters={QUARTERS} />);
    fireEvent.click(screen.getByRole('button', { name: 'New sample campaign' }));
    expect(screen.getAllByLabelText('Prize label')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Add prize' }));
    expect(screen.getAllByLabelText('Prize label')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Remove prize 2' }));
    expect(screen.getAllByLabelText('Prize label')).toHaveLength(1);
    for (let count = 1; count < CAMPAIGN_EDITOR_MAX_PRIZES; count += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Add prize' }));
    }
    expect(screen.getAllByLabelText('Prize label')).toHaveLength(CAMPAIGN_EDITOR_MAX_PRIZES);
    expect(screen.getByRole('button', { name: 'Add prize' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove prize 10' }));
    expect(screen.getByRole('button', { name: 'Add prize' })).toHaveProperty('disabled', false);
  });

  it('shows the sample-prize preview and the Chicago quarter dates', () => {
    render(<DrawingCampaignCreate quarters={QUARTERS} />);
    fireEvent.click(screen.getByRole('button', { name: 'New sample campaign' }));
    expect(screen.getByText('Jan 1, 2027 – Mar 31, 2027')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Prize label'), { target: { value: 'Dinner for two' } });
    expect(screen.getByText('Saved as Sample prize: Dinner for two')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Mode' })).toBeNull();
  });

  it('disables save when committed cents are over the total', () => {
    render(<DrawingCampaignCreate quarters={QUARTERS} />);
    fireEvent.click(screen.getByRole('button', { name: 'New sample campaign' }));
    fireEvent.change(screen.getByLabelText('Total budget (dollars)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Fulfillment allowance (dollars)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Prize label'), { target: { value: 'Dinner for two' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Unit value (dollars)'), { target: { value: '40' } });
    const line = screen.getByText('Committed $110.00 of $100.00 budget');
    expect(line.className).toContain('text-destructive');
    const save = screen.getByRole('button', { name: 'Save draft' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.click(save);
    expect(createDrawingCampaignAction).not.toHaveBeenCalled();
  });

  it('shows a field error for zero prizes and a quantity of 0, and does not call the action', () => {
    render(<DrawingCampaignCreate quarters={QUARTERS} />);
    fireEvent.click(screen.getByRole('button', { name: 'New sample campaign' }));
    fillEqualBudget();
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByText('Enter a whole number from 1 to 1,000.')).toBeTruthy();
    expect(createDrawingCampaignAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove prize 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByText('Add at least one sample prize.')).toBeTruthy();
    expect(createDrawingCampaignAction).not.toHaveBeenCalled();
  });

  it('saves a draft once while a second click is ignored', async () => {
    let release: (value: { ok: true }) => void = () => {};
    createDrawingCampaignAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(<DrawingCampaignCreate quarters={QUARTERS} />);
    fireEvent.click(screen.getByRole('button', { name: 'New sample campaign' }));
    fillEqualBudget();
    expect(screen.getByText('Committed $100.00 of $100.00 budget')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save draft' });
    expect(save).toHaveProperty('disabled', false);
    fireEvent.click(save);
    fireEvent.click(save);
    expect(createDrawingCampaignAction).toHaveBeenCalledTimes(1);
    expect(createDrawingCampaignAction).toHaveBeenCalledWith(
      expect.objectContaining({
        quarterKey: '2027-Q1',
        totalBudgetDollars: '100',
        fulfillmentAllowanceDollars: '20',
        prizes: [expect.objectContaining({ label: 'Dinner for two', quantity: '2', unitValueDollars: '40' })],
      }),
    );
    release({ ok: true });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Draft saved.'));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(updateDrawingCampaignAction).not.toHaveBeenCalled();
  });

  it('sends an edit to update with the campaign id', async () => {
    updateDrawingCampaignAction.mockResolvedValue({ ok: true });
    render(
      <DrawingCampaignEdit
        campaignId="c2222222-2222-4222-8222-222222222222"
        quarters={QUARTERS}
        seed={{
          quarterKey: '2027-Q1',
          totalBudgetDollars: '100.00',
          fulfillmentAllowanceDollars: '20.00',
          prizes: [{ label: 'Sample prize: Dinner for two', quantity: '2', unitValueDollars: '40.00' }],
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByDisplayValue('Sample prize: Dinner for two')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Prize label'), { target: { value: 'Sample prize: Lunch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(updateDrawingCampaignAction).toHaveBeenCalledTimes(1));
    expect(updateDrawingCampaignAction).toHaveBeenCalledWith(
      'c2222222-2222-4222-8222-222222222222',
      expect.objectContaining({
        prizes: [expect.objectContaining({ label: 'Sample prize: Lunch' })],
      }),
    );
    expect(createDrawingCampaignAction).not.toHaveBeenCalled();
  });
});
