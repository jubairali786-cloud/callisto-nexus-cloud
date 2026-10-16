// Run with: DATABASE_URL=postgres://... bun test
// Exercises the core double-entry engine directly against a real Postgres instance:
// every journal entry must balance, inventory costing must be correct, and VAT/totals
// must compute correctly. These are the invariants a bug here would silently violate.
import { test, expect, beforeAll } from "bun:test";
import { sql, migrate } from "../server/db.js";
import { ensureSystemAccounts, getSystemAccountId, postJournalEntry, trialBalance } from "../server/lib/ledger.js";
import { applyStockMovement, postAdjustmentJournal } from "../server/lib/inventory.js";
import { computeTotals, round2 } from "../server/lib/helpers.js";

let orgId;

beforeAll(async () => {
  await migrate();
  const [org] = await sql`insert into orgs (name) values ('Test Co') returning id`;
  orgId = org.id;
  await ensureSystemAccounts(orgId);
});

test("computeTotals applies VAT and discount correctly", () => {
  const t = computeTotals([
    { qty: 32, unitPrice: 120, discountPct: 0, vatRate: 5 },
    { qty: 2, unitPrice: 50, discountPct: 10, vatRate: 5 },
  ]);
  // 32*120 = 3840; 2*50*0.9 = 90; subtotal = 3930
  expect(t.subtotal).toBe(3930);
  expect(t.vatTotal).toBe(round2(3930 * 0.05));
  expect(t.total).toBe(round2(3930 * 1.05));
});

test("postJournalEntry rejects unbalanced entries", async () => {
  const bankAcct = await getSystemAccountId(orgId, "bank");
  const arAcct = await getSystemAccountId(orgId, "ar");
  await expect(postJournalEntry({
    orgId, entryDate: "2026-01-01", memo: "bad entry", sourceType: "test", sourceId: null,
    lines: [{ accountId: bankAcct, debit: 100, credit: 0 }, { accountId: arAcct, debit: 0, credit: 50 }],
  })).rejects.toThrow(/Unbalanced/);
});

test("postJournalEntry accepts balanced entries and trial balance stays balanced", async () => {
  const bankAcct = await getSystemAccountId(orgId, "bank");
  const equityAcct = await getSystemAccountId(orgId, "equity");
  await postJournalEntry({
    orgId, entryDate: "2026-01-01", memo: "opening capital", sourceType: "test", sourceId: null,
    lines: [{ accountId: bankAcct, debit: 10000, credit: 0 }, { accountId: equityAcct, debit: 0, credit: 10000 }],
  });
  const tb = await trialBalance(orgId, "2026-12-31");
  const totalDebit = round2(tb.reduce((s, r) => s + Number(r.total_debit), 0));
  const totalCredit = round2(tb.reduce((s, r) => s + Number(r.total_credit), 0));
  expect(totalDebit).toBe(totalCredit);
});

test("weighted-average inventory costing", async () => {
  const [item] = await sql`insert into items (org_id, name, item_type, sale_price, track_inventory) values (${orgId}, 'Test Widget', 'inventory', 100, true) returning *`;

  const in1 = await applyStockMovement({ orgId, itemId: item.id, qtyDelta: 100, unitCost: 60, moveType: "purchase" });
  expect(Number(in1.item.qty_on_hand)).toBe(100);
  expect(Number(in1.item.avg_cost)).toBe(60);

  const out1 = await applyStockMovement({ orgId, itemId: item.id, qtyDelta: -32, moveType: "sale" });
  expect(Number(out1.item.qty_on_hand)).toBe(68);
  expect(Number(out1.item.avg_cost)).toBe(60); // average unaffected by an outgoing movement
  expect(out1.costUsed).toBe(60);

  const in2 = await applyStockMovement({ orgId, itemId: item.id, qtyDelta: 50, unitCost: 62, moveType: "purchase" });
  // (68*60 + 50*62) / 118 = (4080 + 3100) / 118 = 60.8474...
  expect(Number(in2.item.qty_on_hand)).toBe(118);
  expect(Number(in2.item.avg_cost)).toBeCloseTo(60.85, 2);
});

test("opening-balance stock adjustment nets to equity, not COGS", async () => {
  const [item] = await sql`insert into items (org_id, name, item_type, sale_price, track_inventory) values (${orgId}, 'Opening Stock Widget', 'inventory', 50, true) returning *`;
  const { costUsed } = await applyStockMovement({ orgId, itemId: item.id, qtyDelta: 20, unitCost: 10, moveType: "adjustment" });
  const entryId = await postAdjustmentJournal({ orgId, qtyDelta: 20, costUsed, entryDate: "2026-01-01", memo: "opening stock test", isOpeningBalance: true });
  expect(entryId).toBeTruthy();
  const cogsBefore = await sql`
    select coalesce(sum(jl.debit)-sum(jl.credit),0) as net from journal_lines jl
    join accounts a on a.id=jl.account_id where a.org_id=${orgId} and a.subtype='cogs'
  `;
  // COGS should be untouched by an opening-balance adjustment (regression guard for the
  // bug where opening stock seeding was fabricating phantom P&L profit via COGS).
  expect(Number(cogsBefore[0].net)).toBe(0);
});
