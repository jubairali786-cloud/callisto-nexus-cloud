import { sql } from "../db.js";
import { json, err, round2 } from "../lib/helpers.js";
import { postJournalEntry } from "../lib/ledger.js";
import { Router } from "../lib/router.js";

export const router = new Router();
function requireOrg(ctx) { if (!ctx || !ctx.orgId) return err("Not authenticated", 401); return null; }

router.get("/api/bank-accounts", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`select * from bank_accounts where org_id=${ctx.orgId} order by name`;
  return json({ bankAccounts: rows });
});
router.post("/api/bank-accounts", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.name) return err("name is required");
  const [org] = await sql`select base_currency from orgs where id=${ctx.orgId}`;
  // Each bank account gets its own GL account under the "bank" subtype so multiple
  // accounts can be tracked and reconciled distinctly while rolling up to Cash & Bank.
  const [acct] = await sql`
    insert into accounts (org_id, code, name, type, subtype) values
      (${ctx.orgId}, ${"BANK-" + Date.now().toString().slice(-6)}, ${b.name}, 'asset', 'bank')
    returning id
  `;
  const [row] = await sql`
    insert into bank_accounts (org_id, name, currency_code, gl_account_id, opening_balance)
    values (${ctx.orgId}, ${b.name}, ${b.currencyCode || org.base_currency}, ${acct.id}, ${round2(b.openingBalance || 0)})
    returning *
  `;
  if (Number(b.openingBalance || 0) !== 0) {
    const equityAcct = (await sql`select id from accounts where org_id=${ctx.orgId} and subtype='equity'`)[0].id;
    const amt = round2(b.openingBalance);
    await postJournalEntry({
      orgId: ctx.orgId, entryDate: new Date().toISOString().slice(0, 10), memo: `Opening balance: ${b.name}`,
      sourceType: "opening_balance", sourceId: row.id, createdBy: ctx.user.id,
      lines: amt > 0
        ? [{ accountId: acct.id, debit: amt, credit: 0 }, { accountId: equityAcct, debit: 0, credit: amt }]
        : [{ accountId: equityAcct, debit: -amt, credit: 0 }, { accountId: acct.id, debit: 0, credit: -amt }],
    });
  }
  return json({ bankAccount: row }, 201);
});

router.get("/api/bank-accounts/:id/transactions", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`select * from bank_transactions where org_id=${ctx.orgId} and bank_account_id=${params.id} order by txn_date desc`;
  return json({ transactions: rows });
});

// Bulk CSV import: body = { rows: [{date, description, amount}] }. Parsing the raw CSV text
// into rows is done client-side so the server stays format-agnostic.
router.post("/api/bank-accounts/:id/import", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!Array.isArray(b.rows) || !b.rows.length) return err("rows[] is required");
  const batch = "import-" + Date.now();
  const inserted = [];
  for (const r of b.rows) {
    if (!r.date || r.amount == null) continue;
    const [row] = await sql`
      insert into bank_transactions (org_id, bank_account_id, txn_date, description, amount, import_batch)
      values (${ctx.orgId}, ${params.id}, ${r.date}, ${r.description || null}, ${round2(r.amount)}, ${batch})
      returning *
    `;
    inserted.push(row);
  }
  return json({ imported: inserted.length, batch, transactions: inserted }, 201);
});

// Manual reconciliation: match a bank transaction to an existing unreconciled journal entry,
// or (if none fits) post a brand-new one against a chosen GL account (e.g. bank fees, interest).
router.post("/api/bank-transactions/:id/match", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [txn] = await sql`select * from bank_transactions where org_id=${ctx.orgId} and id=${params.id}`;
  if (!txn) return err("Bank transaction not found", 404);
  const [bankAccount] = await sql`select * from bank_accounts where id=${txn.bank_account_id}`;

  let journalEntryId = b.journalEntryId || null;
  if (!journalEntryId && b.counterAccountId) {
    const amt = Math.abs(Number(txn.amount));
    const lines = txn.amount >= 0
      ? [{ accountId: bankAccount.gl_account_id, debit: amt, credit: 0, description: txn.description }, { accountId: b.counterAccountId, debit: 0, credit: amt, description: txn.description }]
      : [{ accountId: b.counterAccountId, debit: amt, credit: 0, description: txn.description }, { accountId: bankAccount.gl_account_id, debit: 0, credit: amt, description: txn.description }];
    journalEntryId = await postJournalEntry({ orgId: ctx.orgId, entryDate: txn.txn_date, memo: txn.description || "Bank transaction", sourceType: "bank_txn", sourceId: txn.id, createdBy: ctx.user.id, lines });
  }
  if (!journalEntryId) return err("Provide journalEntryId (existing entry) or counterAccountId (to post a new one)");
  const [updated] = await sql`update bank_transactions set status='matched', matched_journal_entry_id=${journalEntryId} where id=${txn.id} returning *`;
  return json({ transaction: updated });
});

router.post("/api/bank-transactions/:id/ignore", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [updated] = await sql`update bank_transactions set status='ignored' where org_id=${ctx.orgId} and id=${params.id} returning *`;
  if (!updated) return err("Bank transaction not found", 404);
  return json({ transaction: updated });
});

// Unmatched/unreconciled journal lines on this bank's GL account, as candidates to pick from.
router.get("/api/bank-accounts/:id/unreconciled-candidates", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [bankAccount] = await sql`select * from bank_accounts where org_id=${ctx.orgId} and id=${params.id}`;
  if (!bankAccount) return err("Bank account not found", 404);
  const matchedIds = await sql`select matched_journal_entry_id from bank_transactions where bank_account_id=${params.id} and matched_journal_entry_id is not null`;
  const excluded = matchedIds.map((r) => r.matched_journal_entry_id);
  const rows = await sql`
    select je.id, je.entry_date, je.memo, jl.debit, jl.credit from journal_entries je
    join journal_lines jl on jl.journal_entry_id = je.id
    where je.org_id=${ctx.orgId} and jl.account_id=${bankAccount.gl_account_id}
      and je.id != all(${excluded.length ? excluded : [null]})
    order by je.entry_date desc limit 100
  `;
  return json({ candidates: rows });
});
