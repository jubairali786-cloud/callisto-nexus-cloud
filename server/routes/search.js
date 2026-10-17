// Global search across Projects, Clients, Quotations, Invoices, and Customer LPOs.
// Scoped to the signed-in org only (the same tenancy boundary every other route uses) —
// there's nothing from the owner/admin-only Investment & Partners module in here.
import { sql } from "../db.js";
import { json, err, round2 } from "../lib/helpers.js";
import { Router } from "../lib/router.js";

export const router = new Router();
function requireOrg(ctx) { if (!ctx || !ctx.orgId) return err("Not authenticated", 401); return null; }

const LIMIT = 8;

router.get("/api/search", async (req, ctx, params, url) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return json({ query: q, groups: [] });
  const like = `%${q}%`;

  const [projectRows, clientRows, quoteRows, invoiceRows, lpoRows] = await Promise.all([
    sql`
      select p.id, p.project_number, p.name, p.status, p.approved_value, c.name as client_name
      from projects p join clients c on c.id=p.client_id
      where p.org_id=${ctx.orgId} and (p.project_number ilike ${like} or p.name ilike ${like} or c.name ilike ${like})
      order by p.created_at desc limit ${LIMIT}
    `,
    sql`
      select id, name, email, phone from clients
      where org_id=${ctx.orgId} and name ilike ${like}
      order by name limit ${LIMIT}
    `,
    sql`
      select q.id, q.number, q.status, q.total, q.currency_code, c.name as client_name, p.project_number
      from quotes q join clients c on c.id=q.client_id left join projects p on p.id=q.project_id
      where q.org_id=${ctx.orgId} and q.number ilike ${like}
      order by q.created_at desc limit ${LIMIT}
    `,
    sql`
      select i.id, i.number, i.status, i.total, i.amount_paid, i.currency_code, c.name as client_name, p.project_number
      from invoices i join clients c on c.id=i.client_id left join projects p on p.id=i.project_id
      where i.org_id=${ctx.orgId} and i.number ilike ${like}
      order by i.created_at desc limit ${LIMIT}
    `,
    sql`
      select a.id, a.lpo_number, a.lpo_value, a.approval_status, a.project_id, p.project_number, c.name as client_name
      from project_attachments a join projects p on p.id=a.project_id join clients c on c.id=p.client_id
      where a.org_id=${ctx.orgId} and a.kind='lpo' and a.lpo_number ilike ${like}
      order by a.created_at desc limit ${LIMIT}
    `,
  ]);

  const groups = [
    {
      type: "project", label: "Projects",
      results: projectRows.map((p) => ({ id: p.id, title: p.project_number, subtitle: `${p.name} · ${p.client_name}`, status: p.status, amount: p.approved_value != null ? Number(p.approved_value) : null, href: `#/projects/${p.id}` })),
    },
    {
      type: "client", label: "Clients",
      results: clientRows.map((c) => ({ id: c.id, title: c.name, subtitle: c.email || c.phone || "", status: null, amount: null, href: `#/clients/${c.id}` })),
    },
    {
      type: "quote", label: "Quotations",
      results: quoteRows.map((q) => ({ id: q.id, title: q.number, subtitle: `${q.client_name}${q.project_number ? ` · ${q.project_number}` : ""}`, status: q.status, amount: Number(q.total), currency: q.currency_code, href: `#/quotes/${q.id}` })),
    },
    {
      type: "invoice", label: "Invoices",
      results: invoiceRows.map((i) => ({ id: i.id, title: i.number, subtitle: `${i.client_name}${i.project_number ? ` · ${i.project_number}` : ""}`, status: i.status, amount: Number(i.total), currency: i.currency_code, href: `#/invoices/${i.id}` })),
    },
    {
      type: "lpo", label: "Customer LPOs",
      results: lpoRows.map((a) => ({ id: a.id, title: a.lpo_number || "(no LPO number)", subtitle: `${a.project_number} · ${a.client_name}`, status: a.approval_status, amount: a.lpo_value != null ? Number(a.lpo_value) : null, href: `#/projects/${a.project_id}` })),
    },
  ].filter((g) => g.results.length > 0);

  return json({ query: q, groups });
});
