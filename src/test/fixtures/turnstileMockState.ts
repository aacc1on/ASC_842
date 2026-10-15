export const turnstileMock = { autoSolve: true, issued: 0, resets: 0 };

export function resetTurnstileMock() {
  turnstileMock.autoSolve = true;
  turnstileMock.issued = 0;
  turnstileMock.resets = 0;
}

export function nextToken() {
  turnstileMock.issued += 1;
  return `test-captcha-token-${turnstileMock.issued}`;
}
