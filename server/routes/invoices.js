import { sql } from "../db.js";
import { json, err, nextNumber, resolveFxRate, computeTotals, round2, advanceAmount, parseAdvance } from "../lib/helpers.js";
import { replaceInvoiceLines, getInvoiceLines } from "../lib/doclines.js";
import { postInvoiceIssue, postInvoicePayment, postInvoiceVoid } from "../lib/sales-posting.js";
import { Router } from "../lib/router.js";

export const router = new Router();
function requireOrg(ctx) { if (!ctx || !ctx.orgId) return err("Not authenticated", 401); return null; }

// Same Project Number resolution as quotes.js: picking an existing project forces
// clientId to that project's client (auto-filled, never mismatched). There's no
// "create a new project" option here any more — per the current workflow, a project is
// only ever created by accepting a quotation (server/routes/quotes.js), so this field can
// only link an invoice to a project that already exists.
async function resolveProjectLink(ctx, b, fallbackClientId) {
  if (b.projectId) {
    const [project] = await sql`select id, client_id from projects where org_id=${ctx.orgId} and id=${b.projectId}`;
    if (!project) return { error: "Project not found" };
    return { projectId: project.id, clientId: project.client_id };
  }
  if (b.projectId === null) return { projectId: null, clientId: b.clientId || fallbackClientId };
  return { projectId: undefined, clientId: b.clientId || fallbackClientId };
}

router.get("/api/invoices", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`
    select i.*, c.name as client_name, p.project_number,
      (select coalesce(sum(cn.total),0) from credit_notes cn where cn.invoice_id=i.id and cn.status='issued') as credited_total
    from invoices i join clients c on c.id=i.client_id left join projects p on p.id=i.project_id
    where i.org_id=${ctx.orgId} order by i.invoice_date desc, i.created_at desc
  `;
  return json({ invoices: rows.map(withBalance) });
});

function withBalance(inv) {
  const balance = round2(Number(inv.total) - Number(inv.amount_paid) - Number(inv.credited_total || 0));
  return { ...inv, balance, advance_amount: advanceAmount(inv) };
}

router.get("/api/invoices/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [invoice] = await sql`select i.*, c.name as client_name, c.email as client_email, p.project_number from invoices i join clients c on c.id=i.client_id left join projects p on p.id=i.project_id where i.org_id=${ctx.orgId} and i.id=${params.id}`;
  if (!invoice) return err("Invoice not found", 404);
  const lines = await getInvoiceLines(params.id);
  const payments = await sql`select * from payments where invoice_id=${params.id} order by payment_date`;
  const creditNotes = await sql`select * from credit_notes where invoice_id=${params.id} order by cn_date`;
  return json({ invoice: { ...invoice, advance_amount: advanceAmount(invoice) }, lines, payments, creditNotes });
});

router.post("/api/invoices", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const link = await resolveProjectLink(ctx, b, null);
  if (link.error) return err(link.error);
  if (!link.clientId || !Array.isArray(b.lines) || !b.lines.length) return err("clientId and at least one line are required");
  const adv = parseAdvance(b);
  if (adv.error) return err(adv.error);
  const [org] = await sql`select base_currency from orgs where id=${ctx.orgId}`;
  const currency = b.currencyCode || org.base_currency;
  const fxRate = b.fxRate || await resolveFxRate(ctx.orgId, currency, org.base_currency, b.invoiceDate);
  const totals = computeTotals(b.lines);
  const number = await nextNumber(ctx.orgId, "invoice");

  const invoice = await sql.begin(async (tx) => {
    const [inv] = await tx`
      insert into invoices (org_id, number, client_id, project_id, invoice_date, due_date, currency_code, fx_rate, status, notes, terms, subtotal, vat_total, total, advance_type, advance_value)
      values (${ctx.orgId}, ${number}, ${link.clientId}, ${link.projectId || null}, ${b.invoiceDate || new Date().toISOString().slice(0, 10)}, ${b.dueDate || null},
        ${currency}, ${fxRate}, 'draft', ${b.notes || null}, ${b.terms || null}, ${totals.subtotal}, ${totals.vatTotal}, ${totals.total},
        ${adv.advanceType}, ${adv.advanceValue})
      returning *
    `;
    await replaceInvoiceLines(tx, inv.id, b.lines);
    return inv;
  });
  return json({ invoice: { ...invoice, advance_amount: advanceAmount(invoice) } }, 201);
});

router.put("/api/invoices/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [existing] = await sql`select * from invoices where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Invoice not found", 404);
  if (existing.status !== "draft") return err("Only draft invoices can be edited. Void and recreate if something's wrong.", 409);
  const link = await resolveProjectLink(ctx, b, existing.client_id);
  if (link.error) return err(link.error);
  const adv = parseAdvance(b);
  if (adv.error) return err(adv.error);
  const totals = computeTotals(b.lines || []);
  const invoice = await sql.begin(async (tx) => {
    const [inv] = await tx`
      update invoices set client_id=${link.clientId}, project_id=${link.projectId === undefined ? existing.project_id : link.projectId},
        invoice_date=${b.invoiceDate}, due_date=${b.dueDate || null},
        currency_code=${b.currencyCode || existing.currency_code}, fx_rate=${b.fxRate || existing.fx_rate},
        notes=${b.notes || null}, terms=${b.terms || null}, subtotal=${totals.subtotal}, vat_total=${totals.vatTotal}, total=${totals.total},
        advance_type=${adv.advanceType}, advance_value=${adv.advanceValue}
      where id=${params.id} returning *
    `;
    if (Array.isArray(b.lines)) await replaceInvoiceLines(tx, inv.id, b.lines);
    return inv;
  });
  return json({ invoice: { ...invoice, advance_amount: advanceAmount(invoice) } });
});

// Links an EXISTING invoice (any status) to a project — same reasoning as the quotes
// equivalent: this rejects a client mismatch outright rather than overriding it, since
// an issued invoice's client is already a committed fact.
router.post("/api/invoices/:id/link-project", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [invoice] = await sql`select * from invoices where org_id=${ctx.orgId} and id=${params.id}`;
  if (!invoice) return err("Invoice not found", 404);
  const [project] = await sql`select * from projects where org_id=${ctx.orgId} and id=${b.projectId}`;
  if (!project) return err("Project not found", 404);
  if (project.client_id !== invoice.client_id) return err(`This invoice's client doesn't match ${project.project_number}'s client (${project.name}). Link it to a project for the same client.`, 409);
  const [updated] = await sql`update invoices set project_id=${project.id} where id=${params.id} returning *`;
  return json({ invoice: { ...updated, advance_amount: advanceAmount(updated) } });
});

// Issues a draft invoice: locks it (no more line edits) and posts the GL entry + inventory movement.
router.post("/api/invoices/:id/issue", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [invoice] = await sql`select * from invoices where org_id=${ctx.orgId} and id=${params.id}`;
  if (!invoice) return err("Invoice not found", 404);
  if (invoice.status !== "draft") return err("Only draft invoices can be issued", 409);
  const lines = await getInvoiceLines(invoice.id);
  await postInvoiceIssue(invoice, lines, ctx.user.id);
  const [updated] = await sql`update invoices set status='issued' where id=${invoice.id} returning *`;
  return json({ invoice: updated });
});

router.post("/api/invoices/:id/void", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [invoice] = await sql`select * from invoices where org_id=${ctx.orgId} and id=${params.id}`;
  if (!invoice) return err("Invoice not found", 404);
  if (!["issued", "partially_paid"].includes(invoice.status)) return err("Only issued invoices can be voided", 409);
  if (Number(invoice.amount_paid) > 0) return err("Cannot void an invoice with recorded payments. Refund/delete the payments first.", 409);
  const lines = await getInvoiceLines(invoice.id);
  await postInvoiceVoid(invoice, lines, ctx.user.id);
  const [updated] = await sql`update invoices set status='void' where id=${invoice.id} returning *`;
  return json({ invoice: updated });
});

router.del("/api/invoices/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [existing] = await sql`select status from invoices where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Invoice not found", 404);
  if (existing.status !== "draft") return err("Only draft invoices can be deleted. Void an issued invoice instead.", 409);
  await sql`delete from invoices where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});

// -------- Payments --------
router.post("/api/invoices/:id/payments", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [invoice] = await sql`select * from invoices where org_id=${ctx.orgId} and id=${params.id}`;
  if (!invoice) return err("Invoice not found", 404);
  if (!["issued", "partially_paid"].includes(invoice.status)) return err("Payments can only be recorded on issued invoices", 409);
  if (!b.amount || Number(b.amount) <= 0) return err("amount must be greater than 0");

  const fxRate = b.fxRate || invoice.fx_rate;
  let bankGlAccountId = null;
  if (b.bankAccountId) {
    const [bank] = await sql`select gl_account_id from bank_accounts where id=${b.bankAccountId} and org_id=${ctx.orgId}`;
    bankGlAccountId = bank?.gl_account_id || null;
  }

  const result = await sql.begin(async (tx) => {
    const [payment] = await tx`
      insert into payments (org_id, invoice_id, client_id, payment_date, amount, currency_code, fx_rate, method, bank_account_id, reference, notes)
      values (${ctx.orgId}, ${invoice.id}, ${invoice.client_id}, ${b.paymentDate || new Date().toISOString().slice(0, 10)}, ${round2(b.amount)},
        ${b.currencyCode || invoice.currency_code}, ${fxRate}, ${b.method || "bank_transfer"}, ${b.bankAccountId || null}, ${b.reference || null}, ${b.notes || null})
      returning *
    `;
    const newPaid = round2(Number(invoice.amount_paid) + Number(payment.amount));
    const newStatus = newPaid >= Number(invoice.total) - 0.01 ? "paid" : "partially_paid";
    const [updatedInvoice] = await tx`update invoices set amount_paid=${newPaid}, status=${newStatus} where id=${invoice.id} returning *`;
    return { payment, invoice: updatedInvoice };
  });
  await postInvoicePayment(result.invoice, result.payment, bankGlAccountId, ctx.user.id);
  return json(result, 201);
});

router.del("/api/payments/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [payment] = await sql`select * from payments where org_id=${ctx.orgId} and id=${params.id}`;
  if (!payment) return err("Payment not found", 404);
  const { findJournalEntryForSource, reverseJournalEntry } = await import("../lib/ledger.js");
  const journalId = await findJournalEntryForSource(ctx.orgId, "payment", payment.id);
  if (journalId) await reverseJournalEntry({ orgId: ctx.orgId, journalEntryId: journalId, entryDate: new Date().toISOString().slice(0, 10), memo: "Payment reversed/deleted", createdBy: ctx.user.id });
  if (payment.invoice_id) {
    const [invoice] = await sql`select * from invoices where id=${payment.invoice_id}`;
    if (invoice) {
      const newPaid = round2(Number(invoice.amount_paid) - Number(payment.amount));
      const newStatus = newPaid <= 0.01 ? "issued" : "partially_paid";
      await sql`update invoices set amount_paid=${Math.max(0, newPaid)}, status=${newStatus} where id=${invoice.id}`;
    }
  }
  await sql`delete from payments where id=${payment.id}`;
  return json({ ok: true });
});

router.get("/api/payments", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`
    select p.*, c.name as client_name, i.number as invoice_number from payments p
    left join clients c on c.id=p.client_id left join invoices i on i.id=p.invoice_id
    where p.org_id=${ctx.orgId} order by p.payment_date desc
  `;
  return json({ payments: rows });
});
