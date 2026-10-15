import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { TurnstileHandle } from '../components/TurnstileWidget';
import type { TurnstileApi } from '../lib/turnstile';

vi.unmock('../components/TurnstileWidget');

type RenderOpts = Parameters<TurnstileApi['render']>[1];

function fakeApi() {
  const calls: RenderOpts[] = [];
  const api = {
    render: vi.fn((_el: HTMLElement, opts: RenderOpts) => {
      calls.push(opts);
      return `w${calls.length}`;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  return { api, calls };
}

async function loadModule() {
  vi.resetModules();
  const [widget, lib] = await Promise.all([import('../components/TurnstileWidget'), import('../lib/turnstile')]);
  return { ...widget, TURNSTILE_SITE_KEY: lib.TURNSTILE_SITE_KEY };
}

let appended: HTMLScriptElement[] = [];

beforeEach(() => {
  delete window.turnstile;
  appended = [];
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T) => {
    appended.push(node as unknown as HTMLScriptElement);
    return node;
  });
});

afterEach(() => {
  delete window.turnstile;
});

describe('TurnstileWidget', () => {
  it('loads the Turnstile script only once in explicit-render mode', async () => {
    const { TurnstileWidget } = await loadModule();
    const { api } = fakeApi();
    render(
      <>
        <TurnstileWidget onToken={() => {}} />
        <TurnstileWidget onToken={() => {}} />
      </>,
    );
    const scripts = appended;
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toMatch(/^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
    expect(scripts[0].src).toContain('render=explicit');

    window.turnstile = api;
    await act(async () => { scripts[0].onload?.(new Event('load')); });
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(2));
  });

  it('shows a visible message when the script fails to load', async () => {
    const { TurnstileWidget } = await loadModule();
    render(<TurnstileWidget onToken={() => {}} />);
    const [script] = appended;
    await act(async () => { script.onerror?.(new Event('error')); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/security check could not load/i);
  });

  it('renders with the site key, an accessible label and passes tokens through', async () => {
    const { TurnstileWidget, TURNSTILE_SITE_KEY } = await loadModule();
    const { api, calls } = fakeApi();
    window.turnstile = api;
    const onToken = vi.fn();
    render(<TurnstileWidget onToken={onToken} action="login" />);

    expect(screen.getByRole('group', { name: 'Security check' })).toBeInTheDocument();
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
    expect(TURNSTILE_SITE_KEY).toBe('0x4AAAAAAFV6FLkKzgUdhFWq');
    expect(calls[0]).toMatchObject({ sitekey: TURNSTILE_SITE_KEY, action: 'login' });

    act(() => calls[0].callback('tok-1'));
    expect(onToken).toHaveBeenLastCalledWith('tok-1');
    act(() => calls[0]['expired-callback']());
    expect(onToken).toHaveBeenLastCalledWith(null);
    act(() => calls[0].callback('tok-2'));
    let handled: boolean | void = false;
    act(() => { handled = calls[0]['error-callback'](); });
    expect(handled).toBe(true);
    expect(onToken).toHaveBeenLastCalledWith(null);
    act(() => calls[0].callback('tok-3'));
    act(() => calls[0]['timeout-callback']());
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it('reset() clears the token and resets the widget; unmount removes it', async () => {
    const { TurnstileWidget } = await loadModule();
    const { api, calls } = fakeApi();
    window.turnstile = api;
    const onToken = vi.fn();
    const ref = createRef<TurnstileHandle>();
    const { unmount } = render(<TurnstileWidget ref={ref} onToken={onToken} />);
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));

    act(() => calls[0].callback('tok-1'));
    act(() => ref.current!.reset());
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(api.reset).toHaveBeenCalledWith('w1');

    unmount();
    expect(api.remove).toHaveBeenCalledWith('w1');
  });
});
