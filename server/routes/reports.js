import { sql } from "../db.js";
import { json, err, round2 } from "../lib/helpers.js";
import { trialBalance, profitAndLoss, balanceSheet } from "../lib/ledger.js";
import { Router } from "../lib/router.js";

export const router = new Router();
function requireOrg(ctx) { if (!ctx || !ctx.orgId) return err("Not authenticated", 401); return null; }
const today = () => new Date().toISOString().slice(0, 10);

// -------- Chart of accounts --------
router.get("/api/accounts", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`select * from accounts where org_id=${ctx.orgId} order by code`;
  return json({ accounts: rows });
});
router.post("/api/accounts", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.code || !b.name || !b.type) return err("code, name and type are required");
  const [row] = await sql`insert into accounts (org_id, code, name, type, subtype) values (${ctx.orgId}, ${b.code}, ${b.name}, ${b.type}, ${b.subtype || null}) returning *`;
  return json({ account: row }, 201);
});
router.del("/api/accounts/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [acct] = await sql`select is_system from accounts where org_id=${ctx.orgId} and id=${params.id}`;
  if (!acct) return err("Account not found", 404);
  if (acct.is_system) return err("System accounts cannot be deleted", 409);
  await sql`delete from accounts where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});

// -------- Reports --------
router.get("/api/reports/trial-balance", async (req, ctx, params, url) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const asOf = url.searchParams.get("asOf") || today();
  const rows = await trialBalance(ctx.orgId, asOf);
  let totalDebit = 0, totalCredit = 0;
  const lines = rows.map((r) => {
    totalDebit += Number(r.total_debit); totalCredit += Number(r.total_credit);
    return r;
  });
  return json({ asOf, accounts: lines, totalDebit: round2(totalDebit), totalCredit: round2(totalCredit) });
});

router.get("/api/reports/profit-and-loss", async (req, ctx, params, url) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const from = url.searchParams.get("from") || `${new Date().getFullYear()}-01-01`;
  const to = url.searchParams.get("to") || today();
  const rows = await profitAndLoss(ctx.orgId, from, to);
  const income = rows.filter((r) => r.type === "income");
  const expense = rows.filter((r) => r.type === "expense");
  const totalIncome = round2(income.reduce((s, r) => s + Number(r.net_credit), 0));
  const totalExpense = round2(expense.reduce((s, r) => s + Number(r.net_debit), 0));
  return json({ from, to, income, expense, totalIncome, totalExpense, netProfit: round2(totalIncome - totalExpense) });
});

router.get("/api/reports/balance-sheet", async (req, ctx, params, url) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const asOf = url.searchParams.get("asOf") || today();
  const rows = await balanceSheet(ctx.orgId, asOf);
  const assets = rows.filter((r) => r.type === "asset");
  const liabilities = rows.filter((r) => r.type === "liability");
  const equity = rows.filter((r) => r.type === "equity");
  const totalAssets = round2(assets.reduce((s, r) => s + Number(r.net_debit), 0));
  const totalLiabilities = round2(liabilities.reduce((s, r) => s + Number(r.net_credit), 0));
  // Retained earnings (current period net profit not yet closed to equity) rolls into equity for display.
  const pl = await profitAndLoss(ctx.orgId, "1900-01-01", asOf);
  const netProfitToDate = round2(
    pl.filter((r) => r.type === "income").reduce((s, r) => s + Number(r.net_credit), 0) -
    pl.filter((r) => r.type === "expense").reduce((s, r) => s + Number(r.net_debit), 0)
  );
  const totalEquity = round2(equity.reduce((s, r) => s + Number(r.net_credit), 0) + netProfitToDate);
  return json({ asOf, assets, liabilities, equity, netProfitToDate, totalAssets, totalLiabilities, totalEquity, balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.02 });
});

router.get("/api/reports/vat-summary", async (req, ctx, params, url) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const from = url.searchParams.get("from") || `${new Date().getFullYear()}-01-01`;
  const to = url.searchParams.get("to") || today();
  const outputRows = await sql`
    select coalesce(sum(i.vat_total * i.fx_rate),0) as output_vat, coalesce(sum(i.subtotal*i.fx_rate),0) as taxable_sales
    from invoices i where i.org_id=${ctx.orgId} and i.status != 'draft' and i.status != 'void' and i.invoice_date between ${from} and ${to}
  `;
  const creditRows = await sql`
    select coalesce(sum(cn.vat_total * cn.fx_rate),0) as output_vat_credited, coalesce(sum(cn.subtotal*cn.fx_rate),0) as sales_credited
    from credit_notes cn where cn.org_id=${ctx.orgId} and cn.status='issued' and cn.cn_date between ${from} and ${to}
  `;
  const inputRows = await sql`
    select coalesce(sum(bl.qty * bl.unit_price * b.fx_rate * bl.vat_rate / 100),0) as input_vat,
      coalesce(sum(bl.qty * bl.unit_price * b.fx_rate),0) as taxable_purchases
    from bills b join bill_lines bl on bl.bill_id=b.id
    where b.org_id=${ctx.orgId} and b.status != 'draft' and b.status != 'void' and b.bill_date between ${from} and ${to}
  `;
  const outputVat = round2(Number(outputRows[0].output_vat) - Number(creditRows[0].output_vat_credited));
  const inputVat = round2(Number(inputRows[0].input_vat));
  return json({
    from, to,
    taxableSales: round2(Number(outputRows[0].taxable_sales) - Number(creditRows[0].sales_credited)),
    outputVat, taxablePurchases: round2(Number(inputRows[0].taxable_purchases)), inputVat,
    netVatPayable: round2(outputVat - inputVat),
  });
});

router.get("/api/reports/stock-valuation", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`
    select id, sku, name, unit, qty_on_hand, avg_cost, (qty_on_hand*avg_cost) as stock_value
    from items where org_id=${ctx.orgId} and track_inventory=true order by name
  `;
  const totalValue = round2(rows.reduce((s, r) => s + Number(r.stock_value), 0));
  return json({ items: rows, totalValue });
});

router.get("/api/reports/ar-aging", async (req, ctx, params, url) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const asOf = url.searchParams.get("asOf") || today();
  const rows = await sql`
    select i.id, i.number, c.name as client_name, i.due_date, i.total, i.amount_paid,
      (i.total - i.amount_paid - coalesce((select sum(cn.total) from credit_notes cn where cn.invoice_id=i.id and cn.status='issued'),0)) as balance,
      (${asOf}::date - i.due_date) as days_overdue
    from invoices i join clients c on c.id=i.client_id
    where i.org_id=${ctx.orgId} and i.status in ('issued','partially_paid') and i.due_date <= ${asOf}
    order by days_overdue desc
  `;
  const bucketed = bucketAging(rows, "balance", "days_overdue");
  return json({ asOf, invoices: rows, buckets: bucketed });
});

router.get("/api/reports/ap-aging", async (req, ctx, params, url) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const asOf = url.searchParams.get("asOf") || today();
  const rows = await sql`
    select b.id, b.number, v.name as vendor_name, b.due_date, b.total, b.amount_paid,
      (b.total - b.amount_paid) as balance, (${asOf}::date - b.due_date) as days_overdue
    from bills b join vendors v on v.id=b.vendor_id
    where b.org_id=${ctx.orgId} and b.status in ('open','partially_paid') and b.due_date <= ${asOf}
    order by days_overdue desc
  `;
  const bucketed = bucketAging(rows, "balance", "days_overdue");
  return json({ asOf, bills: rows, buckets: bucketed });
});

function bucketAging(rows, amountKey, daysKey) {
  const buckets = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const r of rows) {
    const days = Number(r[daysKey]);
    const amt = Number(r[amountKey]);
    if (days <= 0) buckets.current += amt;
    else if (days <= 30) buckets["1-30"] += amt;
    else if (days <= 60) buckets["31-60"] += amt;
    else if (days <= 90) buckets["61-90"] += amt;
    else buckets["90+"] += amt;
  }
  for (const k in buckets) buckets[k] = round2(buckets[k]);
  return buckets;
}

// -------- Exchange rates --------
router.get("/api/exchange-rates", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`select * from exchange_rates where org_id=${ctx.orgId} order by as_of desc limit 100`;
  return json({ exchangeRates: rows });
});
router.post("/api/exchange-rates", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.currencyCode || !b.rateToBase) return err("currencyCode and rateToBase are required");
  const [row] = await sql`
    insert into exchange_rates (org_id, currency_code, rate_to_base, as_of) values (${ctx.orgId}, ${b.currencyCode.toUpperCase()}, ${b.rateToBase}, ${b.asOf || today()})
    returning *
  `;
  return json({ exchangeRate: row }, 201);
});
