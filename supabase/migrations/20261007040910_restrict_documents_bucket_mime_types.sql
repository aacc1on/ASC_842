/*
# Restrict the document storage bucket to an allowlist of file types

1. Security changes
- The `documents` bucket had `allowed_mime_types = null`, so any content type up
  to the 50 MB size limit could be stored, including HTML and SVG payloads that
  other organisation members would later open.
- An explicit allowlist of document, image and spreadsheet types is now enforced
  by storage itself, independently of the browser.

2. Notes
- The bucket stays private and the 52428800-byte size limit is unchanged.
- Existing objects are untouched.
*/

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
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
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]
WHERE id = 'documents';
