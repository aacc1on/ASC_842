/**
 * Upload limits for the Documents area.
 *
 * These values mirror the restrictions enforced by storage itself (the
 * `documents` bucket carries the same MIME allowlist and size limit), so the
 * browser can show a clear message instead of a raw storage rejection. The
 * browser copy is advisory only: the server remains the enforcement point.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const ALLOWED_UPLOAD_MIME_TYPES: string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

export const UPLOAD_ACCEPT_ATTRIBUTE = ALLOWED_UPLOAD_MIME_TYPES.join(',');
