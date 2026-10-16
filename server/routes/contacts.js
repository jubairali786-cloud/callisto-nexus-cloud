import { sql } from "../db.js";
import { json, err } from "../lib/helpers.js";
import { Router } from "../lib/router.js";

export const router = new Router();

function requireOrg(ctx) {
  if (!ctx || !ctx.orgId) return err("Not authenticated", 401);
  return null;
}

// -------- Clients --------
router.get("/api/clients", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`select * from clients where org_id=${ctx.orgId} order by name`;
  return json({ clients: rows });
});
router.get("/api/clients/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`select * from clients where org_id=${ctx.orgId} and id=${params.id}`;
  if (!rows.length) return err("Client not found", 404);
  return json({ client: rows[0] });
});
router.post("/api/clients", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.name) return err("name is required");
  const [row] = await sql`
    insert into clients (org_id, name, email, phone, address, trn, default_currency, notes)
    values (${ctx.orgId}, ${b.name}, ${b.email || null}, ${b.phone || null}, ${b.address || null}, ${b.trn || null}, ${b.defaultCurrency || null}, ${b.notes || null})
    returning *
  `;
  return json({ client: row }, 201);
});
router.put("/api/clients/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [row] = await sql`
    update clients set name=${b.name}, email=${b.email || null}, phone=${b.phone || null}, address=${b.address || null},
      trn=${b.trn || null}, default_currency=${b.defaultCurrency || null}, notes=${b.notes || null}
    where org_id=${ctx.orgId} and id=${params.id} returning *
  `;
  if (!row) return err("Client not found", 404);
  return json({ client: row });
});
router.del("/api/clients/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const used = await sql`select 1 from invoices where org_id=${ctx.orgId} and client_id=${params.id} limit 1`;
  if (used.length) return err("Cannot delete a client with existing invoices. Archive instead or delete their invoices first.", 409);
  await sql`delete from clients where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});

// -------- Vendors --------
router.get("/api/vendors", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`select * from vendors where org_id=${ctx.orgId} order by name`;
  return json({ vendors: rows });
});
router.get("/api/vendors/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`select * from vendors where org_id=${ctx.orgId} and id=${params.id}`;
  if (!rows.length) return err("Vendor not found", 404);
  return json({ vendor: rows[0] });
});
router.post("/api/vendors", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.name) return err("name is required");
  const [row] = await sql`
    insert into vendors (org_id, name, email, phone, address, trn, default_currency, notes)
    values (${ctx.orgId}, ${b.name}, ${b.email || null}, ${b.phone || null}, ${b.address || null}, ${b.trn || null}, ${b.defaultCurrency || null}, ${b.notes || null})
    returning *
  `;
  return json({ vendor: row }, 201);
});
router.put("/api/vendors/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [row] = await sql`
    update vendors set name=${b.name}, email=${b.email || null}, phone=${b.phone || null}, address=${b.address || null},
      trn=${b.trn || null}, default_currency=${b.defaultCurrency || null}, notes=${b.notes || null}
    where org_id=${ctx.orgId} and id=${params.id} returning *
  `;
  if (!row) return err("Vendor not found", 404);
  return json({ vendor: row });
});
router.del("/api/vendors/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const used = await sql`select 1 from bills where org_id=${ctx.orgId} and vendor_id=${params.id} limit 1`;
  if (used.length) return err("Cannot delete a vendor with existing bills.", 409);
  await sql`delete from vendors where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});
