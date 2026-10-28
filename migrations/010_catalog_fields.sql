-- Smart Service Catalog: adds category grouping, a stable item code (separate from the
-- free-text SKU field), a default service note (shown/combined on quotations), and
-- optional service-specific terms to every catalog item. All additive, all nullable or
-- defaulted, so existing items and existing quotes/invoices referencing them are untouched.

alter table items add column if not exists category text;
alter table items add column if not exists item_code text;
alter table items add column if not exists default_notes text;
alter table items add column if not exists service_terms text;

-- A code only needs to be unique within an org (two orgs could reasonably reuse "AC-001"),
-- and only enforced once a code is actually set — existing items with no code yet are
-- unaffected, and the catalog seed (011) is written to upsert on this constraint so
-- re-running it never creates duplicates.
create unique index if not exists items_org_item_code_uq on items (org_id, item_code) where item_code is not null;
