import { sql } from "../db.js";
import { json, err, nextNumber, resolveFxRate, round2 } from "../lib/helpers.js";
import { replacePoLines, getPoLines, replaceBillLines, getBillLines } from "../lib/doclines.js";
import { postBillOpen, postBillPayment } from "../lib/purchase-posting.js";
import { Router } from "../lib/router.js";

export const router = new Router();
function requireOrg(ctx) { if (!ctx || !ctx.orgId) return err("Not authenticated", 401); return null; }

function computePoTotals(lines) {
  let subtotal = 0, vatTotal = 0;
  for (const l of lines) {
    const base = Number(l.qty) * Number(l.unitPrice);
    subtotal += base;
    vatTotal += base * (Number(l.vatRate || 0) / 100);
  }
  return { subtotal: round2(subtotal), vatTotal: round2(vatTotal), total: round2(subtotal + vatTotal) };
}

// -------- Purchase Orders --------
router.get("/api/purchase-orders", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`
    select po.*, v.name as vendor_name from purchase_orders po join vendors v on v.id=po.vendor_id
    where po.org_id=${ctx.orgId} order by po.po_date desc, po.created_at desc
  `;
  return json({ purchaseOrders: rows });
});
router.get("/api/purchase-orders/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [po] = await sql`select po.*, v.name as vendor_name from purchase_orders po join vendors v on v.id=po.vendor_id where po.org_id=${ctx.orgId} and po.id=${params.id}`;
  if (!po) return err("Purchase order not found", 404);
  const lines = await getPoLines(params.id);
  return json({ purchaseOrder: po, lines });
});
router.post("/api/purchase-orders", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.vendorId || !Array.isArray(b.lines) || !b.lines.length) return err("vendorId and at least one line are required");
  const [org] = await sql`select base_currency from orgs where id=${ctx.orgId}`;
  const currency = b.currencyCode || org.base_currency;
  const fxRate = b.fxRate || await resolveFxRate(ctx.orgId, currency, org.base_currency, b.poDate);
  const totals = computePoTotals(b.lines);
  const number = await nextNumber(ctx.orgId, "po");
  const po = await sql.begin(async (tx) => {
    const [row] = await tx`
      insert into purchase_orders (org_id, number, vendor_id, po_date, currency_code, fx_rate, status, notes, subtotal, vat_total, total)
      values (${ctx.orgId}, ${number}, ${b.vendorId}, ${b.poDate || new Date().toISOString().slice(0, 10)}, ${currency}, ${fxRate}, 'draft', ${b.notes || null}, ${totals.subtotal}, ${totals.vatTotal}, ${totals.total})
      returning *
    `;
    await replacePoLines(tx, row.id, b.lines);
    return row;
  });
  return json({ purchaseOrder: po }, 201);
});
router.post("/api/purchase-orders/:id/status", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const { status } = await req.json().catch(() => ({}));
  if (!["draft", "sent", "received", "closed", "cancelled"].includes(status)) return err("Invalid status");
  const [row] = await sql`update purchase_orders set status=${status} where org_id=${ctx.orgId} and id=${params.id} returning *`;
  if (!row) return err("Purchase order not found", 404);
  return json({ purchaseOrder: row });
});
router.del("/api/purchase-orders/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  await sql`delete from purchase_orders where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});

// Converts a PO into a draft bill carrying over its lines (vendor confirms goods/invoice received).
router.post("/api/purchase-orders/:id/convert-to-bill", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [po] = await sql`select * from purchase_orders where org_id=${ctx.orgId} and id=${params.id}`;
  if (!po) return err("Purchase order not found", 404);
  const lines = await getPoLines(po.id);
  const number = await nextNumber(ctx.orgId, "bill");
  const bill = await sql.begin(async (tx) => {
    const [row] = await tx`
      insert into bills (org_id, number, vendor_id, po_id, bill_date, due_date, currency_code, fx_rate, status, subtotal, vat_total, total)
      values (${ctx.orgId}, ${number}, ${po.vendor_id}, ${po.id}, current_date, current_date + interval '30 days', ${po.currency_code}, ${po.fx_rate}, 'draft', ${po.subtotal}, ${po.vat_total}, ${po.total})
      returning *
    `;
    await replaceBillLines(tx, row.id, lines.map((l) => ({ itemId: l.item_id, description: l.description, qty: l.qty, unitPrice: l.unit_price, vatRate: l.vat_rate })));
    await tx`update purchase_orders set status='closed' where id=${po.id}`;
    return row;
  });
  return json({ bill }, 201);
});

// -------- Bills --------
router.get("/api/bills", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`
    select b.*, v.name as vendor_name from bills b join vendors v on v.id=b.vendor_id
    where b.org_id=${ctx.orgId} order by b.bill_date desc, b.created_at desc
  `;
  return json({ bills: rows.map((b) => ({ ...b, balance: round2(Number(b.total) - Number(b.amount_paid)) })) });
});
router.get("/api/bills/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [bill] = await sql`select b.*, v.name as vendor_name from bills b join vendors v on v.id=b.vendor_id where b.org_id=${ctx.orgId} and b.id=${params.id}`;
  if (!bill) return err("Bill not found", 404);
  const lines = await getBillLines(params.id);
  const payments = await sql`select * from bill_payments where bill_id=${params.id} order by payment_date`;
  return json({ bill, lines, payments });
});
router.post("/api/bills", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.vendorId || !Array.isArray(b.lines) || !b.lines.length) return err("vendorId and at least one line are required");
  const [org] = await sql`select base_currency from orgs where id=${ctx.orgId}`;
  const currency = b.currencyCode || org.base_currency;
  const fxRate = b.fxRate || await resolveFxRate(ctx.orgId, currency, org.base_currency, b.billDate);
  const totals = computePoTotals(b.lines);
  const number = await nextNumber(ctx.orgId, "bill");
  const bill = await sql.begin(async (tx) => {
    const [row] = await tx`
      insert into bills (org_id, number, vendor_ref, vendor_id, bill_date, due_date, currency_code, fx_rate, status, notes, subtotal, vat_total, total)
      values (${ctx.orgId}, ${number}, ${b.vendorRef || null}, ${b.vendorId}, ${b.billDate || new Date().toISOString().slice(0, 10)}, ${b.dueDate || null},
        ${currency}, ${fxRate}, 'draft', ${b.notes || null}, ${totals.subtotal}, ${totals.vatTotal}, ${totals.total})
      returning *
    `;
    await replaceBillLines(tx, row.id, b.lines);
    return row;
  });
  return json({ bill }, 201);
});

router.post("/api/bills/:id/open", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [bill] = await sql`select * from bills where org_id=${ctx.orgId} and id=${params.id}`;
  if (!bill) return err("Bill not found", 404);
  if (bill.status !== "draft") return err("Only draft bills can be recorded/opened", 409);
  const lines = await getBillLines(bill.id);
  await postBillOpen(bill, lines, ctx.user.id);
  const [updated] = await sql`update bills set status='open' where id=${bill.id} returning *`;
  return json({ bill: updated });
});

router.del("/api/bills/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [existing] = await sql`select status from bills where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Bill not found", 404);
  if (existing.status !== "draft") return err("Only draft bills can be deleted", 409);
  await sql`delete from bills where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});

router.post("/api/bills/:id/payments", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [bill] = await sql`select * from bills where org_id=${ctx.orgId} and id=${params.id}`;
  if (!bill) return err("Bill not found", 404);
  if (!["open", "partially_paid"].includes(bill.status)) return err("Payments can only be recorded on open bills", 409);
  if (!b.amount || Number(b.amount) <= 0) return err("amount must be greater than 0");

  let bankGlAccountId = null;
  if (b.bankAccountId) {
    const [bank] = await sql`select gl_account_id from bank_accounts where id=${b.bankAccountId} and org_id=${ctx.orgId}`;
    bankGlAccountId = bank?.gl_account_id || null;
  }
  const result = await sql.begin(async (tx) => {
    const [payment] = await tx`
      insert into bill_payments (org_id, bill_id, vendor_id, payment_date, amount, currency_code, fx_rate, method, bank_account_id, reference)
      values (${ctx.orgId}, ${bill.id}, ${bill.vendor_id}, ${b.paymentDate || new Date().toISOString().slice(0, 10)}, ${round2(b.amount)},
        ${b.currencyCode || bill.currency_code}, ${b.fxRate || bill.fx_rate}, ${b.method || "bank_transfer"}, ${b.bankAccountId || null}, ${b.reference || null})
      returning *
    `;
    const newPaid = round2(Number(bill.amount_paid) + Number(payment.amount));
    const newStatus = newPaid >= Number(bill.total) - 0.01 ? "paid" : "partially_paid";
    const [updatedBill] = await tx`update bills set amount_paid=${newPaid}, status=${newStatus} where id=${bill.id} returning *`;
    return { payment, bill: updatedBill };
  });
  await postBillPayment(result.bill, result.payment, bankGlAccountId, ctx.user.id);
  return json(result, 201);
});
