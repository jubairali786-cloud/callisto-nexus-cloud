import { sql } from "../db.js";
import { postJournalEntry, reverseJournalEntry, findJournalEntryForSource, getSystemAccountId } from "./ledger.js";
import { applyStockMovement } from "./inventory.js";
import { round2 } from "./helpers.js";

// Issuing an invoice posts revenue + VAT + AR, and moves inventory items out at cost (COGS).
export async function postInvoiceIssue(invoice, lines, createdBy) {
  const fx = Number(invoice.fx_rate);
  const arAcct = await getSystemAccountId(invoice.org_id, "ar");
  const salesAcct = await getSystemAccountId(invoice.org_id, "sales");
  const vatAcct = await getSystemAccountId(invoice.org_id, "vat_output");
  const cogsAcct = await getSystemAccountId(invoice.org_id, "cogs");
  const inventoryAcct = await getSystemAccountId(invoice.org_id, "inventory");

  const subtotalBase = round2(Number(invoice.subtotal) * fx);
  const vatBase = round2(Number(invoice.vat_total) * fx);
  const totalBase = round2(Number(invoice.total) * fx);

  const journalLines = [
    { accountId: arAcct, debit: totalBase, credit: 0, description: `Invoice ${invoice.number}` },
    { accountId: salesAcct, debit: 0, credit: subtotalBase, description: `Invoice ${invoice.number}` },
  ];
  if (vatBase > 0) journalLines.push({ accountId: vatAcct, debit: 0, credit: vatBase, description: `VAT on ${invoice.number}` });

  // Move inventory items out at weighted-average cost
  let totalCogs = 0;
  for (const l of lines) {
    if (!l.item_id) continue;
    const [item] = await sql`select * from items where id=${l.item_id}`;
    if (!item || !item.track_inventory) continue;
    const { costUsed } = await applyStockMovement({
      orgId: invoice.org_id, itemId: item.id, qtyDelta: -Number(l.qty), unitCost: null,
      moveType: "sale", refType: "invoice", refId: invoice.id, movementDate: invoice.invoice_date,
    });
    totalCogs += round2(costUsed * Number(l.qty));
  }
  if (totalCogs > 0) {
    journalLines.push({ accountId: cogsAcct, debit: round2(totalCogs), credit: 0, description: `COGS for ${invoice.number}` });
    journalLines.push({ accountId: inventoryAcct, debit: 0, credit: round2(totalCogs), description: `COGS for ${invoice.number}` });
  }

  return await postJournalEntry({
    orgId: invoice.org_id, entryDate: invoice.invoice_date, memo: `Invoice ${invoice.number} issued`,
    sourceType: "invoice", sourceId: invoice.id, createdBy, lines: journalLines,
  });
}

export async function postInvoicePayment(invoice, payment, bankGlAccountId, createdBy) {
  const fx = Number(payment.fx_rate);
  const amountBase = round2(Number(payment.amount) * fx);
  const arAcct = await getSystemAccountId(invoice.org_id, "ar");
  const bankAcct = bankGlAccountId || (await getSystemAccountId(invoice.org_id, "bank"));
  return await postJournalEntry({
    orgId: invoice.org_id, entryDate: payment.payment_date, memo: `Payment received for ${invoice.number}`,
    sourceType: "payment", sourceId: payment.id, createdBy,
    lines: [
      { accountId: bankAcct, debit: amountBase, credit: 0, description: `Payment for ${invoice.number}` },
      { accountId: arAcct, debit: 0, credit: amountBase, description: `Payment for ${invoice.number}` },
    ],
  });
}

// Voids an issued invoice: reverses its issue journal entry and restocks any inventory it moved.
export async function postInvoiceVoid(invoice, lines, createdBy) {
  const journalId = await findJournalEntryForSource(invoice.org_id, "invoice", invoice.id);
  if (journalId) {
    await reverseJournalEntry({ orgId: invoice.org_id, journalEntryId: journalId, entryDate: new Date().toISOString().slice(0, 10), memo: `Void invoice ${invoice.number}`, createdBy });
  }
  for (const l of lines) {
    if (!l.item_id) continue;
    const [item] = await sql`select * from items where id=${l.item_id}`;
    if (!item || !item.track_inventory) continue;
    await applyStockMovement({
      orgId: invoice.org_id, itemId: item.id, qtyDelta: Number(l.qty), unitCost: item.avg_cost,
      moveType: "adjustment", refType: "invoice_void", refId: invoice.id,
    });
  }
}

// Issuing a credit note reverses revenue/VAT/AR proportionally, and optionally restocks items.
export async function postCreditNoteIssue(creditNote, lines, createdBy) {
  const fx = Number(creditNote.fx_rate);
  const arAcct = await getSystemAccountId(creditNote.org_id, "ar");
  const salesAcct = await getSystemAccountId(creditNote.org_id, "sales");
  const vatAcct = await getSystemAccountId(creditNote.org_id, "vat_output");
  const cogsAcct = await getSystemAccountId(creditNote.org_id, "cogs");
  const inventoryAcct = await getSystemAccountId(creditNote.org_id, "inventory");

  const subtotalBase = round2(Number(creditNote.subtotal) * fx);
  const vatBase = round2(Number(creditNote.vat_total) * fx);
  const totalBase = round2(Number(creditNote.total) * fx);

  const journalLines = [
    { accountId: salesAcct, debit: subtotalBase, credit: 0, description: `Credit note ${creditNote.number}` },
  ];
  if (vatBase > 0) journalLines.push({ accountId: vatAcct, debit: vatBase, credit: 0, description: `VAT reversal ${creditNote.number}` });
  journalLines.push({ accountId: arAcct, debit: 0, credit: totalBase, description: `Credit note ${creditNote.number}` });

  let totalCogsReversal = 0;
  if (creditNote.restock) {
    for (const l of lines) {
      if (!l.item_id) continue;
      const [item] = await sql`select * from items where id=${l.item_id}`;
      if (!item || !item.track_inventory) continue;
      const { item: updated } = await applyStockMovement({
        orgId: creditNote.org_id, itemId: item.id, qtyDelta: Number(l.qty), unitCost: item.avg_cost,
        moveType: "credit_return", refType: "credit_note", refId: creditNote.id, movementDate: creditNote.cn_date,
      });
      totalCogsReversal += round2(Number(item.avg_cost) * Number(l.qty));
    }
  }
  if (totalCogsReversal > 0) {
    journalLines.push({ accountId: inventoryAcct, debit: round2(totalCogsReversal), credit: 0, description: `Restock for ${creditNote.number}` });
    journalLines.push({ accountId: cogsAcct, debit: 0, credit: round2(totalCogsReversal), description: `Restock for ${creditNote.number}` });
  }

  return await postJournalEntry({
    orgId: creditNote.org_id, entryDate: creditNote.cn_date, memo: `Credit note ${creditNote.number} issued`,
    sourceType: "credit_note", sourceId: creditNote.id, createdBy, lines: journalLines,
  });
}
