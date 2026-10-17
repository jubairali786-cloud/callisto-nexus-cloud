// Double-entry posting engine. Every financial event in the app posts (or reverses)
// a balanced journal entry through these helpers — nothing writes journal_lines directly.

import { sql } from "../db.js";
import { toISODate } from "./helpers.js";

export const SYSTEM_ACCOUNTS = [
  // code, name, type, subtype
  ["1000", "Cash & Bank", "asset", "bank"],
  ["1100", "Accounts Receivable", "asset", "ar"],
  ["1200", "Inventory", "asset", "inventory"],
  ["1400", "VAT Receivable (Input)", "asset", "vat_input"],
  ["2000", "Accounts Payable", "liability", "ap"],
  ["2100", "VAT Payable (Output)", "liability", "vat_output"],
  ["2200", "Partner Loans Payable", "liability", "partner_loans"],
  ["3000", "Owner's Equity", "equity", "equity"],
  ["3100", "Partners' Capital", "equity", "partners_capital"],
  ["3900", "Retained Earnings", "equity", "retained_earnings"],
  ["4000", "Sales Revenue", "income", "sales"],
  ["5000", "Cost of Goods Sold", "expense", "cogs"],
  ["5900", "General Expenses", "expense", "general"],
];

export async function ensureSystemAccounts(orgId) {
  for (const [code, name, type, subtype] of SYSTEM_ACCOUNTS) {
    await sql`
      insert into accounts (org_id, code, name, type, subtype, is_system)
      values (${orgId}, ${code}, ${name}, ${type}, ${subtype}, true)
      on conflict (org_id, code) do nothing
    `;
  }
}

export async function getSystemAccountId(orgId, subtype) {
  const rows = await sql`select id from accounts where org_id=${orgId} and subtype=${subtype} limit 1`;
  if (!rows.length) throw new Error(`System account missing for subtype ${subtype}`);
  return rows[0].id;
}

// lines: [{accountId, debit, credit, description}], amounts already in base currency.
// Throws if debits != credits (within rounding tolerance).
export async function postJournalEntry({ orgId, entryDate, memo, sourceType, sourceId, createdBy, lines }) {
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Unbalanced journal entry: debit ${totalDebit} != credit ${totalCredit} (${memo})`);
  }
  return await sql.begin(async (tx) => {
    const [entry] = await tx`
      insert into journal_entries (org_id, entry_date, memo, source_type, source_id, created_by)
      values (${orgId}, ${toISODate(entryDate)}, ${memo}, ${sourceType}, ${sourceId}, ${createdBy || null})
      returning id
    `;
    for (const l of lines) {
      await tx`
        insert into journal_lines (journal_entry_id, account_id, debit, credit, description)
        values (${entry.id}, ${l.accountId}, ${Number(l.debit || 0)}, ${Number(l.credit || 0)}, ${l.description || null})
      `;
    }
    return entry.id;
  });
}

// Reverses a previously-posted journal entry (e.g. voiding an invoice) by posting
// the mirror-image entry and linking it back via reversed_by.
export async function reverseJournalEntry({ orgId, journalEntryId, entryDate, memo, createdBy }) {
  const lines = await sql`select account_id, debit, credit, description from journal_lines where journal_entry_id=${journalEntryId}`;
  if (!lines.length) return null;
  const reversedLines = lines.map((l) => ({
    accountId: l.account_id,
    debit: Number(l.credit),
    credit: Number(l.debit),
    description: l.description,
  }));
  const newId = await postJournalEntry({
    orgId, entryDate, memo: memo || "Reversal", sourceType: "reversal", sourceId: journalEntryId, createdBy, lines: reversedLines,
  });
  await sql`update journal_entries set reversed_by=${newId} where id=${journalEntryId}`;
  return newId;
}

export async function findJournalEntryForSource(orgId, sourceType, sourceId) {
  const rows = await sql`select id from journal_entries where org_id=${orgId} and source_type=${sourceType} and source_id=${sourceId} and reversed_by is null order by created_at desc limit 1`;
  return rows[0]?.id || null;
}

// ---- Reporting aggregates ----

export async function trialBalance(orgId, asOfDate) {
  return await sql`
    select a.id, a.code, a.name, a.type, a.subtype,
      coalesce(sum(jl.debit),0) as total_debit,
      coalesce(sum(jl.credit),0) as total_credit
    from accounts a
    left join journal_lines jl on jl.account_id = a.id
    left join journal_entries je on je.id = jl.journal_entry_id and je.entry_date <= ${asOfDate}
    where a.org_id = ${orgId} and (jl.id is null or je.id is not null)
    group by a.id, a.code, a.name, a.type, a.subtype
    order by a.code
  `;
}

export async function profitAndLoss(orgId, fromDate, toDate) {
  return await sql`
    select a.id, a.code, a.name, a.type, a.subtype,
      coalesce(sum(jl.credit) - sum(jl.debit),0) as net_credit,
      coalesce(sum(jl.debit) - sum(jl.credit),0) as net_debit
    from accounts a
    join journal_lines jl on jl.account_id = a.id
    join journal_entries je on je.id = jl.journal_entry_id
    where a.org_id = ${orgId} and a.type in ('income','expense')
      and je.entry_date between ${fromDate} and ${toDate}
    group by a.id, a.code, a.name, a.type, a.subtype
    order by a.type, a.code
  `;
}

export async function balanceSheet(orgId, asOfDate) {
  return await sql`
    select a.id, a.code, a.name, a.type, a.subtype,
      coalesce(sum(jl.debit) - sum(jl.credit),0) as net_debit,
      coalesce(sum(jl.credit) - sum(jl.debit),0) as net_credit
    from accounts a
    join journal_lines jl on jl.account_id = a.id
    join journal_entries je on je.id = jl.journal_entry_id
    where a.org_id = ${orgId} and a.type in ('asset','liability','equity')
      and je.entry_date <= ${asOfDate}
    group by a.id, a.code, a.name, a.type, a.subtype
    order by a.type, a.code
  `;
}
