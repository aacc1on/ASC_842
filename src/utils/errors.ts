import { logUnknownError } from './unknownErrorLog';

const GENERIC_MESSAGE = 'Something went wrong. Please try again or contact support if it continues.';

const DUPLICATE_MESSAGE = 'A record with this name already exists. Use a different name.';
const FK_MESSAGE = 'A required related record was not found. Check your selections and try again.';
const PERMISSION_MESSAGE = 'You do not have permission to perform this action, or your plan does not include it.';
const CHECK_MESSAGE = 'One of the values is outside the allowed range. Check the amounts and dates and try again.';
const REQUIRED_MESSAGE = 'A required field is missing. Fill in all required fields and try again.';
export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.';
export const RATE_LIMIT_MESSAGE = 'Too many requests. Please wait a moment and try again.';
export const NETWORK_MESSAGE = 'We could not reach the server. Check your internet connection and try again.';
export const CAPTCHA_MESSAGE = 'Please complete the security check and try again.';

/** An error whose message was written for end users and is always safe to show as-is. */
export class UserFacingError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'UserFacingError';
    this.status = status;
  }
}

/**
 * Phrases produced on purpose by the application's own guard triggers and
 * validation functions. These are written for end users and are safe to show.
 */
// The plan user-limit trigger raises with a check_violation code, which would otherwise map to a generic sentence.
const USER_LIMIT_PATTERN = /^Your plan allows up to \d+ users?\. Remove a user or contact us to add more\.$/;

const SAFE_MESSAGE_PATTERNS: RegExp[] = [
  /accounting period/i,
  /Remove later months first/i,
  /requires the asset's fair value and useful life/i,
  /latest posted month/i,
  /append-only/i,
  /already (exists|posted|finalized|closed|reversed)/i,
  /posted entries/i,
  /posted periods?/i,
  /lease not found in your organization/i,
  /Use Contract Modification/i,
  /cannot be (changed|modified|deleted|reversed|negative|zero)/i,
  /cannot (modify|delete|reverse|reopen|post)/i,
  /closed (month|period)/i,
  /finalized/i,
  /not allowed/i,
  /must be/i,
  /is required/i,
  /invalid /i,
  /no longer available/i,
  /permission/i,
  /subscription/i,
  /segregation of duties/i,
  /approval note is required/i,
  /only administrators can approve/i,
  /only administrators and managers can (approve|reject)/i,
  /only administrators can (change|reject)/i,
  /comment is required/i,
  /not pending approval/i,
  /submitted for approval first/i,
  /approved items cannot be returned/i,
  /different approver can only be required/i,
  /not a member of this organization/i,
  /^item not found/i,
  /lease not found for this item/i,
  /only pending elections can be/i,
  /public business entities/i,
  /network/i,
  /timed? out/i,
  /too many requests/i,
];

/**
 * Map a Postgres error code to a user-safe message without leaking SQL details.
 * Returns undefined when the code is not one we handle.
 */
function messageForCode(code: string): string | undefined {
  if (code === '23505') return DUPLICATE_MESSAGE;
  if (code === '23503') return FK_MESSAGE;
  if (code === '23514') return CHECK_MESSAGE;
  if (code === '23502') return REQUIRED_MESSAGE;
  if (code === '42501') return PERMISSION_MESSAGE;
  if (code === 'PGRST301' || code === 'PGRST303') return SESSION_EXPIRED_MESSAGE;
  return undefined;
}

function messageForStatus(status: number | undefined): string | undefined {
  if (status === 429) return RATE_LIMIT_MESSAGE;
  if (status === 401) return SESSION_EXPIRED_MESSAGE;
  if (status === 403) return PERMISSION_MESSAGE;
  return undefined;
}

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { status?: unknown; context?: { status?: unknown } };
  const status = typeof e.status === 'number' ? e.status : typeof e.context?.status === 'number' ? e.context.status : undefined;
  return status;
}

function isNetworkError(error: unknown, message: string): boolean {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
  if (name === 'FunctionsFetchError' || name === 'AuthRetryableFetchError') return true;
  return /^(failed to fetch|load failed|networkerror when attempting to fetch resource\.?|network request failed|fetch failed)$/i.test(message);
}


/**
 * Fragments that identify internal database / PostgREST detail. Anything that
 * matches must never reach the interface: it exposes table names, constraint
 * names and the shape of the access rules.
 */
const INTERNAL_MESSAGE_PATTERNS: RegExp[] = [
  /row-level security/i,
  /violates /i,
  /constraint/i,
  /relation .* does not exist/i,
  /column .* does not exist/i,
  /function .* does not exist/i,
  /schema cache/i,
  /permission denied for (table|relation|schema|column)/i,
  /syntax error/i,
  /duplicate key/i,
  /foreign key/i,
  /null value in column/i,
  /invalid input syntax/i,
  /pg[a-z_]*:/i,
  /\bpostgres\b/i,
  /stack/i,
];

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return '';
}

/**
 * Converts any thrown value into a message that is safe to render to a user.
 * Intentional, user-facing messages raised by the application are passed
 * through; anything carrying internal database detail is replaced with a
 * generic sentence.
 */
export function toUserMessage(error: unknown, fallback?: string): string {
  const safeFallback = fallback && fallback.trim() ? fallback : GENERIC_MESSAGE;
  if (error instanceof UserFacingError && error.message.trim()) return error.message;
  if (isCaptchaError(error)) return CAPTCHA_MESSAGE;
  const message = rawMessage(error).trim();
  const code = getErrorCode(error);
  if (USER_LIMIT_PATTERN.test(message)) return message;

  // Known codes and statuses are mapped before the internal-detail check so they never produce a generic banner.
  const known = (code && messageForCode(code)) || messageForStatus(httpStatus(error));
  if (known) return known;
  if (isNetworkError(error, message)) return NETWORK_MESSAGE;

  if (message && !INTERNAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    // P0001 is an explicit RAISE EXCEPTION from the app's own triggers and functions.
    if (code === 'P0001') return message;
    if (SAFE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) return message;
  }

  logUnknownError(error, message);
  return safeFallback;
}

/** True for failures worth alerting on: anything that is not an intentional, user-facing guard message. */
export function isUnexpectedError(error: unknown): boolean {
  if (error instanceof UserFacingError) return false;
  if (isCaptchaError(error)) return false;
  const message = rawMessage(error).trim();
  const code = getErrorCode(error);
  if (code && messageForCode(code)) return false;
  if (messageForStatus(httpStatus(error))) return false;
  if (!message) return true;
  if (INTERNAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) return true;
  if (code === 'P0001') return false;
  return !SAFE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

export function isCaptchaError(error: unknown): boolean {
  if (getErrorCode(error) === 'captcha_failed') return true;
  return /captcha verification process failed|captcha protection: request disallowed/i.test(rawMessage(error));
}

export function getErrorMessage(error: unknown, fallback?: string): string {
  return toUserMessage(error, fallback);
}

/**
 * The unfiltered message. Only for logging and diagnostics - never render this.
 */
export function getRawErrorMessage(error: unknown): string {
  return rawMessage(error) || 'An unexpected error occurred';
}

export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return undefined;
}

export const DUPLICATE_NAME_MESSAGE =
  'A lease with this name already exists in this company. Use a different name (e.g. add the asset ID or a suffix).';

export function isDuplicateNameError(error: unknown): boolean {
  return getErrorCode(error) === '23505';
}
