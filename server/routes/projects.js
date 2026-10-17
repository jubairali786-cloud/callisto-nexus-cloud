import { sql } from "../db.js";
import { json, err, round2, nextNumber, resolveFxRate, toISODate } from "../lib/helpers.js";
import { Router } from "../lib/router.js";

export const router = new Router();
function requireOrg(ctx) { if (!ctx || !ctx.orgId) return err("Not authenticated", 401); return null; }

const KIND_LABELS = {
  lpo: "Customer LPO", signed_quotation: "Signed quotation", contract: "Contract", completion: "Completion document", other: "Document",
};

// Computes the project's billing picture from the sales documents already linked to it —
// never a separate ledger of its own, so there's nothing to keep in sync or double-count.
// approvedValue==null means "not set yet"; callers must treat remainingToInvoice as unknown
// (not zero) in that case — see the `warnings` this returns.
async function projectBilling(orgId, projectId, approvedValue, approvedCurrency, baseCurrency) {
  const invoices = await sql`
    select i.id, i.status, i.total, i.subtotal, i.amount_paid, i.currency_code,
      (select coalesce(sum(cn.total),0) from credit_notes cn where cn.invoice_id=i.id and cn.status='issued') as credited_total
    from invoices i where i.org_id=${orgId} and i.project_id=${projectId}
  `;
  const nonVoid = invoices.filter((i) => i.status !== "void");
  const invoicedTotal = round2(nonVoid.reduce((s, i) => s + Number(i.total), 0));
  const paymentsReceived = round2(nonVoid.reduce((s, i) => s + Number(i.amount_paid), 0));
  const outstandingOnInvoices = round2(
    nonVoid.filter((i) => ["issued", "partially_paid"].includes(i.status))
      .reduce((s, i) => s + Math.max(Number(i.total) - Number(i.amount_paid) - Number(i.credited_total || 0), 0), 0)
  );
  const warnings = [];
  let remainingToInvoice = null;
  if (approvedValue == null) {
    warnings.push("No approved project value set — \"remaining amount to invoice\" can't be calculated until one is entered (Edit Project, or approve a customer LPO with a value).");
  } else {
    remainingToInvoice = round2(Math.max(Number(approvedValue) - invoicedTotal, 0));
  }
  const currencyMismatch = nonVoid.some((i) => i.currency_code !== (approvedCurrency || baseCurrency));
  if (currencyMismatch) warnings.push("This project has invoices in more than one currency — the totals above are a simple sum, not currency-converted.");

  // Revenue net of VAT (what the business actually earns) — used for the profit
  // calculation below, never for the VAT-inclusive figures above.
  const revenueNet = round2(nonVoid.reduce((s, i) => s + Number(i.subtotal), 0));

  // Purchase order commitments: all non-cancelled POs, regardless of whether they've since
  // been billed — this is deliberately a separate "what's been committed" figure, not a
  // cost. It is NEVER added into Supplier Bills or Project Profit below, so a PO that gets
  // converted into a bill is never counted twice.
  const purchaseOrders = await sql`
    select po.id, po.status, po.total, po.currency_code from purchase_orders po
    where po.org_id=${orgId} and po.project_id=${projectId}
  `;
  const poCounted = purchaseOrders.filter((po) => po.status !== "cancelled");
  const poCommitments = round2(poCounted.reduce((s, po) => s + Number(po.total), 0));

  // Supplier bills: the actual recorded cost against this project (a PO is a commitment,
  // not yet a cost — only bills count here). Matches invoicedTotal's own convention of
  // including drafts (not just 'void' is excluded) so a draft bill immediately counts
  // toward costs the moment it's entered, the same way a draft advance invoice immediately
  // counts toward "already invoiced" to prevent double billing.
  const bills = await sql`
    select b.id, b.status, b.total, b.subtotal, b.amount_paid, b.currency_code from bills b
    where b.org_id=${orgId} and b.project_id=${projectId}
  `;
  const billsCounted = bills.filter((b) => b.status !== "void");
  const supplierBillsTotal = round2(billsCounted.reduce((s, b) => s + Number(b.total), 0));
  const supplierBillsNet = round2(billsCounted.reduce((s, b) => s + Number(b.subtotal), 0));
  const paymentsToSuppliers = round2(billsCounted.reduce((s, b) => s + Number(b.amount_paid), 0));
  const billCurrencyMismatch = billsCounted.some((b) => b.currency_code !== (approvedCurrency || baseCurrency))
    || poCounted.some((po) => po.currency_code !== (approvedCurrency || baseCurrency));
  if (billCurrencyMismatch) warnings.push("This project has purchase orders or bills in more than one currency — the purchasing totals above are a simple sum, not currency-converted.");

  // Project profit: invoiced revenue minus billed supplier costs, BOTH net of VAT (VAT is
  // never revenue or cost, so including it here would misstate profit) — never purchase
  // order commitments (not yet an actual cost) and never cash received/paid (payments are
  // timing, not profit — see the explicit note on the two "Payments ..." figures above).
  const projectProfit = round2(revenueNet - supplierBillsNet);

  return {
    approvedValue: approvedValue != null ? Number(approvedValue) : null, approvedCurrency: approvedCurrency || baseCurrency,
    invoicedTotal, paymentsReceived, outstandingOnInvoices, remainingToInvoice,
    poCommitments, supplierBillsTotal, paymentsToSuppliers,
    projectProfit, profitBasis: "Invoiced revenue minus supplier bills, both excluding VAT — cash received/paid and PO commitments are not part of this calculation.",
    warnings,
  };
}

// -------- Projects --------
router.get("/api/projects", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`
    select p.*, c.name as client_name,
      (select coalesce(sum(i.total),0) from invoices i where i.project_id=p.id and i.status<>'void') as invoiced_total
    from projects p join clients c on c.id=p.client_id
    where p.org_id=${ctx.orgId} order by p.created_at desc
  `;
  const projects = rows.map((p) => ({
    ...p,
    invoiced_total: round2(Number(p.invoiced_total)),
    remaining_to_invoice: p.approved_value != null ? round2(Math.max(Number(p.approved_value) - Number(p.invoiced_total), 0)) : null,
  }));
  return json({ projects });
});

router.post("/api/projects", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.name) return err("name is required");
  if (!b.clientId) return err("clientId is required");
  const [client] = await sql`select id from clients where org_id=${ctx.orgId} and id=${b.clientId}`;
  if (!client) return err("Client not found", 404);
  const statusOk = ["quotation_sent", "awaiting_lpo", "approved", "in_progress", "completed", "cancelled"];
  const status = statusOk.includes(b.status) ? b.status : "quotation_sent";
  const [org] = await sql`select base_currency from orgs where id=${ctx.orgId}`;
  const projectNumber = await nextNumber(ctx.orgId, "project");
  const [project] = await sql`
    insert into projects (org_id, project_number, name, client_id, contact_person, location, scope_of_work, notes, status, approved_value, approved_currency, created_by)
    values (${ctx.orgId}, ${projectNumber}, ${b.name}, ${b.clientId}, ${b.contactPerson || null}, ${b.location || null}, ${b.scopeOfWork || null}, ${b.notes || null}, ${status},
      ${b.approvedValue != null && b.approvedValue !== "" ? round2(b.approvedValue) : null}, ${b.approvedCurrency || org.base_currency}, ${ctx.user.id})
    returning *
  `;
  return json({ project }, 201);
});

router.get("/api/projects/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [project] = await sql`select p.*, c.name as client_name, c.email as client_email, c.phone as client_phone from projects p join clients c on c.id=p.client_id where p.org_id=${ctx.orgId} and p.id=${params.id}`;
  if (!project) return err("Project not found", 404);
  const [org] = await sql`select base_currency from orgs where id=${ctx.orgId}`;

  const quotes = await sql`select id, number, status, quote_date, total, currency_code, terms, accepted_at, created_at from quotes where org_id=${ctx.orgId} and project_id=${params.id} order by created_at desc`;
  const invoices = await sql`select id, number, status, invoice_kind, invoice_date, total, amount_paid, currency_code, created_at from invoices where org_id=${ctx.orgId} and project_id=${params.id} order by created_at desc`;
  const attachments = await sql`select id, kind, file_name, mime_type, file_size, lpo_number, lpo_date, lpo_value, approval_status, related_quote_id, notes, created_at from project_attachments where org_id=${ctx.orgId} and project_id=${params.id} order by created_at desc`;
  const payments = await sql`
    select p.id, p.amount, p.currency_code, p.payment_date, i.number as invoice_number, i.id as invoice_id
    from payments p join invoices i on i.id=p.invoice_id
    where i.org_id=${ctx.orgId} and i.project_id=${params.id} order by p.payment_date desc
  `;
  const purchaseOrders = await sql`
    select po.id, po.number, po.status, po.po_date, po.total, po.currency_code, po.vendor_id, v.name as vendor_name, po.created_at
    from purchase_orders po join vendors v on v.id=po.vendor_id
    where po.org_id=${ctx.orgId} and po.project_id=${params.id} order by po.created_at desc
  `;
  const bills = await sql`
    select b.id, b.number, b.status, b.bill_date, b.total, b.amount_paid, b.currency_code, b.vendor_id, v.name as vendor_name, b.created_at
    from bills b join vendors v on v.id=b.vendor_id
    where b.org_id=${ctx.orgId} and b.project_id=${params.id} order by b.created_at desc
  `;

  const billing = await projectBilling(ctx.orgId, params.id, project.approved_value, project.approved_currency, org.base_currency);

  const activity = [
    ...quotes.map((q) => ({ type: "quote", label: `Quotation ${q.number} (${q.status})`, date: q.created_at, href: `#/quotes/${q.id}` })),
    ...invoices.map((i) => ({ type: "invoice", label: `Invoice ${i.number} — ${i.invoice_kind} (${i.status})`, date: i.created_at, href: `#/invoices/${i.id}` })),
    ...attachments.map((a) => ({ type: "attachment", label: `${KIND_LABELS[a.kind] || "Document"} uploaded: ${a.file_name}`, date: a.created_at, href: null })),
    ...payments.map((p) => ({ type: "payment", label: `Payment of ${p.amount} ${p.currency_code} received (${p.invoice_number})`, date: p.payment_date, href: `#/invoices/${p.invoice_id}` })),
    ...purchaseOrders.map((po) => ({ type: "purchase_order", label: `Purchase order ${po.number} (${po.vendor_name}, ${po.status})`, date: po.created_at, href: `#/purchase-orders/${po.id}` })),
    ...bills.map((b) => ({ type: "bill", label: `Bill ${b.number} from ${b.vendor_name} (${b.status})`, date: b.created_at, href: `#/bills/${b.id}` })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const hasApprovedLpo = attachments.some((a) => a.kind === "lpo" && a.approval_status === "approved");

  // The quotation whose acceptance created (or is now linked to) this project — the most
  // recently accepted one, if a project ever has more than one accepted quote/revision.
  const acceptedQuote = quotes.filter((q) => q.status === "accepted").sort((a, b) => new Date(b.accepted_at || b.created_at) - new Date(a.accepted_at || a.created_at))[0] || null;

  return json({ project, quotes, invoices, attachments, payments, purchaseOrders, bills, billing, activity, hasApprovedLpo, acceptedQuote });
});

router.put("/api/projects/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [existing] = await sql`select * from projects where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Project not found", 404);
  if (!b.name) return err("name is required");

  let clientId = existing.client_id;
  if (b.clientId && b.clientId !== existing.client_id) {
    const [[{ count: qc }], [{ count: ic }], [{ count: ac }]] = await Promise.all([
      sql`select count(*)::int as count from quotes where project_id=${params.id}`,
      sql`select count(*)::int as count from invoices where project_id=${params.id}`,
      sql`select count(*)::int as count from project_attachments where project_id=${params.id}`,
    ]);
    if (Number(qc) + Number(ic) + Number(ac) > 0) {
      return err("This project already has quotations, invoices, or attachments linked — its client can't be changed. Create a new project instead.", 409);
    }
    const [client] = await sql`select id from clients where org_id=${ctx.orgId} and id=${b.clientId}`;
    if (!client) return err("Client not found", 404);
    clientId = b.clientId;
  }
  const statusOk = ["quotation_sent", "awaiting_lpo", "approved", "in_progress", "completed", "cancelled"];
  const status = statusOk.includes(b.status) ? b.status : existing.status;

  const [project] = await sql`
    update projects set name=${b.name}, client_id=${clientId}, contact_person=${b.contactPerson || null}, location=${b.location || null},
      scope_of_work=${b.scopeOfWork || null}, notes=${b.notes || null}, status=${status},
      approved_value=${b.approvedValue != null && b.approvedValue !== "" ? round2(b.approvedValue) : null},
      approved_currency=${b.approvedCurrency || existing.approved_currency},
      payment_terms=${b.paymentTerms != null ? b.paymentTerms : existing.payment_terms}
    where id=${params.id} returning *
  `;
  return json({ project });
});

router.del("/api/projects/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [existing] = await sql`select id from projects where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Project not found", 404);
  const [[{ count: qc }], [{ count: ic }], [{ count: ac }]] = await Promise.all([
    sql`select count(*)::int as count from quotes where project_id=${params.id}`,
    sql`select count(*)::int as count from invoices where project_id=${params.id}`,
    sql`select count(*)::int as count from project_attachments where project_id=${params.id}`,
  ]);
  if (Number(qc) + Number(ic) + Number(ac) > 0) {
    return err("This project has quotations, invoices, or attachments linked and can't be deleted. Set its status to Cancelled instead.", 409);
  }
  await sql`delete from projects where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});

// -------- Attachments (LPOs, signed quotations, contracts, completion docs) --------
router.post("/api/projects/:id/attachments", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [project] = await sql`select * from projects where org_id=${ctx.orgId} and id=${params.id}`;
  if (!project) return err("Project not found", 404);
  const kindOk = ["lpo", "signed_quotation", "contract", "completion", "other"];
  const kind = kindOk.includes(b.kind) ? b.kind : "other";
  if (!b.fileName || !b.fileB64) return err("A file is required");
  if (!b.mimeType || !["application/pdf", "image/jpeg", "image/png"].includes(b.mimeType)) {
    return err("Only PDF, JPG, or PNG files are supported");
  }
  // Rough cap so a huge scan doesn't blow past the request-body limit or bloat the
  // database row — base64 runs ~33% larger than the original file.
  if (b.fileB64.length > 15 * 1024 * 1024) return err("That file is too large (max ~10MB). Please compress or re-scan it at a lower resolution.");
  if (b.relatedQuoteId) {
    const [q] = await sql`select id from quotes where org_id=${ctx.orgId} and id=${b.relatedQuoteId} and project_id=${params.id}`;
    if (!q) return err("The related quotation must belong to this project", 409);
  }
  const [attachment] = await sql`
    insert into project_attachments (org_id, project_id, kind, file_name, mime_type, file_b64, file_size, lpo_number, lpo_date, lpo_value, approval_status, related_quote_id, notes, uploaded_by)
    values (${ctx.orgId}, ${params.id}, ${kind}, ${b.fileName}, ${b.mimeType}, ${b.fileB64}, ${b.fileSize || 0},
      ${kind === "lpo" ? (b.lpoNumber || null) : null}, ${kind === "lpo" ? (b.lpoDate || null) : null}, ${kind === "lpo" && b.lpoValue != null && b.lpoValue !== "" ? round2(b.lpoValue) : null},
      ${kind === "lpo" ? "pending" : "approved"}, ${kind === "lpo" ? (b.relatedQuoteId || null) : null}, ${b.notes || null}, ${ctx.user.id})
    returning id, kind, file_name, mime_type, file_size, lpo_number, lpo_date, lpo_value, approval_status, related_quote_id, notes, created_at
  `;
  return json({ attachment }, 201);
});

router.post("/api/project-attachments/:id/approval", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!["pending", "approved", "rejected"].includes(b.status)) return err("status must be pending, approved, or rejected");
  const [attachment] = await sql`select * from project_attachments where org_id=${ctx.orgId} and id=${params.id}`;
  if (!attachment) return err("Attachment not found", 404);
  if (attachment.kind !== "lpo") return err("Only a Customer LPO has an approval status", 409);
  const [updated] = await sql`update project_attachments set approval_status=${b.status} where id=${params.id} returning *`;
  // First approved LPO on a project with no approved value yet auto-fills it, purely as a
  // convenience — never overwrites a value the user already entered or confirmed.
  if (b.status === "approved" && updated.lpo_value != null) {
    const [project] = await sql`select approved_value from projects where id=${attachment.project_id}`;
    if (project && project.approved_value == null) {
      await sql`update projects set approved_value=${updated.lpo_value} where id=${attachment.project_id}`;
    }
  }
  return json({ attachment: updated });
});

router.put("/api/project-attachments/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [existing] = await sql`select * from project_attachments where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Attachment not found", 404);
  const [updated] = await sql`
    update project_attachments set
      lpo_number=${existing.kind === "lpo" ? (b.lpoNumber || null) : existing.lpo_number},
      lpo_date=${existing.kind === "lpo" ? (b.lpoDate || null) : existing.lpo_date},
      lpo_value=${existing.kind === "lpo" && b.lpoValue != null && b.lpoValue !== "" ? round2(b.lpoValue) : (existing.kind === "lpo" ? null : existing.lpo_value)},
      notes=${b.notes != null ? b.notes : existing.notes}
    where id=${params.id} returning *
  `;
  return json({ attachment: updated });
});

router.del("/api/project-attachments/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [existing] = await sql`select id from project_attachments where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Attachment not found", 404);
  const used = await sql`select 1 from invoices where lpo_attachment_id=${params.id} limit 1`;
  if (used.length) return err("This attachment is referenced by an invoice and can't be deleted.", 409);
  await sql`delete from project_attachments where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});

router.get("/api/project-attachments/:id/file", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [row] = await sql`select file_name, mime_type, file_b64 from project_attachments where org_id=${ctx.orgId} and id=${params.id}`;
  if (!row) return err("File not found", 404);
  const bytes = Buffer.from(row.file_b64, "base64");
  return new Response(bytes, {
    headers: {
      "content-type": row.mime_type || "application/octet-stream",
      "content-disposition": `inline; filename="${encodeURIComponent(row.file_name)}"`,
      "cache-control": "private, max-age=3600",
    },
  });
});

// -------- Advance invoice (after signed LPO approval) --------
router.post("/api/projects/:id/advance-invoice", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [project] = await sql`select * from projects where org_id=${ctx.orgId} and id=${params.id}`;
  if (!project) return err("Project not found", 404);

  const approvedLpo = (await sql`select * from project_attachments where org_id=${ctx.orgId} and project_id=${params.id} and kind='lpo' and approval_status='approved' order by created_at desc limit 1`)[0];
  if (!approvedLpo) return err("Record and approve the customer's signed LPO before creating an invoice.", 409);

  if (project.approved_value == null) {
    return err("This project has no approved contract value set. Enter one on Edit Project (it's usually auto-filled from the accepted quotation or the approved LPO's value).", 409);
  }
  const approvedValue = Number(project.approved_value);

  // One shared endpoint creates the advance, progress, AND final invoice — they only
  // differ in wording and which invoice_kind gets stored; the amount math, the VAT
  // reverse-calc, and the over-billing guard below are identical for all three, which is
  // exactly what prevents duplicate billing/duplicate VAT across a sequence of them.
  const invoiceKind = ["advance", "progress", "final"].includes(b.invoiceKind) ? b.invoiceKind : "advance";
  const KIND_WORDS = { advance: "Advance payment", progress: "Progress payment", final: "Final payment" };

  if (!["percent", "fixed"].includes(b.advanceType)) return err("advanceType must be 'percent' or 'fixed'");
  const value = Number(b.advanceValue);
  if (!Number.isFinite(value) || value <= 0) return err("advanceValue must be greater than 0");
  if (b.advanceType === "percent" && value > 100) return err("Advance percentage can't exceed 100%");
  const vatRate = b.vatRate != null && b.vatRate !== "" ? Number(b.vatRate) : 5;
  if (!Number.isFinite(vatRate) || vatRate < 0) return err("vatRate must be 0 or greater");

  const [org] = await sql`select base_currency from orgs where id=${ctx.orgId}`;
  const { invoicedTotal } = await projectBilling(ctx.orgId, params.id, project.approved_value, project.approved_currency, org.base_currency);
  const remaining = round2(Math.max(approvedValue - invoicedTotal, 0));

  const rawAdvance = b.advanceType === "percent" ? (approvedValue * value) / 100 : value;
  const advanceAmount = round2(rawAdvance);
  if (advanceAmount > remaining + 0.01) {
    return err(`This ${advanceAmount} would exceed the project's remaining uninvoiced amount of ${remaining} (approved value ${approvedValue}, already invoiced ${invoicedTotal}). Lower the amount, or review the existing invoices on this project.`, 409);
  }

  // Reverse the VAT-inclusive advance amount into a single net line so the invoice totals
  // through the same computeTotals()/VAT math every other document uses — no VAT is added
  // a second time on top of the advance amount itself.
  const unitPrice = round2(advanceAmount / (1 + vatRate / 100));
  const description = b.advanceType === "percent"
    ? `${KIND_WORDS[invoiceKind]} (${value}% of approved project value) — Project ${project.project_number}`
    : `${KIND_WORDS[invoiceKind]} — Project ${project.project_number}`;

  const latestQuote = (await sql`select id from quotes where org_id=${ctx.orgId} and project_id=${params.id} order by created_at desc limit 1`)[0];
  const currency = project.approved_currency || org.base_currency;
  const fxRate = await resolveFxRate(ctx.orgId, currency, org.base_currency, b.invoiceDate);
  const number = await nextNumber(ctx.orgId, "invoice");
  const subtotal = unitPrice;
  const vatTotal = round2(unitPrice * (vatRate / 100));
  const total = round2(subtotal + vatTotal);

  const invoice = await sql.begin(async (tx) => {
    const [inv] = await tx`
      insert into invoices (org_id, number, client_id, quote_id, project_id, lpo_attachment_id, invoice_kind, invoice_date, due_date, currency_code, fx_rate, status, notes, terms, subtotal, vat_total, total)
      values (${ctx.orgId}, ${number}, ${project.client_id}, ${latestQuote?.id || null}, ${project.id}, ${approvedLpo.id}, ${invoiceKind},
        ${b.invoiceDate || toISODate(new Date())}, ${b.dueDate || null}, ${currency}, ${fxRate}, 'draft', ${b.notes || null}, ${b.terms || project.payment_terms || null},
        ${subtotal}, ${vatTotal}, ${total})
      returning *
    `;
    await tx`
      insert into invoice_lines (invoice_id, item_id, description, qty, unit_price, discount_pct, vat_rate, sort_order)
      values (${inv.id}, null, ${description}, 1, ${unitPrice}, 0, ${vatRate}, 0)
    `;
    return inv;
  });

  return json({
    invoice,
    calculation: { approvedValue, alreadyInvoiced: invoicedTotal, advanceAmount, remainingAfter: round2(Math.max(remaining - advanceAmount, 0)) },
  }, 201);
});
