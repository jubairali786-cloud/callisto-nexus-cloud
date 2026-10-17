import { sql } from "../db.js";
import { json, err, nextNumber, resolveFxRate, computeTotals, advanceAmount, parseAdvance } from "../lib/helpers.js";
import { replaceQuoteLines, getQuoteLines } from "../lib/doclines.js";
import { Router } from "../lib/router.js";

export const router = new Router();
function requireOrg(ctx) { if (!ctx || !ctx.orgId) return err("Not authenticated", 401); return null; }

function withAdvance(q) { return { ...q, advance_amount: advanceAmount(q) }; }

// Resolves the Project Number field on a quote/invoice create-or-edit form. Picking an
// existing project always forces clientId to that project's client (per spec: selecting a
// project "automatically fills in the correct client/company") — there's no mismatch case
// to validate here because the client is derived, not independently chosen.
//
// There is deliberately no "create a new project" option here any more. Per the current
// workflow, a project is created in exactly one place: accepting a quotation (see
// POST /api/quotes/:id/accept below). This field can only ever link to an EXISTING project
// — e.g. a follow-up quote/revision for a project that's already underway — never spawn one.
// Returns {projectId, clientId} or {error}.
async function resolveProjectLink(ctx, b, fallbackClientId) {
  if (b.projectId) {
    const [project] = await sql`select id, client_id from projects where org_id=${ctx.orgId} and id=${b.projectId}`;
    if (!project) return { error: "Project not found" };
    return { projectId: project.id, clientId: project.client_id };
  }
  if (b.projectId === null) return { projectId: null, clientId: b.clientId || fallbackClientId };
  return { projectId: undefined, clientId: b.clientId || fallbackClientId };
}

router.get("/api/quotes", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`
    select q.*, c.name as client_name, p.project_number from quotes q join clients c on c.id=q.client_id
    left join projects p on p.id=q.project_id
    where q.org_id=${ctx.orgId} order by q.quote_date desc, q.created_at desc
  `;
  return json({ quotes: rows.map(withAdvance) });
});

router.get("/api/quotes/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [quote] = await sql`
    select q.*, c.name as client_name, c.company_name as client_company_name, c.email as client_email,
      c.phone as client_phone, c.tel as client_tel, c.address as client_address, c.trn as client_trn,
      p.project_number
    from quotes q join clients c on c.id=q.client_id left join projects p on p.id=q.project_id
    where q.org_id=${ctx.orgId} and q.id=${params.id}
  `;
  if (!quote) return err("Quote not found", 404);
  const lines = await getQuoteLines(params.id);
  return json({ quote: withAdvance(quote), lines });
});

router.post("/api/quotes", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const link = await resolveProjectLink(ctx, b, null);
  if (link.error) return err(link.error);
  if (!link.clientId || !Array.isArray(b.lines) || !b.lines.length) return err("clientId and at least one line are required");
  const adv = parseAdvance(b);
  if (adv.error) return err(adv.error);
  const [org] = await sql`select base_currency from orgs where id=${ctx.orgId}`;
  const currency = b.currencyCode || org.base_currency;
  const fxRate = b.fxRate || await resolveFxRate(ctx.orgId, currency, org.base_currency, b.quoteDate);
  const totals = computeTotals(b.lines);
  const number = await nextNumber(ctx.orgId, "quote");

  const result = await sql.begin(async (tx) => {
    const [quote] = await tx`
      insert into quotes (org_id, number, client_id, project_id, quote_date, expiry_date, currency_code, fx_rate, status, notes, terms, subtotal, vat_total, total, advance_type, advance_value, project_title, location, scope_of_work)
      values (${ctx.orgId}, ${number}, ${link.clientId}, ${link.projectId || null}, ${b.quoteDate || new Date().toISOString().slice(0, 10)}, ${b.expiryDate || null},
        ${currency}, ${fxRate}, 'draft', ${b.notes || null}, ${b.terms || null}, ${totals.subtotal}, ${totals.vatTotal}, ${totals.total},
        ${adv.advanceType}, ${adv.advanceValue}, ${b.projectTitle || null}, ${b.location || null}, ${b.scopeOfWork || null})
      returning *
    `;
    await replaceQuoteLines(tx, quote.id, b.lines);
    return quote;
  });
  return json({ quote: withAdvance(result) }, 201);
});

router.put("/api/quotes/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [existing] = await sql`select * from quotes where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Quote not found", 404);
  if (existing.status === "converted") return err("Cannot edit a quote that has already been converted to an invoice", 409);
  const link = await resolveProjectLink(ctx, b, existing.client_id);
  if (link.error) return err(link.error);
  const adv = parseAdvance(b);
  if (adv.error) return err(adv.error);
  const totals = computeTotals(b.lines || []);
  const result = await sql.begin(async (tx) => {
    const [quote] = await tx`
      update quotes set client_id=${link.clientId}, project_id=${link.projectId === undefined ? existing.project_id : link.projectId},
        quote_date=${b.quoteDate}, expiry_date=${b.expiryDate || null},
        currency_code=${b.currencyCode || existing.currency_code}, fx_rate=${b.fxRate || existing.fx_rate},
        notes=${b.notes || null}, terms=${b.terms || null}, subtotal=${totals.subtotal}, vat_total=${totals.vatTotal}, total=${totals.total},
        advance_type=${adv.advanceType}, advance_value=${adv.advanceValue},
        project_title=${b.projectTitle != null ? b.projectTitle : existing.project_title}, location=${b.location != null ? b.location : existing.location},
        scope_of_work=${b.scopeOfWork != null ? b.scopeOfWork : existing.scope_of_work}
      where id=${params.id} returning *
    `;
    if (Array.isArray(b.lines)) await replaceQuoteLines(tx, quote.id, b.lines);
    return quote;
  });
  return json({ quote: withAdvance(result) });
});

// Links an EXISTING quote (any status) to a project — used for documents created before
// the project existed. Unlike the create/edit form, this does NOT override the quote's
// client: a mismatch is rejected outright, since the quote may already be sent/accepted.
router.post("/api/quotes/:id/link-project", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [quote] = await sql`select * from quotes where org_id=${ctx.orgId} and id=${params.id}`;
  if (!quote) return err("Quote not found", 404);
  const [project] = await sql`select * from projects where org_id=${ctx.orgId} and id=${b.projectId}`;
  if (!project) return err("Project not found", 404);
  if (project.client_id !== quote.client_id) return err(`This quote's client doesn't match ${project.project_number}'s client (${project.name}). Link it to a project for the same client.`, 409);
  const [updated] = await sql`update quotes set project_id=${project.id} where id=${params.id} returning *`;
  return json({ quote: withAdvance(updated) });
});

// 'accepted' is deliberately NOT settable here any more — accepting a quotation now always
// goes through POST /api/quotes/:id/accept below, which is the only path that creates (or
// reuses) the quote's project. This endpoint is left for the ordinary draft->sent transition
// and for rejecting a quote (status='declined', shown to the user as "Rejected").
router.post("/api/quotes/:id/status", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const { status } = await req.json().catch(() => ({}));
  if (!["draft", "sent", "declined"].includes(status)) return err("Invalid status");
  const [existing] = await sql`select status from quotes where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Quote not found", 404);
  if (existing.status === "accepted" && status !== "declined") return err("This quotation has already been accepted and has a project. Manage its status from the project instead.", 409);
  const [row] = await sql`update quotes set status=${status} where org_id=${ctx.orgId} and id=${params.id} returning *`;
  return json({ quote: row });
});

// Accepting a quotation is the ONLY way a project gets created in this app — replacing the
// old "quotation sent" / inline "create a new project" flows entirely. Deliberately
// idempotent: a row lock on the quote inside the transaction means two near-simultaneous
// accepts (a double-click, a retry after a flaky connection, a page refresh resubmitting)
// can't both pass the "no project yet" check and create two projects — the second one
// always just reuses whatever the first one created. If the quote was already linked to an
// existing project (e.g. picked via the Project Number field as a follow-up quote before
// acceptance), that project is reused outright, matching "if a quotation is already linked
// to a project, reuse that project."
router.post("/api/quotes/:id/accept", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [pre] = await sql`select id, status, project_id from quotes where org_id=${ctx.orgId} and id=${params.id}`;
  if (!pre) return err("Quote not found", 404);
  if (pre.status === "declined") return err("A rejected quotation can't be accepted. Create a revised quote instead.", 409);

  // Reserve a project number up front, but only when this quote doesn't already have a
  // project — under a rare concurrent double-accept, both requests might each reserve a
  // number, but the row lock below guarantees only one of them actually creates a project;
  // the loser's reserved number is simply never used (a harmless gap, never a duplicate).
  const projectNumber = pre.project_id ? null : await nextNumber(ctx.orgId, "project");

  const result = await sql.begin(async (tx) => {
    const [quote] = await tx`select * from quotes where org_id=${ctx.orgId} and id=${params.id} for update`;
    if (quote.status === "declined") return { error: "A rejected quotation can't be accepted. Create a revised quote instead.", status: 409 };

    if (quote.project_id) {
      const [project] = await tx`select * from projects where id=${quote.project_id}`;
      let updatedQuote = quote;
      if (quote.status !== "accepted") {
        [updatedQuote] = await tx`update quotes set status='accepted', accepted_at=coalesce(accepted_at, now()) where id=${quote.id} returning *`;
      }
      // Backfill the project's approved value / payment terms from this quote, but only
      // where the project doesn't already have its own — never overwrite a value someone
      // already set or confirmed on the project itself.
      let updatedProject = project;
      if (project.approved_value == null || project.payment_terms == null) {
        [updatedProject] = await tx`
          update projects set approved_value=coalesce(approved_value, ${quote.total}), payment_terms=coalesce(payment_terms, ${quote.terms || null})
          where id=${project.id} returning *
        `;
      }
      return { quote: updatedQuote, project: updatedProject, created: false };
    }

    const [client] = await tx`select name from clients where id=${quote.client_id}`;
    const [org] = await tx`select base_currency from orgs where id=${ctx.orgId}`;
    const name = quote.project_title || `${client.name} — ${quote.number}`;
    const [project] = await tx`
      insert into projects (org_id, project_number, name, client_id, location, scope_of_work, status, approved_value, approved_currency, payment_terms, created_by)
      values (${ctx.orgId}, ${projectNumber}, ${name}, ${quote.client_id}, ${quote.location || null}, ${quote.scope_of_work || null}, 'approved', ${quote.total}, ${quote.currency_code || org.base_currency}, ${quote.terms || null}, ${ctx.user.id})
      returning *
    `;
    const [updatedQuote] = await tx`update quotes set project_id=${project.id}, status='accepted', accepted_at=now() where id=${quote.id} returning *`;
    return { quote: updatedQuote, project, created: true };
  });

  if (result.error) return err(result.error, result.status);
  return json({ quote: withAdvance(result.quote), project: result.project, created: result.created }, result.created ? 201 : 200);
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
  // Carries the project link forward automatically, plus whichever customer LPO is
  // currently approved on that project (if any) — the invoice references the LPO that
  // was in effect when it was created, even if a later LPO gets approved afterwards.
  let lpoAttachmentId = null;
  if (quote.project_id) {
    const approvedLpo = (await sql`select id from project_attachments where org_id=${ctx.orgId} and project_id=${quote.project_id} and kind='lpo' and approval_status='approved' order by created_at desc limit 1`)[0];
    lpoAttachmentId = approvedLpo?.id || null;
  }
  const invoice = await sql.begin(async (tx) => {
    const [inv] = await tx`
      insert into invoices (org_id, number, client_id, quote_id, project_id, lpo_attachment_id, invoice_date, due_date, currency_code, fx_rate, status, notes, terms, subtotal, vat_total, total, advance_type, advance_value)
      values (${ctx.orgId}, ${number}, ${quote.client_id}, ${quote.id}, ${quote.project_id || null}, ${lpoAttachmentId}, current_date, current_date + interval '14 days',
        ${quote.currency_code}, ${quote.fx_rate}, 'draft', ${quote.notes}, ${quote.terms}, ${quote.subtotal}, ${quote.vat_total}, ${quote.total},
        ${quote.advance_type}, ${quote.advance_value})
      returning *
    `;
    const { replaceInvoiceLines } = await import("../lib/doclines.js");
    await replaceInvoiceLines(tx, inv.id, lines.map((l) => ({
      itemId: l.item_id, description: l.description, qty: l.qty, unitPrice: l.unit_price, discountPct: l.discount_pct, vatRate: l.vat_rate,
    })));
    await tx`update quotes set status='converted' where id=${quote.id}`;
    return inv;
  });
  return json({ invoice: { ...invoice, advance_amount: advanceAmount(invoice) } }, 201);
});
