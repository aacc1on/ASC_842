const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const DEFAULT_SITE_KEY = '0x4AAAAAAFV6FLkKzgUdhFWq';

const RAW_SITE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY;

// VITE_TURNSTILE_SITE_KEY=off skips the widget (e.g. a host whose Turnstile widget is not set up yet).
// Only use it while Supabase Auth CAPTCHA protection is OFF; Supabase ignores the placeholder token then.
export const TURNSTILE_DISABLED: boolean = RAW_SITE_KEY?.trim().toLowerCase() === 'off';
export const TURNSTILE_DISABLED_TOKEN = 'turnstile-disabled';

export const TURNSTILE_SITE_KEY: string = (!TURNSTILE_DISABLED && RAW_SITE_KEY) || DEFAULT_SITE_KEY;

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'flexible' | 'compact';
  'refresh-expired'?: 'auto' | 'manual' | 'never';
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => boolean | void;
  'timeout-callback': () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('Turnstile did not initialise'));
      };
      script.onerror = () => {
        scriptPromise = null;
        script.remove();
        reject(new Error('Turnstile failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}
