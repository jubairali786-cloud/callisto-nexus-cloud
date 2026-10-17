// Shared business logic for the Investment & Partners module: ownership bookkeeping,
// per-partner capital summaries, and the aggregated figures behind the consolidated
// dashboard. Kept separate from server/routes/partners.js so the dashboard math (which
// pulls from several existing modules — ledger, invoices, bills, payments) is easy to
// find and audit in one place.
import { sql } from "../db.js";
import { round2, toISODate } from "./helpers.js";
import { profitAndLoss, trialBalance } from "./ledger.js";

export async function getActivePartners(orgId) {
  return await sql`select * from partners where org_id=${orgId} and status='active' order by created_at`;
}

// Sum of ownership_pct across ACTIVE partners — the number the UI validates against 100%.
export async function totalOwnershipPct(orgId, excludePartnerId) {
  const rows = excludePartnerId
    ? await sql`select coalesce(sum(ownership_pct),0) as total from partners where org_id=${orgId} and status='active' and id != ${excludePartnerId}`
    : await sql`select coalesce(sum(ownership_pct),0) as total from partners where org_id=${orgId} and status='active'`;
  return round2(Number(rows[0].total));
}

export async function writeOwnershipSnapshot(tx, orgId, partnerId, ownershipPct, effectiveDate, shareTransferId) {
  await tx`
    insert into partner_ownership_snapshots (org_id, partner_id, ownership_pct, effective_date, share_transfer_id)
    values (${orgId}, ${partnerId}, ${ownershipPct}, ${effectiveDate || new Date().toISOString().slice(0, 10)}, ${shareTransferId || null})
  `;
}

// The ownership % that was actually in effect for a partner as of a given date — the
// latest snapshot dated on or before it, falling back to their earliest snapshot if the
// date predates any (so pulling a statement for a date before the partner existed just
// shows what they started at, rather than nothing).
export async function ownershipAsOf(orgId, partnerId, date) {
  const asOf = toISODate(date) || new Date().toISOString().slice(0, 10);
  const rows = await sql`
    select ownership_pct from partner_ownership_snapshots
    where org_id=${orgId} and partner_id=${partnerId} and effective_date <= ${asOf}
    order by effective_date desc, created_at desc limit 1
  `;
  if (rows.length) return Number(rows[0].ownership_pct);
  const earliest = await sql`
    select ownership_pct from partner_ownership_snapshots
    where org_id=${orgId} and partner_id=${partnerId} order by effective_date asc, created_at asc limit 1
  `;
  return earliest.length ? Number(earliest[0].ownership_pct) : 0;
}

// Running, all-time capital position for one partner, built entirely from
// partner_transactions — never denormalized onto the partners row, so it's always
// consistent with the transaction history.
export async function partnerCapitalSummary(orgId, partnerId) {
  const rows = await sql`
    select txn_type, coalesce(sum(amount * fx_rate),0) as total
    from partner_transactions where org_id=${orgId} and partner_id=${partnerId} group by txn_type
  `;
  const by = Object.fromEntries(rows.map((r) => [r.txn_type, round2(Number(r.total))]));
  const contributed = by.contribution || 0;
  const loans = by.loan || 0;
  const loanRepayments = by.loan_repayment || 0;
  const withdrawals = by.withdrawal || 0;
  const distributions = by.distribution || 0;
  return {
    capitalContributed: contributed,
    loansProvided: loans,
    loanRepayments,
    loanOutstanding: round2(loans - loanRepayments),
    withdrawals,
    distributionsReceived: distributions,
    netCapital: round2(contributed - withdrawals), // capital still "in" the business, excluding loans
  };
}

// -------- Consolidated dashboard --------
// Company-wide financial figures for [from, to], built from the same ledger/report
// helpers the rest of the app already uses (never a separate manual total), so there's
// no risk of double counting against Sales/Purchases/Banking.
export async function companyFinancials(orgId, from, to) {
  const warnings = [];

  const pl = await profitAndLoss(orgId, from, to);
  const incomeRows = pl.filter((r) => r.type === "income");
  const expenseRows = pl.filter((r) => r.type === "expense");
  const salesRevenue = round2(incomeRows.reduce((s, r) => s + Number(r.net_credit), 0));
  const cogs = round2(expenseRows.filter((r) => r.subtype === "cogs").reduce((s, r) => s + Number(r.net_debit), 0));
  const operatingExpenses = round2(expenseRows.filter((r) => r.subtype !== "cogs").reduce((s, r) => s + Number(r.net_debit), 0));
  const grossProfit = round2(salesRevenue - cogs);
  const netProfit = round2(grossProfit - operatingExpenses);
  warnings.push("Cost of goods sold reflects inventory items sold through Invoices only — this app has no separate project-cost tracking, so direct project costs aren't broken out from Operating Expenses.");

  const purchaseRows = await sql`
    select coalesce(sum(subtotal * fx_rate),0) as total from bills
    where org_id=${orgId} and status not in ('draft','void') and bill_date between ${from} and ${to}
  `;
  const totalPurchases = round2(Number(purchaseRows[0].total));

  const paymentRows = await sql`
    select coalesce(sum(amount * fx_rate),0) as total from payments
    where org_id=${orgId} and payment_date between ${from} and ${to}
  `;
  const customerPaymentsReceived = round2(Number(paymentRows[0].total));

  const arRows = await sql`
    select coalesce(sum(i.total - i.amount_paid - coalesce((select sum(cn.total) from credit_notes cn where cn.invoice_id=i.id and cn.status='issued'),0)),0) as total
    from invoices i where i.org_id=${orgId} and i.status in ('issued','partially_paid') and i.invoice_date <= ${to}
  `;
  const outstandingReceivables = round2(Number(arRows[0].total));

  const apRows = await sql`
    select coalesce(sum(total - amount_paid),0) as total from bills
    where org_id=${orgId} and status in ('open','partially_paid') and bill_date <= ${to}
  `;
  const outstandingPayables = round2(Number(apRows[0].total));

  const bankRows = await trialBalance(orgId, to);
  const bankAccts = bankRows.filter((r) => r.subtype === "bank");
  if (!bankAccts.length) warnings.push("No bank account balance could be calculated — no 'bank' account exists in the chart of accounts.");
  const cashAndBankBalance = round2(bankAccts.reduce((s, r) => s + Number(r.total_debit) - Number(r.total_credit), 0));

  // Cumulative since inception, independent of the from/to filter — this is the pool
  // profit distributions are drawn from, not just the current period's profit.
  const plAllTime = await profitAndLoss(orgId, "1900-01-01", to);
  const netProfitAllTime = round2(
    plAllTime.filter((r) => r.type === "income").reduce((s, r) => s + Number(r.net_credit), 0) -
    plAllTime.filter((r) => r.type === "expense").reduce((s, r) => s + Number(r.net_debit), 0)
  );
  const distRows = await sql`
    select coalesce(sum(amount * fx_rate),0) as total from partner_transactions
    where org_id=${orgId} and txn_type='distribution' and txn_date <= ${to}
  `;
  const totalDistributedAllTime = round2(Number(distRows[0].total));
  const undistributedProfit = round2(netProfitAllTime - totalDistributedAllTime);

  return {
    from, to, salesRevenue, totalPurchases, customerPaymentsReceived, outstandingReceivables, outstandingPayables,
    cogs, operatingExpenses, grossProfit, netProfit, cashAndBankBalance,
    netProfitAllTime, totalDistributedAllTime, undistributedProfit, warnings,
  };
}
