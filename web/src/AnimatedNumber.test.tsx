// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { AnimatedNumber } from './AnimatedNumber';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('counts towards the server value, keeps the exact accessible value, and cancels on unmount', () => {
  let tick: FrameRequestCallback = () => {};
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((next: FrameRequestCallback) => {
      tick = next;
      return 1;
    }),
  );
  const cancel = vi.fn();
  vi.stubGlobal('cancelAnimationFrame', cancel);
  const { container, unmount } = render(<AnimatedNumber value={81.25} decimals={2} />);
  const visual = () => container.querySelector('[aria-hidden]')?.textContent;
  expect(container.querySelector('.sr-only')?.textContent).toBe('81,25');
  expect(visual()).toBe('0,00');
  act(() => tick(375));
  expect(visual()).not.toBe('0,00');
  expect(visual()).not.toBe('81,25');
  act(() => tick(750));
  expect(visual()).toBe('81,25');
  unmount();
  expect(cancel).toHaveBeenCalled();
});
it('does not animate reduced motion or treat missing values as zero', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const frame = vi.fn();
  vi.stubGlobal('requestAnimationFrame', frame);
  const { container, rerender } = render(<AnimatedNumber value={0} />);
  expect(container.querySelector('[aria-hidden]')?.textContent).toBe('0');
  rerender(<AnimatedNumber value={7} />);
  expect(container.querySelector('[aria-hidden]')?.textContent).toBe('7');
  expect(frame).not.toHaveBeenCalled();
  rerender(<AnimatedNumber value={null} />);
  expect(container.textContent).toBe('—');
});
