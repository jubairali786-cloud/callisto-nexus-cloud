import { sql } from "../db.js";

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
export function err(message, status = 400) {
  return json({ error: message }, status);
}

export const DEFAULT_PREFIXES = {
  quote: "CNT-QT-",
  invoice: "CNT-INV-",
  credit_note: "CNT-CN-",
  po: "CNT-PO-",
  bill: "CNT-BILL-",
  project: "CNT-PRJ-",
};

export async function nextNumber(orgId, docType) {
  return await sql.begin(async (tx) => {
    let rows = await tx`select prefix, next_number from numbering where org_id=${orgId} and doc_type=${docType} for update`;
    let prefix, n;
    if (!rows.length) {
      prefix = DEFAULT_PREFIXES[docType] || (docType.toUpperCase() + "-");
      n = 1;
      await tx`insert into numbering (org_id, doc_type, prefix, next_number) values (${orgId}, ${docType}, ${prefix}, 2)`;
    } else {
      prefix = rows[0].prefix;
      n = rows[0].next_number;
      await tx`update numbering set next_number = next_number + 1 where org_id=${orgId} and doc_type=${docType}`;
    }
    return `${prefix}${String(n).padStart(4, "0")}`;
  });
}

// Fetches the most recent manually-entered exchange rate for a currency, or 1 if it's the base currency.
export async function resolveFxRate(orgId, currencyCode, baseCurrency, asOfDate) {
  if (currencyCode === baseCurrency) return 1;
  const rows = await sql`
    select rate_to_base from exchange_rates
    where org_id=${orgId} and currency_code=${currencyCode} and as_of <= ${asOfDate || new Date().toISOString().slice(0, 10)}
    order by as_of desc limit 1
  `;
  if (rows.length) return Number(rows[0].rate_to_base);
  const anyRate = await sql`select rate_to_base from exchange_rates where org_id=${orgId} and currency_code=${currencyCode} order by as_of desc limit 1`;
  return anyRate.length ? Number(anyRate[0].rate_to_base) : 1;
}

// Computes subtotal/vat/total from a lines array (camelCase: qty, unitPrice, discountPct, vatRate
// — the shape every API endpoint accepts lines in, matching server/lib/doclines.js).
export function computeTotals(lines) {
  let subtotal = 0, vatTotal = 0;
  for (const l of lines) {
    const qty = Number(l.qty || 0);
    const price = Number(l.unitPrice || 0);
    const disc = Number(l.discountPct || 0);
    const vatRate = Number(l.vatRate || 0);
    const lineBase = qty * price * (1 - disc / 100);
    subtotal += lineBase;
    vatTotal += lineBase * (vatRate / 100);
  }
  return {
    subtotal: round2(subtotal),
    vatTotal: round2(vatTotal),
    total: round2(subtotal + vatTotal),
  };
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Postgres `date` columns round-trip through Bun's SQL driver as JS Date objects; passing
// one back into another query as a bind param can serialize via Date#toString() rather than
// an ISO date, which Postgres then rejects. Always normalize to a plain YYYY-MM-DD string
// before using a date value fetched from the DB as a parameter in a further query.
export function toISODate(d) {
  if (d == null) return d;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === "string") return d.slice(0, 10);
  return d;
}

// Computes the advance amount currently requested on an invoice — a percentage of
// the final VAT-inclusive total, or a flat AED amount — clamped to [0, total].
// Purely informational: it never affects amount_paid/balance, which only move
// when an actual payment is recorded via POST /api/invoices/:id/payments.
export function advanceAmount(invoice) {
  if (!invoice || !invoice.advance_type || invoice.advance_value == null) return 0;
  const total = Number(invoice.total);
  const raw = invoice.advance_type === "percent" ? (total * Number(invoice.advance_value)) / 100 : Number(invoice.advance_value);
  return round2(Math.min(Math.max(raw, 0), total));
}

// Validates the advanceType/advanceValue fields from an invoice create/update
// request body. Returns { advanceType, advanceValue } (both null = no advance
// requested) or { error } if what was sent doesn't make sense.
export function parseAdvance(b) {
  if (b.advanceType === "percent" || b.advanceType === "fixed") {
    const v = Number(b.advanceValue);
    if (!Number.isFinite(v) || v < 0) return { error: "Advance value must be a positive number" };
    if (b.advanceType === "percent" && v > 100) return { error: "Advance percentage can't exceed 100%" };
    return { advanceType: b.advanceType, advanceValue: round2(v) };
  }
  if (b.advanceType) return { error: "advanceType must be 'percent' or 'fixed'" };
  return { advanceType: null, advanceValue: null };
}

export async function requireOrgAndRole(ctx, roles) {
  if (!ctx || !ctx.orgId) return err("Not authenticated or no org selected", 401);
  if (roles && !roles.includes(ctx.role)) return err("Insufficient permissions", 403);
  return null;
}
