export type ExternalNavigationResult = 'same-tab' | 'new-tab' | 'blocked';

export interface PendingExternalNavigation {
  go(url: string): ExternalNavigationResult;
  cancel(): void;
}

export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

// Stripe pages refuse to render inside an iframe (e.g. the Bolt preview), so a framed app
// opens them in a new tab. The tab is opened synchronously during the click, before the
// URL is fetched, so popup blockers treat it as user-initiated; opener is cut immediately.
export function prepareExternalNavigation(): PendingExternalNavigation {
  if (!isFramed()) {
    return {
      go(url) {
        window.location.assign(url);
        return 'same-tab';
      },
      cancel() {},
    };
  }

  const tab = window.open('', '_blank');
  if (tab) {
    try { tab.opener = null; } catch { /* noop */ }
  }

  return {
    go(url) {
      if (!tab || tab.closed) return 'blocked';
      tab.location.href = url;
      return 'new-tab';
    },
    cancel() {
      if (tab && !tab.closed) tab.close();
    },
  };
}
