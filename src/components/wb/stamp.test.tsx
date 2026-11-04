import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { stampRotationDegrees } from '@/lib/passport/passport-board';
import { Stamp } from '@/components/wb/stamp';

const ID = '22222222-2222-4222-8222-222222222222';

describe('Stamp unlock face', () => {
  afterEach(() => {
    cleanup();
  });

  it('plays the slam and a hidden burst inside the resting rotation', () => {
    const rotation = stampRotationDegrees(ID);
    render(
      <Stamp
        name="The Yard"
        date="Apr 26"
        neighborhood="Downtown"
        inkColor="#6d28d9"
        rotation={rotation}
        playSlam
        onSelect={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name: /The Yard/ });
    expect(button.className).toContain('wb-stamp-slam');
    expect(button.getAttribute('data-rotation')).toBe(String(rotation));
    expect(button.getAttribute('style')).toBeNull();
    const rest = button.parentElement;
    expect(rest?.getAttribute('data-stamp-rest')).toBe(String(rotation));
    expect(rest?.getAttribute('style')).toContain(`rotate(${rotation}deg)`);
    const burst = rest?.querySelector('[data-stamp-burst]');
    expect(burst?.getAttribute('aria-hidden')).toBe('true');
    expect(burst?.className).toContain('wb-ink-burst');
    expect(document.querySelectorAll('.wb-stamp-slam')).toHaveLength(1);
  });

  it('shows the stamp at rest with no burst when the slam is off', () => {
    const rotation = stampRotationDegrees(ID);
    render(
      <Stamp
        name="The Yard"
        date="Apr 26"
        neighborhood="Downtown"
        rotation={rotation}
        onSelect={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name: /The Yard/ });
    expect(button.className).not.toContain('wb-stamp-slam');
    expect(button.parentElement?.querySelector('[data-stamp-burst]')).toBeNull();
    expect(button.parentElement?.getAttribute('style')).toContain(`rotate(${rotation}deg)`);
  });
});
