import { sql } from "../db.js";
import { json, err, nextNumber, resolveFxRate, computeTotals } from "../lib/helpers.js";
import { replaceQuoteLines, getQuoteLines } from "../lib/doclines.js";
import { Router } from "../lib/router.js";

export const router = new Router();
function requireOrg(ctx) { if (!ctx || !ctx.orgId) return err("Not authenticated", 401); return null; }

router.get("/api/quotes", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`
    select q.*, c.name as client_name from quotes q join clients c on c.id=q.client_id
    where q.org_id=${ctx.orgId} order by q.quote_date desc, q.created_at desc
  `;
  return json({ quotes: rows });
});

router.get("/api/quotes/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [quote] = await sql`select q.*, c.name as client_name from quotes q join clients c on c.id=q.client_id where q.org_id=${ctx.orgId} and q.id=${params.id}`;
  if (!quote) return err("Quote not found", 404);
  const lines = await getQuoteLines(params.id);
  return json({ quote, lines });
});

router.post("/api/quotes", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.clientId || !Array.isArray(b.lines) || !b.lines.length) return err("clientId and at least one line are required");
  const [org] = await sql`select base_currency from orgs where id=${ctx.orgId}`;
  const currency = b.currencyCode || org.base_currency;
  const fxRate = b.fxRate || await resolveFxRate(ctx.orgId, currency, org.base_currency, b.quoteDate);
  const totals = computeTotals(b.lines);
  const number = await nextNumber(ctx.orgId, "quote");

  const result = await sql.begin(async (tx) => {
    const [quote] = await tx`
      insert into quotes (org_id, number, client_id, quote_date, expiry_date, currency_code, fx_rate, status, notes, terms, subtotal, vat_total, total)
      values (${ctx.orgId}, ${number}, ${b.clientId}, ${b.quoteDate || new Date().toISOString().slice(0, 10)}, ${b.expiryDate || null},
        ${currency}, ${fxRate}, 'draft', ${b.notes || null}, ${b.terms || null}, ${totals.subtotal}, ${totals.vatTotal}, ${totals.total})
      returning *
    `;
    await replaceQuoteLines(tx, quote.id, b.lines);
    return quote;
  });
  return json({ quote: result }, 201);
});

router.put("/api/quotes/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [existing] = await sql`select * from quotes where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Quote not found", 404);
  if (existing.status === "converted") return err("Cannot edit a quote that has already been converted to an invoice", 409);
  const totals = computeTotals(b.lines || []);
  const result = await sql.begin(async (tx) => {
    const [quote] = await tx`
      update quotes set client_id=${b.clientId}, quote_date=${b.quoteDate}, expiry_date=${b.expiryDate || null},
        currency_code=${b.currencyCode || existing.currency_code}, fx_rate=${b.fxRate || existing.fx_rate},
        notes=${b.notes || null}, terms=${b.terms || null}, subtotal=${totals.subtotal}, vat_total=${totals.vatTotal}, total=${totals.total}
      where id=${params.id} returning *
    `;
    if (Array.isArray(b.lines)) await replaceQuoteLines(tx, quote.id, b.lines);
    return quote;
  });
  return json({ quote: result });
});

router.post("/api/quotes/:id/status", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const { status } = await req.json().catch(() => ({}));
  if (!["draft", "sent", "accepted", "declined"].includes(status)) return err("Invalid status");
  const [row] = await sql`update quotes set status=${status} where org_id=${ctx.orgId} and id=${params.id} returning *`;
  if (!row) return err("Quote not found", 404);
  return json({ quote: row });
});

router.del("/api/quotes/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [existing] = await sql`select status from quotes where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Quote not found", 404);
  if (existing.status === "converted") return err("Cannot delete a quote already converted to an invoice", 409);
  await sql`delete from quotes where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});

// Converts an accepted (or any non-converted) quote into a draft invoice carrying over its lines.
router.post("/api/quotes/:id/convert", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [quote] = await sql`select * from quotes where org_id=${ctx.orgId} and id=${params.id}`;
  if (!quote) return err("Quote not found", 404);
  if (quote.status === "converted") return err("This quote was already converted", 409);
  const lines = await getQuoteLines(quote.id);
  const number = await nextNumber(ctx.orgId, "invoice");
  const invoice = await sql.begin(async (tx) => {
    const [inv] = await tx`
      insert into invoices (org_id, number, client_id, quote_id, invoice_date, due_date, currency_code, fx_rate, status, notes, terms, subtotal, vat_total, total)
      values (${ctx.orgId}, ${number}, ${quote.client_id}, ${quote.id}, current_date, current_date + interval '14 days',
        ${quote.currency_code}, ${quote.fx_rate}, 'draft', ${quote.notes}, ${quote.terms}, ${quote.subtotal}, ${quote.vat_total}, ${quote.total})
      returning *
    `;
    const { replaceInvoiceLines } = await import("../lib/doclines.js");
    await replaceInvoiceLines(tx, inv.id, lines.map((l) => ({
      itemId: l.item_id, description: l.description, qty: l.qty, unitPrice: l.unit_price, discountPct: l.discount_pct, vatRate: l.vat_rate,
    })));
    await tx`update quotes set status='converted' where id=${quote.id}`;
    return inv;
  });
  return json({ invoice }, 201);
});
