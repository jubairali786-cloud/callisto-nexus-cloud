import { sql } from "../db.js";
import { json, err, nextNumber, computeTotals } from "../lib/helpers.js";
import { replaceCreditNoteLines, getCreditNoteLines, getInvoiceLines } from "../lib/doclines.js";
import { postCreditNoteIssue } from "../lib/sales-posting.js";
import { Router } from "../lib/router.js";

export const router = new Router();
function requireOrg(ctx) { if (!ctx || !ctx.orgId) return err("Not authenticated", 401); return null; }

router.get("/api/credit-notes", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`
    select cn.*, c.name as client_name, i.number as invoice_number from credit_notes cn
    join clients c on c.id=cn.client_id left join invoices i on i.id=cn.invoice_id
    where cn.org_id=${ctx.orgId} order by cn.cn_date desc, cn.created_at desc
  `;
  return json({ creditNotes: rows });
});

router.get("/api/credit-notes/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [cn] = await sql`
    select cn.*, c.name as client_name, i.number as invoice_number from credit_notes cn
    join clients c on c.id=cn.client_id left join invoices i on i.id=cn.invoice_id
    where cn.org_id=${ctx.orgId} and cn.id=${params.id}
  `;
  if (!cn) return err("Credit note not found", 404);
  const lines = await getCreditNoteLines(params.id);
  return json({ creditNote: cn, lines });
});

router.post("/api/credit-notes", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.clientId || !Array.isArray(b.lines) || !b.lines.length) return err("clientId and at least one line are required");

  let currency = b.currencyCode, fxRate = b.fxRate || 1;
  if (b.invoiceId) {
    const [inv] = await sql`select currency_code, fx_rate from invoices where id=${b.invoiceId} and org_id=${ctx.orgId}`;
    if (inv) { currency = currency || inv.currency_code; fxRate = b.fxRate || inv.fx_rate; }
  }
  if (!currency) {
    const [org] = await sql`select base_currency from orgs where id=${ctx.orgId}`;
    currency = org.base_currency;
  }

  const totals = computeTotals(b.lines);
  const number = await nextNumber(ctx.orgId, "credit_note");
  const cn = await sql.begin(async (tx) => {
    const [row] = await tx`
      insert into credit_notes (org_id, number, invoice_id, client_id, cn_date, currency_code, fx_rate, status, reason, restock, subtotal, vat_total, total)
      values (${ctx.orgId}, ${number}, ${b.invoiceId || null}, ${b.clientId}, ${b.cnDate || new Date().toISOString().slice(0, 10)},
        ${currency}, ${fxRate}, 'draft', ${b.reason || null}, ${b.restock !== false}, ${totals.subtotal}, ${totals.vatTotal}, ${totals.total})
      returning *
    `;
    await replaceCreditNoteLines(tx, row.id, b.lines);
    return row;
  });
  return json({ creditNote: cn }, 201);
});

router.post("/api/credit-notes/:id/issue", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [cn] = await sql`select * from credit_notes where org_id=${ctx.orgId} and id=${params.id}`;
  if (!cn) return err("Credit note not found", 404);
  if (cn.status !== "draft") return err("Only draft credit notes can be issued", 409);
  const lines = await getCreditNoteLines(cn.id);
  await postCreditNoteIssue(cn, lines, ctx.user.id);
  const [updated] = await sql`update credit_notes set status='issued' where id=${cn.id} returning *`;
  return json({ creditNote: updated });
});

router.del("/api/credit-notes/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [existing] = await sql`select status from credit_notes where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Credit note not found", 404);
  if (existing.status !== "draft") return err("Only draft credit notes can be deleted", 409);
  await sql`delete from credit_notes where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});
