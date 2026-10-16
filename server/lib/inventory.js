// Weighted-average-cost inventory engine. Every change to item quantity/cost goes
// through applyStockMovement so stock_movements stays a complete, consistent audit trail.

import { sql } from "../db.js";
import { round2, toISODate } from "./helpers.js";
import { postJournalEntry, getSystemAccountId } from "./ledger.js";

export async function applyStockMovement({ orgId, itemId, qtyDelta, unitCost, moveType, refType, refId, notes, createdBy, movementDate }) {
  return await sql.begin(async (tx) => {
    const [item] = await tx`select * from items where org_id=${orgId} and id=${itemId} for update`;
    if (!item) throw new Error("Item not found");

    const oldQty = Number(item.qty_on_hand);
    const oldAvg = Number(item.avg_cost);
    let newQty, newAvg, costUsedForMovement;

    if (qtyDelta > 0) {
      // Stock coming IN (purchase, credit-note return, positive adjustment)
      const incomingCost = unitCost != null ? Number(unitCost) : oldAvg;
      const totalOldValue = oldQty * oldAvg;
      const totalIncomingValue = qtyDelta * incomingCost;
      newQty = oldQty + qtyDelta;
      newAvg = newQty !== 0 ? round2((totalOldValue + totalIncomingValue) / newQty) : incomingCost;
      costUsedForMovement = incomingCost;
    } else {
      // Stock going OUT (sale, purchase return, negative adjustment) — costed at current average
      newQty = oldQty + qtyDelta; // qtyDelta is negative
      newAvg = oldAvg; // average unaffected by an outgoing movement
      costUsedForMovement = oldAvg;
    }

    await tx`update items set qty_on_hand=${newQty}, avg_cost=${newAvg} where id=${itemId}`;

    const [movement] = await tx`
      insert into stock_movements (org_id, item_id, movement_date, qty_delta, unit_cost, resulting_avg_cost, resulting_qty, move_type, ref_type, ref_id, notes)
      values (${orgId}, ${itemId}, ${toISODate(movementDate) || new Date().toISOString().slice(0, 10)}, ${qtyDelta}, ${round2(costUsedForMovement)}, ${newAvg}, ${newQty}, ${moveType}, ${refType || null}, ${refId || null}, ${notes || null})
      returning *
    `;

    return {
      item: { ...item, qty_on_hand: newQty, avg_cost: newAvg },
      movement,
      costUsed: round2(costUsedForMovement),
    };
  });
}

// Posts the GL side-effect for a manual stock adjustment (purchase/sale postings are
// handled inline by the bills/invoices modules alongside their own journal entries).
// isOpeningBalance=true is for seeding starting stock when first setting up the books — that's
// not a trading event, so it nets against Owner's Equity rather than COGS. A routine stock-take
// correction or shrinkage write-off during normal operations (isOpeningBalance=false, the default)
// nets against COGS since it genuinely affects the cost of goods available for sale.
export async function postAdjustmentJournal({ orgId, qtyDelta, costUsed, entryDate, memo, createdBy, isOpeningBalance = false }) {
  const value = round2(Math.abs(qtyDelta) * costUsed);
  if (value === 0) return null;
  const inventoryAcct = await getSystemAccountId(orgId, "inventory");
  const contraAcct = await getSystemAccountId(orgId, isOpeningBalance ? "equity" : "cogs");
  const lines = qtyDelta > 0
    ? [ // stock increase: debit inventory asset, credit the contra account
        { accountId: inventoryAcct, debit: value, credit: 0, description: memo },
        { accountId: contraAcct, debit: 0, credit: value, description: memo },
      ]
    : [ // stock decrease: credit inventory asset, debit the contra account
        { accountId: contraAcct, debit: value, credit: 0, description: memo },
        { accountId: inventoryAcct, debit: 0, credit: value, description: memo },
      ];
  return await postJournalEntry({ orgId, entryDate, memo, sourceType: isOpeningBalance ? "opening_balance" : "stock_adjustment", sourceId: null, createdBy, lines });
}
