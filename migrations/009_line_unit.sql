-- Adds a free-text "Unit" field (e.g. pcs, kg, hrs, box, m) to every document's line items,
-- so quotes/invoices/credit notes/purchase orders/bills can show a unit of measure per line,
-- not just quantity. Defaults from the catalog item's own "Unit" (Items & Services) when a
-- line is built by picking a catalog item, but can always be typed/edited per line.
alter table quote_lines add column if not exists unit text;
alter table invoice_lines add column if not exists unit text;
alter table credit_note_lines add column if not exists unit text;
alter table po_lines add column if not exists unit text;
alter table bill_lines add column if not exists unit text;
