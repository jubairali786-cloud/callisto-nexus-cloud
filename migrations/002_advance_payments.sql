-- Advance / partial payment requests on invoices (purely informational — the
-- requested amount never affects amount_paid/balance; only an actual recorded
-- payment does that), plus a free-text notes field on payments.
alter table invoices add column if not exists advance_type text check (advance_type in ('percent','fixed'));
alter table invoices add column if not exists advance_value numeric(18,2);
alter table payments add column if not exists notes text;
