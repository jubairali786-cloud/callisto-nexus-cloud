-- Supports the new "a project is created only when its quotation is accepted" workflow.
-- Quotes gain optional project-planning fields that get copied onto the project the moment
-- it's created (never before, and never again afterwards once the project already has its
-- own values) plus an acceptance timestamp for display. Projects gain a payment-terms field
-- to hold the quote's terms once copied over.
alter table quotes add column if not exists project_title text;
alter table quotes add column if not exists location text;
alter table quotes add column if not exists scope_of_work text;
alter table quotes add column if not exists accepted_at timestamptz;

alter table projects add column if not exists payment_terms text;
