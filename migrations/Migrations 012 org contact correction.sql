-- One-time correction of the org contact details shown in the printed document header,
-- requested after reviewing a live printed quote:
--   1. Phone was never backfilled by migration 011 at all — only set here if still blank,
--      so it can never overwrite a phone number anyone has since entered in Settings.
--   2. Website was backfilled by migration 011 as 'https://callistonexus.com/' (with the
--      https:// protocol and a trailing slash), which the user asked to show as a bare
--      "www.callistonexus.com" instead (print.js prints org.website as plain text, with
--      no protocol-stripping of its own, so the stored value is exactly what appears on
--      the document). Only corrected here if it still holds that exact old default — never
--      touches a website value anyone has since customized in Settings.
update orgs set phone = '971552323997' where phone is null or phone = '';
update orgs set website = 'www.callistonexus.com' where website = 'https://callistonexus.com/';
