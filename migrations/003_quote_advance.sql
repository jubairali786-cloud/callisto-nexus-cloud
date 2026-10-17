-- Same advance-payment-requested fields as invoices (migration 002), but on quotes —
-- lets a quotation state an advance requirement (e.g. "50% deposit to proceed") before
-- any invoice exists. Purely informational, same as on invoices.
alter table quotes add column if not exists advance_type text check (advance_type in ('percent','fixed'));
alter table quotes add column if not exists advance_value numeric(18,2);
