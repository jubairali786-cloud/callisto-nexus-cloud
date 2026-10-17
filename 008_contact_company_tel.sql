-- Clients/Vendors gain two optional extra fields: "Company Name" (the business entity's
-- name, kept separate from the "Name" field people use as a contact person) and
-- "Tel Number" (an office landline, kept separate from the general "Phone" field).
alter table clients add column if not exists company_name text;
alter table clients add column if not exists tel text;

alter table vendors add column if not exists company_name text;
alter table vendors add column if not exists tel text;
