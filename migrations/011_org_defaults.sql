-- Org-level defaults, editable in Settings (admin/owner only):
--   default_terms        — the standard Terms & Conditions text new quotations start from.
--   default_advance_pct  — the suggested advance-payment percentage new quotations start from.
-- Both are only ever read when a NEW quote is created (as a starting value the salesperson
-- can edit or clear) — changing either here never rewrites an already-issued quote's own
-- stored terms/advance values, since those are snapshotted onto the quote row at creation.
alter table orgs add column if not exists default_terms text;
alter table orgs add column if not exists default_advance_pct numeric(5,2);
-- Shown alongside TRN/address/email in the printed document header.
alter table orgs add column if not exists website text;

-- One-time backfill of the real company details, from the development request — only ever
-- fills a currently-empty field, so it can never overwrite anything already entered in
-- Settings for this or any other org.
update orgs set address = 'Insurance Building, Units 202 & 201, Plot No. 57-0, Al Rega, Dubai, UAE'
  where address is null or address = '';
update orgs set email = 'sales@callistonexus.com' where email is null or email = '';
update orgs set website = 'https://callistonexus.com/' where website is null or website = '';
