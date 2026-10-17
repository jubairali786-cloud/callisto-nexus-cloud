-- Projects module: ties quotations, invoices, customer LPOs/attachments and the
-- project's billing picture together under one record. Project status (quotation
-- sent / awaiting LPO / approved / in progress / completed / cancelled) is tracked
-- independently of invoice/payment status — see server/routes/projects.js for the
-- billing math (approved value vs. invoiced vs. paid vs. remaining).

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_number text not null,
  name text not null,
  client_id uuid not null references clients(id),
  contact_person text,
  location text,
  scope_of_work text,
  notes text,
  status text not null default 'quotation_sent'
    check (status in ('quotation_sent','awaiting_lpo','approved','in_progress','completed','cancelled')),
  -- Approved contract total (VAT-inclusive) — the basis for advance-invoice % calculations.
  -- Set manually, or auto-filled the first time a signed LPO is marked Approved (never
  -- silently overwritten after that — see project-attachments approval endpoint).
  approved_value numeric(18,2),
  approved_currency text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique(org_id, project_number)
);
create index on projects(org_id, client_id);
create index on projects(org_id, status);

-- Customer LPOs / signed quotations / contracts / completion docs attached to a project.
-- Files are stored as base64 directly in Postgres (not on local disk) so uploads survive
-- app restarts and redeploys on a host with ephemeral disk (e.g. Render's free tier).
create table project_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null default 'other' check (kind in ('lpo','signed_quotation','contract','completion','other')),
  file_name text not null,
  mime_type text not null,
  file_b64 text not null,
  file_size int not null default 0,
  -- LPO-specific fields (meaningful only when kind='lpo')
  lpo_number text,
  lpo_date date,
  lpo_value numeric(18,2),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  related_quote_id uuid references quotes(id),
  notes text,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index on project_attachments(org_id, project_id);

alter table quotes add column if not exists project_id uuid references projects(id);
alter table invoices add column if not exists project_id uuid references projects(id);
alter table invoices add column if not exists invoice_kind text not null default 'standard'
  check (invoice_kind in ('standard','advance','progress','final'));
alter table invoices add column if not exists lpo_attachment_id uuid references project_attachments(id);

create index if not exists quotes_project_idx on quotes(project_id);
create index if not exists invoices_project_idx on invoices(project_id);
