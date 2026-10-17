-- Links Purchase Orders and Bills to a Project (optional — a PO/Bill can exist with no
-- project, same as before). Unlike quotes/invoices, there's no client to auto-fill here:
-- a project has exactly one client, but can be supplied by many different vendors, so
-- picking a project on a PO/Bill never touches the vendor field.
alter table purchase_orders add column if not exists project_id uuid references projects(id);
alter table bills add column if not exists project_id uuid references projects(id);

create index if not exists po_project_idx on purchase_orders(project_id);
create index if not exists bills_project_idx on bills(project_id);
