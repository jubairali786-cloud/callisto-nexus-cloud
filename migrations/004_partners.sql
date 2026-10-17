-- Investment & Partners module.
--
-- Two new system GL accounts so partner capital/loan money moves through the normal
-- double-entry ledger exactly like everything else in the app (and therefore never shows
-- up as sales revenue or business profit -- see server/lib/partner-posting.js):
--   2200 Partner Loans Payable (liability) -- money a partner lends TO the company
--   3100 Partners' Capital    (equity)     -- capital contributed / withdrawn / distributed
-- Seeded for every existing org here; new orgs get them from ensureSystemAccounts() same
-- as the rest of the chart of accounts.
insert into accounts (org_id, code, name, type, subtype, is_system)
  select id, '2200', 'Partner Loans Payable', 'liability', 'partner_loans', true from orgs
  on conflict (org_id, code) do nothing;
insert into accounts (org_id, code, name, type, subtype, is_system)
  select id, '3100', 'Partners'' Capital', 'equity', 'partners_capital', true from orgs
  on conflict (org_id, code) do nothing;

-- Partner roster. ownership_pct is the CURRENT ownership %, kept in sync by share
-- transfers (and direct edits). profit_share_pct is an optional, separately-agreed
-- profit-sharing ratio -- when null, profit allocation falls back to ownership_pct.
create table partners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  ownership_pct numeric(6,3) not null default 0,
  profit_share_pct numeric(6,3),
  status text not null default 'active' check (status in ('active','inactive')),
  notes text,
  created_at timestamptz not null default now()
);
create index on partners(org_id, status);

-- Share sale (between two existing/new partners, money never touches company books) or
-- a new investment into the company (money goes into the company; ownership afterwards
-- must be explicitly entered, see server/routes/partners.js).
create table share_transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  transfer_type text not null check (transfer_type in ('share_sale','new_investment')),
  seller_partner_id uuid references partners(id),   -- null for new_investment
  buyer_partner_id uuid not null references partners(id),
  pct_transferred numeric(6,3) not null,
  sale_price numeric(18,2),
  effective_date date not null default current_date,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partially_paid','paid')),
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index on share_transfers(org_id, effective_date);

-- A snapshot of a partner's ownership % as of an effective date -- written whenever a
-- partner is created, their ownership is directly corrected, or a share transfer changes
-- ownership. Lets profit allocation for a PAST period use the ownership that was actually
-- in effect then, instead of silently applying today's percentages to history.
create table partner_ownership_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  partner_id uuid not null references partners(id) on delete cascade,
  ownership_pct numeric(6,3) not null,
  effective_date date not null default current_date,
  share_transfer_id uuid references share_transfers(id),
  created_at timestamptz not null default now()
);
create index on partner_ownership_snapshots(org_id, partner_id, effective_date);

-- A calculated profit split for a period. Stays 'draft' (an estimate) until explicitly
-- approved; neither state pays or posts anything by itself -- an actual payout is always
-- a separate, explicit 'distribution' row in partner_transactions below.
create table profit_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  net_profit numeric(18,2) not null,
  allocation_method text not null check (allocation_method in ('ownership','profit_share_ratio')),
  status text not null default 'draft' check (status in ('draft','approved')),
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index on profit_allocations(org_id, from_date, to_date);

create table profit_allocation_lines (
  id uuid primary key default gen_random_uuid(),
  profit_allocation_id uuid not null references profit_allocations(id) on delete cascade,
  partner_id uuid not null references partners(id),
  pct_used numeric(6,3) not null,
  amount numeric(18,2) not null
);

-- Every capital movement: money IN (contribution, loan) or OUT (withdrawal, loan
-- repayment, distribution). Each one posts a balanced GL entry (see partner-posting.js)
-- against Cash & Bank and either Partners' Capital (equity) or Partner Loans Payable
-- (liability) -- never an income/expense account, so these never inflate sales or profit.
create table partner_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  partner_id uuid not null references partners(id),
  txn_type text not null check (txn_type in ('contribution','loan','withdrawal','loan_repayment','distribution')),
  amount numeric(18,2) not null,
  currency_code text not null default 'AED',
  fx_rate numeric(18,6) not null default 1,
  txn_date date not null default current_date,
  method text default 'bank_transfer',
  bank_account_id uuid references bank_accounts(id),
  reference text,
  notes text,
  profit_allocation_id uuid references profit_allocations(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index on partner_transactions(org_id, partner_id, txn_date);
