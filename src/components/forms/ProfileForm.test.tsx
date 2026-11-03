import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTOFILL_ANIMATION_NAME } from '@/components/forms/AddressFields';
import { ProfileForm } from '@/components/forms/ProfileForm';

vi.mock('@/app/actions/check-username', () => ({
  checkUsername: vi.fn(async () => ({ ok: true, status: 'unchanged' as const })),
}));

const empty = {
  username: '',
  address: { street: '', city: '', state: '', zip: '' },
};

describe('ProfileForm autofill', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it('enables Continue from DOM autofill without focus or blur', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ProfileForm
          initialValues={empty}
          onSubmit={() => undefined}
          submitLabel="Continue"
          currentUserId="user-1"
        />,
      );
    });

    const form = container.querySelector('form');
    const username = container.querySelector<HTMLInputElement>('#profile-username');
    const street = container.querySelector<HTMLInputElement>('#address-street');
    const city = container.querySelector<HTMLInputElement>('#address-city');
    const state = container.querySelector<HTMLSelectElement>('#address-state');
    const zip = container.querySelector<HTMLInputElement>('#address-zip');
    expect(form && username && street && city && state && zip).toBeTruthy();

    username!.value = 'foodie';
    street!.value = '123 Main St';
    city!.value = 'McKinney';
    state!.value = 'TX';
    zip!.value = '75071';

    await act(async () => {
      form!.dispatchEvent(
        new AnimationEvent('animationstart', {
          animationName: AUTOFILL_ANIMATION_NAME,
          bubbles: true,
        }),
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 550));
    });

    const button = container.querySelector('button[type="submit"]');
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).not.toBe(username);
    expect(document.activeElement).not.toBe(street);
  });
});
