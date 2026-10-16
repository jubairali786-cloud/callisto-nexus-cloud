import { sql } from "../db.js";
import { postJournalEntry, reverseJournalEntry, findJournalEntryForSource, getSystemAccountId } from "./ledger.js";
import { applyStockMovement } from "./inventory.js";
import { round2 } from "./helpers.js";

// Recording (opening) a bill posts AP + input VAT, and expenses/inventory for each line.
// Inventory lines restock the item at the bill's unit price (converted to base currency).
export async function postBillOpen(bill, lines, createdBy) {
  const fx = Number(bill.fx_rate);
  const apAcct = await getSystemAccountId(bill.org_id, "ap");
  const vatInputAcct = await getSystemAccountId(bill.org_id, "vat_input");
  const inventoryAcct = await getSystemAccountId(bill.org_id, "inventory");
  const generalExpenseAcct = await getSystemAccountId(bill.org_id, "general");

  const journalLines = [];
  let vatBaseTotal = 0;

  for (const l of lines) {
    const lineBase = round2(Number(l.qty) * Number(l.unit_price) * fx);
    const lineVat = round2(lineBase * (Number(l.vat_rate) / 100));
    vatBaseTotal += lineVat;

    if (l.item_id) {
      const [item] = await sql`select * from items where id=${l.item_id}`;
      if (item && item.track_inventory) {
        const unitCostBase = round2(Number(l.unit_price) * fx);
        await applyStockMovement({
          orgId: bill.org_id, itemId: item.id, qtyDelta: Number(l.qty), unitCost: unitCostBase,
          moveType: "purchase", refType: "bill", refId: bill.id, movementDate: bill.bill_date,
        });
        journalLines.push({ accountId: inventoryAcct, debit: lineBase, credit: 0, description: `Bill ${bill.number}: ${l.description}` });
        continue;
      }
    }
    const expenseAcct = l.expense_account_id || generalExpenseAcct;
    journalLines.push({ accountId: expenseAcct, debit: lineBase, credit: 0, description: `Bill ${bill.number}: ${l.description}` });
  }

  if (vatBaseTotal > 0) journalLines.push({ accountId: vatInputAcct, debit: round2(vatBaseTotal), credit: 0, description: `Input VAT on ${bill.number}` });

  const totalBase = round2(Number(bill.total) * fx);
  journalLines.push({ accountId: apAcct, debit: 0, credit: totalBase, description: `Bill ${bill.number}` });

  return await postJournalEntry({
    orgId: bill.org_id, entryDate: bill.bill_date, memo: `Bill ${bill.number} recorded`,
    sourceType: "bill", sourceId: bill.id, createdBy, lines: journalLines,
  });
}

export async function postBillPayment(bill, payment, bankGlAccountId, createdBy) {
  const fx = Number(payment.fx_rate);
  const amountBase = round2(Number(payment.amount) * fx);
  const apAcct = await getSystemAccountId(bill.org_id, "ap");
  const bankAcct = bankGlAccountId || (await getSystemAccountId(bill.org_id, "bank"));
  return await postJournalEntry({
    orgId: bill.org_id, entryDate: payment.payment_date, memo: `Payment made for bill ${bill.number}`,
    sourceType: "bill_payment", sourceId: payment.id, createdBy,
    lines: [
      { accountId: apAcct, debit: amountBase, credit: 0, description: `Payment for ${bill.number}` },
      { accountId: bankAcct, debit: 0, credit: amountBase, description: `Payment for ${bill.number}` },
    ],
  });
}

export async function postBillVoid(bill, lines, createdBy) {
  const journalId = await findJournalEntryForSource(bill.org_id, "bill", bill.id);
  if (journalId) {
    await reverseJournalEntry({ orgId: bill.org_id, journalEntryId: journalId, entryDate: new Date().toISOString().slice(0, 10), memo: `Void bill ${bill.number}`, createdBy });
  }
  for (const l of lines) {
    if (!l.item_id) continue;
    const [item] = await sql`select * from items where id=${l.item_id}`;
    if (!item || !item.track_inventory) continue;
    await applyStockMovement({
      orgId: bill.org_id, itemId: item.id, qtyDelta: -Number(l.qty), unitCost: item.avg_cost,
      moveType: "purchase_return", refType: "bill_void", refId: bill.id,
    });
  }
}
