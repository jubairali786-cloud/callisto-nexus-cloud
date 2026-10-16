-- Callisto Nexus Cloud Accounting — initial schema
-- PostgreSQL. Multi-tenant via org_id on every business table + row-level security.

create extension if not exists pgcrypto;

-- ===================== Core tenancy =====================

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Callisto Nexus Technical Services L.L.C.',
  trn text,                              -- Tax Registration Number
  base_currency text not null default 'AED',
  address text,
  email text,
  phone text,
  logo_b64 text,                         -- data URI payload (png), optional override of built-in brand logo
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','admin','staff')),
  invite_email text,
  invite_token text,
  invite_status text not null default 'active' check (invite_status in ('pending','active','revoked')),
  created_at timestamptz not null default now(),
  unique(org_id, user_id)
);

create table sessions (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  org_id uuid references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- ===================== Currency =====================

create table exchange_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  currency_code text not null,
  rate_to_base numeric(18,6) not null,   -- 1 unit of currency_code = rate_to_base units of org base currency
  as_of date not null default current_date,
  created_at timestamptz not null default now()
);
create index on exchange_rates(org_id, currency_code, as_of desc);

-- ===================== Chart of accounts & ledger =====================

create table accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('asset','liability','equity','income','expense')),
  subtype text,                          -- e.g. 'current_asset','bank','ar','inventory','ap','vat_payable','vat_receivable'
  is_system boolean not null default false, -- system accounts (AR, AP, VAT, Inventory, COGS, Retained Earnings) locked from deletion
  parent_id uuid references accounts(id),
  created_at timestamptz not null default now(),
  unique(org_id, code)
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  entry_date date not null,
  memo text,
  source_type text,                      -- 'invoice','payment','bill','bill_payment','credit_note','adjustment','opening_balance', etc.
  source_id uuid,
  reversed_by uuid references journal_entries(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index on journal_entries(org_id, entry_date);
create index on journal_entries(org_id, source_type, source_id);

create table journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references journal_entries(id) on delete cascade,
  account_id uuid not null references accounts(id),
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  description text
);
create index on journal_lines(journal_entry_id);
create index on journal_lines(account_id);

-- ===================== Contacts =====================

create table clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address text,
  trn text,
  default_currency text,
  notes text,
  created_at timestamptz not null default now()
);

create table vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address text,
  trn text,
  default_currency text,
  notes text,
  created_at timestamptz not null default now()
);

-- ===================== Items / inventory / price lists =====================

create table items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  sku text,
  name text not null,
  description text,
  unit text default 'unit',
  item_type text not null default 'service' check (item_type in ('service','inventory')),
  sale_price numeric(18,2) not null default 0,
  vat_rate numeric(5,2) not null default 5,
  track_inventory boolean not null default false,
  qty_on_hand numeric(18,4) not null default 0,
  avg_cost numeric(18,4) not null default 0,     -- weighted average cost, base currency
  reorder_point numeric(18,4) default 0,
  reorder_qty numeric(18,4) default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table price_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  currency_code text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table price_list_items (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references price_lists(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  price numeric(18,2) not null,
  unique(price_list_id, item_id)
);

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  item_id uuid not null references items(id),
  movement_date date not null default current_date,
  qty_delta numeric(18,4) not null,        -- positive = stock in, negative = stock out
  unit_cost numeric(18,4),                 -- cost of this movement (for 'in' movements)
  resulting_avg_cost numeric(18,4),
  resulting_qty numeric(18,4),
  move_type text not null,                 -- 'purchase','sale','credit_return','purchase_return','adjustment'
  ref_type text,
  ref_id uuid,
  notes text,
  created_at timestamptz not null default now()
);
create index on stock_movements(org_id, item_id, created_at);

-- ===================== Sales: Quotes / Invoices / Credit Notes / Payments =====================

create table quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  number text not null,
  client_id uuid not null references clients(id),
  quote_date date not null default current_date,
  expiry_date date,
  currency_code text not null,
  fx_rate numeric(18,6) not null default 1,
  status text not null default 'draft' check (status in ('draft','sent','accepted','declined','converted')),
  notes text,
  terms text,
  subtotal numeric(18,2) not null default 0,
  vat_total numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(org_id, number)
);
create table quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  item_id uuid references items(id),
  description text not null,
  qty numeric(18,4) not null default 1,
  unit_price numeric(18,2) not null default 0,
  discount_pct numeric(5,2) not null default 0,
  vat_rate numeric(5,2) not null default 5,
  sort_order int not null default 0
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  number text not null,
  client_id uuid not null references clients(id),
  quote_id uuid references quotes(id),
  invoice_date date not null default current_date,
  due_date date,
  currency_code text not null,
  fx_rate numeric(18,6) not null default 1,
  status text not null default 'draft' check (status in ('draft','issued','partially_paid','paid','void')),
  notes text,
  terms text,
  subtotal numeric(18,2) not null default 0,
  vat_total numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  amount_paid numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(org_id, number)
);
create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  item_id uuid references items(id),
  description text not null,
  qty numeric(18,4) not null default 1,
  unit_price numeric(18,2) not null default 0,
  discount_pct numeric(5,2) not null default 0,
  vat_rate numeric(5,2) not null default 5,
  sort_order int not null default 0
);

create table credit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  number text not null,
  invoice_id uuid references invoices(id),
  client_id uuid not null references clients(id),
  cn_date date not null default current_date,
  currency_code text not null,
  fx_rate numeric(18,6) not null default 1,
  status text not null default 'draft' check (status in ('draft','issued')),
  reason text,
  restock boolean not null default true,
  subtotal numeric(18,2) not null default 0,
  vat_total numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(org_id, number)
);
create table credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  credit_note_id uuid not null references credit_notes(id) on delete cascade,
  item_id uuid references items(id),
  description text not null,
  qty numeric(18,4) not null default 1,
  unit_price numeric(18,2) not null default 0,
  discount_pct numeric(5,2) not null default 0,
  vat_rate numeric(5,2) not null default 5,
  sort_order int not null default 0
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  invoice_id uuid references invoices(id),
  client_id uuid references clients(id),
  payment_date date not null default current_date,
  amount numeric(18,2) not null,
  currency_code text not null,
  fx_rate numeric(18,6) not null default 1,
  method text default 'bank_transfer',
  bank_account_id uuid,
  reference text,
  created_at timestamptz not null default now()
);

-- ===================== Purchases: Vendors / POs / Bills / Bill payments =====================

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  number text not null,
  vendor_id uuid not null references vendors(id),
  po_date date not null default current_date,
  currency_code text not null,
  fx_rate numeric(18,6) not null default 1,
  status text not null default 'draft' check (status in ('draft','sent','received','closed','cancelled')),
  notes text,
  subtotal numeric(18,2) not null default 0,
  vat_total numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(org_id, number)
);
create table po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  item_id uuid references items(id),
  description text not null,
  qty numeric(18,4) not null default 1,
  unit_price numeric(18,2) not null default 0,
  vat_rate numeric(5,2) not null default 5,
  sort_order int not null default 0
);

create table bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  number text not null,            -- our internal ref
  vendor_ref text,                 -- vendor's own invoice/bill number
  vendor_id uuid not null references vendors(id),
  po_id uuid references purchase_orders(id),
  bill_date date not null default current_date,
  due_date date,
  currency_code text not null,
  fx_rate numeric(18,6) not null default 1,
  status text not null default 'draft' check (status in ('draft','open','partially_paid','paid','void')),
  notes text,
  subtotal numeric(18,2) not null default 0,
  vat_total numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  amount_paid numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(org_id, number)
);
create table bill_lines (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id) on delete cascade,
  item_id uuid references items(id),         -- set for inventory restock lines
  expense_account_id uuid references accounts(id), -- set for plain expense lines
  description text not null,
  qty numeric(18,4) not null default 1,
  unit_price numeric(18,2) not null default 0,
  vat_rate numeric(5,2) not null default 5,
  sort_order int not null default 0
);

create table bill_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  bill_id uuid not null references bills(id),
  vendor_id uuid references vendors(id),
  payment_date date not null default current_date,
  amount numeric(18,2) not null,
  currency_code text not null,
  fx_rate numeric(18,6) not null default 1,
  method text default 'bank_transfer',
  bank_account_id uuid,
  reference text,
  created_at timestamptz not null default now()
);

-- ===================== Banking =====================

create table bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  currency_code text not null,
  gl_account_id uuid not null references accounts(id),
  opening_balance numeric(18,2) not null default 0,
  created_at timestamptz not null default now()
);

create table bank_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  bank_account_id uuid not null references bank_accounts(id) on delete cascade,
  txn_date date not null,
  description text,
  amount numeric(18,2) not null,      -- positive = money in, negative = money out
  import_batch text,
  status text not null default 'unmatched' check (status in ('unmatched','matched','ignored')),
  matched_journal_entry_id uuid references journal_entries(id),
  created_at timestamptz not null default now()
);
create index on bank_transactions(org_id, bank_account_id, status);

-- ===================== Numbering sequences (per org, per doc type) =====================

create table numbering (
  org_id uuid not null references orgs(id) on delete cascade,
  doc_type text not null,     -- 'quote','invoice','credit_note','po','bill'
  prefix text not null,
  next_number int not null default 1,
  primary key (org_id, doc_type)
);
