import { sql } from "../db.js";
import { json, err, round2, toISODate } from "../lib/helpers.js";
import { postPartnerTransaction, postShareTransferInvestment } from "../lib/partner-posting.js";
import { reverseJournalEntry, findJournalEntryForSource, profitAndLoss } from "../lib/ledger.js";
import {
  getActivePartners, totalOwnershipPct, writeOwnershipSnapshot, ownershipAsOf,
  partnerCapitalSummary, companyFinancials,
} from "../lib/partners-lib.js";
import { Router } from "../lib/router.js";

export const router = new Router();
function requireOrg(ctx) { if (!ctx || !ctx.orgId) return err("Not authenticated", 401); return null; }
// Investment & Partners is owner/admin-only — staff never see partner capital, ownership,
// or share-transfer data, on either the UI (app.js hides the sidebar section/routes for
// staff) or here on the API itself, which is the boundary that actually matters.
function requireOwnerOrAdmin(ctx) {
  const bad = requireOrg(ctx); if (bad) return bad;
  if (!["owner", "admin"].includes(ctx.role)) return err("Only owners and admins can access Investment & Partners", 403);
  return null;
}
const today = () => new Date().toISOString().slice(0, 10);

const TXN_TYPES = ["contribution", "loan", "withdrawal", "loan_repayment", "distribution"];

// -------- Partners --------
router.get("/api/partners", async (req, ctx) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const rows = await sql`select * from partners where org_id=${ctx.orgId} order by created_at`;
  const partners = [];
  for (const p of rows) partners.push({ ...p, ...(await partnerCapitalSummary(ctx.orgId, p.id)) });
  const totalActiveOwnership = await totalOwnershipPct(ctx.orgId);
  return json({ partners, totalActiveOwnership });
});

router.post("/api/partners", async (req, ctx) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.name) return err("name is required");
  const ownershipPct = round2(Number(b.ownershipPct || 0));
  if (!Number.isFinite(ownershipPct) || ownershipPct < 0 || ownershipPct > 100) return err("ownershipPct must be between 0 and 100");
  const existingTotal = await totalOwnershipPct(ctx.orgId);
  if (round2(existingTotal + ownershipPct) > 100.001) {
    return err(`Total active ownership would be ${round2(existingTotal + ownershipPct)}%, which exceeds 100%. Currently allocated: ${existingTotal}%.`, 409);
  }
  const profitSharePct = b.profitSharePct != null && b.profitSharePct !== "" ? round2(Number(b.profitSharePct)) : null;
  const result = await sql.begin(async (tx) => {
    const [partner] = await tx`
      insert into partners (org_id, name, email, phone, ownership_pct, profit_share_pct, notes)
      values (${ctx.orgId}, ${b.name}, ${b.email || null}, ${b.phone || null}, ${ownershipPct}, ${profitSharePct}, ${b.notes || null})
      returning *
    `;
    await writeOwnershipSnapshot(tx, ctx.orgId, partner.id, ownershipPct, b.effectiveDate || today(), null);
    return partner;
  });
  return json({ partner: { ...result, ...(await partnerCapitalSummary(ctx.orgId, result.id)) } }, 201);
});

router.get("/api/partners/:id", async (req, ctx, params) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const [partner] = await sql`select * from partners where org_id=${ctx.orgId} and id=${params.id}`;
  if (!partner) return err("Partner not found", 404);
  const transactions = await sql`select * from partner_transactions where org_id=${ctx.orgId} and partner_id=${params.id} order by txn_date desc, created_at desc`;
  const shareTransfersAsSeller = await sql`
    select st.*, bp.name as buyer_name from share_transfers st join partners bp on bp.id=st.buyer_partner_id
    where st.org_id=${ctx.orgId} and st.seller_partner_id=${params.id} order by effective_date desc`;
  const shareTransfersAsBuyer = await sql`
    select st.*, sp.name as seller_name from share_transfers st left join partners sp on sp.id=st.seller_partner_id
    where st.org_id=${ctx.orgId} and st.buyer_partner_id=${params.id} order by effective_date desc`;
  const ownershipHistory = await sql`select * from partner_ownership_snapshots where org_id=${ctx.orgId} and partner_id=${params.id} order by effective_date, created_at`;
  const summary = await partnerCapitalSummary(ctx.orgId, params.id);
  return json({
    partner: { ...partner, ...summary }, transactions,
    shareTransfers: [...shareTransfersAsSeller, ...shareTransfersAsBuyer].sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date)),
    ownershipHistory,
  });
});

router.put("/api/partners/:id", async (req, ctx, params) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [existing] = await sql`select * from partners where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Partner not found", 404);
  const name = b.name != null ? b.name : existing.name;
  if (!name) return err("name is required");
  const status = b.status || existing.status;
  const profitSharePct = b.profitSharePct !== undefined
    ? (b.profitSharePct === null || b.profitSharePct === "" ? null : round2(Number(b.profitSharePct)))
    : existing.profit_share_pct;

  let ownershipPct = Number(existing.ownership_pct);
  let ownershipChanged = false;
  if (b.ownershipPct != null && round2(Number(b.ownershipPct)) !== round2(Number(existing.ownership_pct))) {
    ownershipPct = round2(Number(b.ownershipPct));
    if (!Number.isFinite(ownershipPct) || ownershipPct < 0 || ownershipPct > 100) return err("ownershipPct must be between 0 and 100");
    const othersTotal = await totalOwnershipPct(ctx.orgId, params.id);
    if (status === "active" && round2(othersTotal + ownershipPct) > 100.001) {
      return err(`Total active ownership would be ${round2(othersTotal + ownershipPct)}%, which exceeds 100%. Other active partners currently hold ${othersTotal}%.`, 409);
    }
    ownershipChanged = true;
  }

  const result = await sql.begin(async (tx) => {
    const [partner] = await tx`
      update partners set name=${name}, email=${b.email !== undefined ? b.email : existing.email},
        phone=${b.phone !== undefined ? b.phone : existing.phone}, ownership_pct=${ownershipPct},
        profit_share_pct=${profitSharePct}, status=${status}, notes=${b.notes !== undefined ? b.notes : existing.notes}
      where id=${params.id} returning *
    `;
    if (ownershipChanged) await writeOwnershipSnapshot(tx, ctx.orgId, partner.id, ownershipPct, b.effectiveDate || today(), null);
    return partner;
  });
  return json({ partner: { ...result, ...(await partnerCapitalSummary(ctx.orgId, result.id)) } });
});

router.del("/api/partners/:id", async (req, ctx, params) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const [existing] = await sql`select id from partners where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Partner not found", 404);
  const [[{ count: txnCount }], [{ count: stCount }]] = await Promise.all([
    sql`select count(*)::int as count from partner_transactions where partner_id=${params.id}`,
    sql`select count(*)::int as count from share_transfers where buyer_partner_id=${params.id} or seller_partner_id=${params.id}`,
  ]);
  if (Number(txnCount) > 0 || Number(stCount) > 0) {
    return err("This partner has transaction or share-transfer history and can't be deleted. Set their status to Inactive instead.", 409);
  }
  await sql`delete from partner_ownership_snapshots where partner_id=${params.id}`;
  await sql`delete from partners where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});

// -------- Partner capital transactions --------
router.get("/api/partner-transactions", async (req, ctx) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const rows = await sql`
    select pt.*, p.name as partner_name from partner_transactions pt join partners p on p.id=pt.partner_id
    where pt.org_id=${ctx.orgId} order by pt.txn_date desc, pt.created_at desc
  `;
  return json({ transactions: rows });
});

router.post("/api/partners/:id/transactions", async (req, ctx, params) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [partner] = await sql`select * from partners where org_id=${ctx.orgId} and id=${params.id}`;
  if (!partner) return err("Partner not found", 404);
  if (!TXN_TYPES.includes(b.txnType)) return err(`txnType must be one of: ${TXN_TYPES.join(", ")}`);
  if (!b.amount || Number(b.amount) <= 0) return err("amount must be greater than 0");

  let bankGlAccountId = null;
  if (b.bankAccountId) {
    const [bank] = await sql`select gl_account_id from bank_accounts where id=${b.bankAccountId} and org_id=${ctx.orgId}`;
    bankGlAccountId = bank?.gl_account_id || null;
  }

  const [txn] = await sql`
    insert into partner_transactions (org_id, partner_id, txn_type, amount, currency_code, fx_rate, txn_date, method, bank_account_id, reference, notes, created_by)
    values (${ctx.orgId}, ${partner.id}, ${b.txnType}, ${round2(b.amount)}, ${b.currencyCode || "AED"}, ${b.fxRate || 1},
      ${b.txnDate || today()}, ${b.method || "bank_transfer"}, ${b.bankAccountId || null}, ${b.reference || null}, ${b.notes || null}, ${ctx.user.id})
    returning *
  `;
  await postPartnerTransaction(ctx.orgId, txn, partner.name, bankGlAccountId, ctx.user.id);
  return json({ transaction: txn }, 201);
});

router.del("/api/partner-transactions/:id", async (req, ctx, params) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const [txn] = await sql`select * from partner_transactions where org_id=${ctx.orgId} and id=${params.id}`;
  if (!txn) return err("Transaction not found", 404);
  const journalId = await findJournalEntryForSource(ctx.orgId, "partner_transaction", txn.id);
  if (journalId) await reverseJournalEntry({ orgId: ctx.orgId, journalEntryId: journalId, entryDate: today(), memo: "Partner transaction reversed/deleted", createdBy: ctx.user.id });
  await sql`delete from partner_transactions where id=${txn.id}`;
  return json({ ok: true });
});

// -------- Share transfers --------
router.get("/api/share-transfers", async (req, ctx) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const rows = await sql`
    select st.*, bp.name as buyer_name, sp.name as seller_name
    from share_transfers st join partners bp on bp.id=st.buyer_partner_id left join partners sp on sp.id=st.seller_partner_id
    where st.org_id=${ctx.orgId} order by st.effective_date desc, st.created_at desc
  `;
  return json({ shareTransfers: rows });
});

router.post("/api/share-transfers", async (req, ctx) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!["share_sale", "new_investment"].includes(b.transferType)) return err("transferType must be 'share_sale' or 'new_investment'");
  const pct = round2(Number(b.pctTransferred));
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return err("pctTransferred must be between 0 and 100");
  const effectiveDate = b.effectiveDate || today();

  let buyer;
  if (b.buyerPartnerId) {
    [buyer] = await sql`select * from partners where org_id=${ctx.orgId} and id=${b.buyerPartnerId}`;
    if (!buyer) return err("Buyer partner not found", 404);
  } else if (b.newPartnerName) {
    // A brand-new partner joining via this transfer — created with 0% starting ownership,
    // which the transfer below then raises by pctTransferred.
    [buyer] = await sql`insert into partners (org_id, name, ownership_pct) values (${ctx.orgId}, ${b.newPartnerName}, 0) returning *`;
  } else {
    return err("buyerPartnerId or newPartnerName is required");
  }

  if (b.transferType === "share_sale") {
    if (!b.sellerPartnerId) return err("sellerPartnerId is required for a share_sale");
    const [seller] = await sql`select * from partners where org_id=${ctx.orgId} and id=${b.sellerPartnerId}`;
    if (!seller) return err("Seller partner not found", 404);
    if (seller.id === buyer.id) return err("Seller and buyer must be different partners");
    if (Number(seller.ownership_pct) < pct - 0.001) {
      return err(`${seller.name} only holds ${seller.ownership_pct}% — can't transfer ${pct}%.`, 409);
    }
    const result = await sql.begin(async (tx) => {
      const [transfer] = await tx`
        insert into share_transfers (org_id, transfer_type, seller_partner_id, buyer_partner_id, pct_transferred, sale_price, effective_date, payment_status, notes, created_by)
        values (${ctx.orgId}, 'share_sale', ${seller.id}, ${buyer.id}, ${pct}, ${b.salePrice != null ? round2(b.salePrice) : null}, ${effectiveDate}, ${b.paymentStatus || "unpaid"}, ${b.notes || null}, ${ctx.user.id})
        returning *
      `;
      const newSellerPct = round2(Number(seller.ownership_pct) - pct);
      const newBuyerPct = round2(Number(buyer.ownership_pct) + pct);
      await tx`update partners set ownership_pct=${newSellerPct} where id=${seller.id}`;
      await tx`update partners set ownership_pct=${newBuyerPct} where id=${buyer.id}`;
      await writeOwnershipSnapshot(tx, ctx.orgId, seller.id, newSellerPct, effectiveDate, transfer.id);
      await writeOwnershipSnapshot(tx, ctx.orgId, buyer.id, newBuyerPct, effectiveDate, transfer.id);
      return transfer;
      // Sale proceeds are a personal payment between the two partners — they never touch
      // the company's cash/GL, matching the spec: "money goes to the selling partner and
      // does not increase company capital or revenue."
    });
    return json({ shareTransfer: result }, 201);
  }

  // new_investment: money goes INTO the company, so the resulting ownership for every
  // active partner must be explicitly entered and confirmed by the caller rather than
  // silently computed — dilution isn't a single zero-sum transfer like a share_sale is.
  if (!Array.isArray(b.newOwnership) || !b.newOwnership.length) {
    return err("newOwnership (the confirmed post-investment ownership % for every active partner) is required for a new_investment");
  }
  const activePartners = await getActivePartnersIncluding(ctx.orgId, buyer.id);
  const sumNew = round2(b.newOwnership.reduce((s, o) => s + Number(o.ownershipPct || 0), 0));
  if (Math.abs(sumNew - 100) > 0.05) return err(`The confirmed ownership percentages must add up to 100% (currently ${sumNew}%).`);
  const coveredIds = new Set(b.newOwnership.map((o) => o.partnerId));
  for (const p of activePartners) {
    if (!coveredIds.has(p.id)) return err(`Missing a confirmed ownership % for ${p.name}.`);
  }

  let bankGlAccountId = null;
  if (b.bankAccountId) {
    const [bank] = await sql`select gl_account_id from bank_accounts where id=${b.bankAccountId} and org_id=${ctx.orgId}`;
    bankGlAccountId = bank?.gl_account_id || null;
  }

  const result = await sql.begin(async (tx) => {
    const [transfer] = await tx`
      insert into share_transfers (org_id, transfer_type, seller_partner_id, buyer_partner_id, pct_transferred, sale_price, effective_date, payment_status, notes, created_by)
      values (${ctx.orgId}, 'new_investment', null, ${buyer.id}, ${pct}, ${b.salePrice != null ? round2(b.salePrice) : null}, ${effectiveDate}, ${b.paymentStatus || "paid"}, ${b.notes || null}, ${ctx.user.id})
      returning *
    `;
    for (const o of b.newOwnership) {
      const pctVal = round2(Number(o.ownershipPct));
      await tx`update partners set ownership_pct=${pctVal} where id=${o.partnerId} and org_id=${ctx.orgId}`;
      await writeOwnershipSnapshot(tx, ctx.orgId, o.partnerId, pctVal, effectiveDate, transfer.id);
    }
    if (b.salePrice != null && Number(b.salePrice) > 0) {
      const [contribTxn] = await tx`
        insert into partner_transactions (org_id, partner_id, txn_type, amount, currency_code, fx_rate, txn_date, method, bank_account_id, reference, notes, created_by)
        values (${ctx.orgId}, ${buyer.id}, 'contribution', ${round2(b.salePrice)}, ${b.currencyCode || "AED"}, ${b.fxRate || 1},
          ${effectiveDate}, ${b.method || "bank_transfer"}, ${b.bankAccountId || null}, ${b.reference || `New investment, ${pct}%`}, ${b.notes || null}, ${ctx.user.id})
        returning *
      `;
      await postPartnerTransaction(ctx.orgId, contribTxn, buyer.name, bankGlAccountId, ctx.user.id);
    }
    return transfer;
  });
  return json({ shareTransfer: result }, 201);
});

async function getActivePartnersIncluding(orgId, partnerId) {
  const rows = await sql`select * from partners where org_id=${orgId} and (status='active' or id=${partnerId}) order by created_at`;
  return rows;
}

// -------- Consolidated dashboard --------
router.get("/api/partners/dashboard", async (req, ctx, params, url) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const from = url.searchParams.get("from") || `${new Date().getFullYear()}-01-01`;
  const to = url.searchParams.get("to") || today();

  const financials = await companyFinancials(ctx.orgId, from, to);
  const partnerRows = await sql`select * from partners where org_id=${ctx.orgId} order by status desc, created_at`;
  const partners = [];
  for (const p of partnerRows) {
    const summary = await partnerCapitalSummary(ctx.orgId, p.id);
    partners.push({ id: p.id, name: p.name, status: p.status, ownershipPct: Number(p.ownership_pct), profitSharePct: p.profit_share_pct != null ? Number(p.profit_share_pct) : null, ...summary });
  }
  const totalActiveOwnership = round2(partners.filter((p) => p.status === "active").reduce((s, p) => s + p.ownershipPct, 0));
  const warnings = [...financials.warnings];
  if (!partners.length) warnings.push("No partners have been added yet — ownership and partner-level figures are empty until at least one partner is set up.");
  else if (Math.abs(totalActiveOwnership - 100) > 0.05) warnings.push(`Active partner ownership currently totals ${totalActiveOwnership}%, not 100% — ownership-based figures below won't fully reconcile until this is resolved.`);

  return json({ ...financials, warnings, partners, totalActiveOwnership });
});

// -------- Profit allocation (estimates only — never auto-posts or auto-pays) --------
async function computeAllocation(orgId, from, to, method) {
  const pl = await profitAndLoss(orgId, from, to);
  const netProfit = round2(
    pl.filter((r) => r.type === "income").reduce((s, r) => s + Number(r.net_credit), 0) -
    pl.filter((r) => r.type === "expense").reduce((s, r) => s + Number(r.net_debit), 0)
  );
  const partners = await getActivePartners(orgId);
  const lines = [];
  for (const p of partners) {
    const pct = method === "profit_share_ratio" && p.profit_share_pct != null ? Number(p.profit_share_pct) : Number(p.ownership_pct);
    lines.push({ partnerId: p.id, partnerName: p.name, pctUsed: round2(pct), amount: round2((netProfit * pct) / 100) });
  }
  return { netProfit, lines };
}

router.post("/api/profit-allocations/preview", async (req, ctx) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.from || !b.to) return err("from and to dates are required");
  const method = b.method === "profit_share_ratio" ? "profit_share_ratio" : "ownership";
  const { netProfit, lines } = await computeAllocation(ctx.orgId, b.from, b.to, method);
  return json({ from: b.from, to: b.to, allocationMethod: method, netProfit, lines, status: "estimate" });
});

router.get("/api/profit-allocations", async (req, ctx) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const allocations = await sql`select * from profit_allocations where org_id=${ctx.orgId} order by to_date desc, created_at desc`;
  for (const a of allocations) {
    a.lines = await sql`select pal.*, p.name as partner_name from profit_allocation_lines pal join partners p on p.id=pal.partner_id where pal.profit_allocation_id=${a.id}`;
  }
  return json({ allocations });
});

router.post("/api/profit-allocations", async (req, ctx) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.from || !b.to) return err("from and to dates are required");
  const method = b.method === "profit_share_ratio" ? "profit_share_ratio" : "ownership";
  const { netProfit, lines } = await computeAllocation(ctx.orgId, b.from, b.to, method);
  const result = await sql.begin(async (tx) => {
    const [allocation] = await tx`
      insert into profit_allocations (org_id, from_date, to_date, net_profit, allocation_method, status, notes, created_by)
      values (${ctx.orgId}, ${b.from}, ${b.to}, ${netProfit}, ${method}, 'draft', ${b.notes || null}, ${ctx.user.id})
      returning *
    `;
    for (const l of lines) {
      await tx`insert into profit_allocation_lines (profit_allocation_id, partner_id, pct_used, amount) values (${allocation.id}, ${l.partnerId}, ${l.pctUsed}, ${l.amount})`;
    }
    return allocation;
  });
  result.lines = lines;
  return json({ allocation: result }, 201);
});

router.post("/api/profit-allocations/:id/approve", async (req, ctx, params) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const [row] = await sql`update profit_allocations set status='approved' where org_id=${ctx.orgId} and id=${params.id} and status='draft' returning *`;
  if (!row) return err("Allocation not found, or it's already approved", 404);
  return json({ allocation: row });
});

router.del("/api/profit-allocations/:id", async (req, ctx, params) => {
  const bad = requireOwnerOrAdmin(ctx); if (bad) return bad;
  const [existing] = await sql`select status from profit_allocations where org_id=${ctx.orgId} and id=${params.id}`;
  if (!existing) return err("Allocation not found", 404);
  if (existing.status !== "draft") return err("Only a draft (unapproved) allocation can be deleted", 409);
  await sql`delete from profit_allocations where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});
