import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { loadTurnstile, TURNSTILE_SITE_KEY, type TurnstileApi } from '../lib/turnstile';

export interface TurnstileHandle {
  reset(): void;
}

interface TurnstileWidgetProps {
  onToken: (token: string | null) => void;
  action?: string;
  className?: string;
}

export const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(function TurnstileWidget(
  { onToken, action, className },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const onTokenRef = useRef(onToken);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useImperativeHandle(ref, () => ({
    reset() {
      onTokenRef.current(null);
      const widget = widgetRef.current;
      if (widget) widget.api.reset(widget.id);
    },
  }), []);

  useEffect(() => {
    const tokenSink = onTokenRef;
    const widgetHolder = widgetRef;
    let cancelled = false;
    let rendered: { api: TurnstileApi; id: string } | null = null;

    loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        const id = api.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          theme: 'light',
          size: 'flexible',
          'refresh-expired': 'auto',
          callback: (token) => tokenSink.current(token),
          'expired-callback': () => tokenSink.current(null),
          'error-callback': () => {
            tokenSink.current(null);
            return true;
          },
          'timeout-callback': () => tokenSink.current(null),
        });
        rendered = { api, id };
        widgetHolder.current = rendered;
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
      if (rendered) rendered.api.remove(rendered.id);
      widgetHolder.current = null;
      tokenSink.current(null);
    };
  }, [action]);

  return (
    <div className={className} role="group" aria-label="Security check">
      <div ref={containerRef} className="min-h-[65px]" />
      {loadFailed && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          The security check could not load. Check your connection or turn off content blockers, then reload the page.
        </p>
      )}
    </div>
  );
});
