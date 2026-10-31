-- Per-quote toggle for whether the "Authorisation and client acceptance" signature block
-- prints on this quotation. Defaults to true so every existing and new quote keeps showing
-- it (matching current behavior) unless a salesperson explicitly turns it off for a specific
-- quote that doesn't need it (e.g. an internal draft, or a revision where the client already
-- signed an earlier copy).
alter table quotes add column if not exists show_signoff boolean not null default true;
