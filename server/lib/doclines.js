// Generic helpers for the line-items tables shared by quotes/invoices/credit notes/POs/bills.
import { sql } from "../db.js";

export async function replaceQuoteLines(tx, quoteId, lines) {
  await tx`delete from quote_lines where quote_id=${quoteId}`;
  let i = 0;
  for (const l of lines) {
    await tx`
      insert into quote_lines (quote_id, item_id, description, qty, unit, unit_price, discount_pct, vat_rate, sort_order)
      values (${quoteId}, ${l.itemId || null}, ${l.description}, ${l.qty}, ${l.unit || null}, ${l.unitPrice}, ${l.discountPct || 0}, ${l.vatRate ?? 5}, ${i++})
    `;
  }
}
export async function replaceInvoiceLines(tx, invoiceId, lines) {
  await tx`delete from invoice_lines where invoice_id=${invoiceId}`;
  let i = 0;
  for (const l of lines) {
    await tx`
      insert into invoice_lines (invoice_id, item_id, description, qty, unit, unit_price, discount_pct, vat_rate, sort_order)
      values (${invoiceId}, ${l.itemId || null}, ${l.description}, ${l.qty}, ${l.unit || null}, ${l.unitPrice}, ${l.discountPct || 0}, ${l.vatRate ?? 5}, ${i++})
    `;
  }
}
export async function replaceCreditNoteLines(tx, cnId, lines) {
  await tx`delete from credit_note_lines where credit_note_id=${cnId}`;
  let i = 0;
  for (const l of lines) {
    await tx`
      insert into credit_note_lines (credit_note_id, item_id, description, qty, unit, unit_price, discount_pct, vat_rate, sort_order)
      values (${cnId}, ${l.itemId || null}, ${l.description}, ${l.qty}, ${l.unit || null}, ${l.unitPrice}, ${l.discountPct || 0}, ${l.vatRate ?? 5}, ${i++})
    `;
  }
}
export async function replacePoLines(tx, poId, lines) {
  await tx`delete from po_lines where po_id=${poId}`;
  let i = 0;
  for (const l of lines) {
    await tx`
      insert into po_lines (po_id, item_id, description, qty, unit, unit_price, vat_rate, sort_order)
      values (${poId}, ${l.itemId || null}, ${l.description}, ${l.qty}, ${l.unit || null}, ${l.unitPrice}, ${l.vatRate ?? 5}, ${i++})
    `;
  }
}
export async function replaceBillLines(tx, billId, lines) {
  await tx`delete from bill_lines where bill_id=${billId}`;
  let i = 0;
  for (const l of lines) {
    await tx`
      insert into bill_lines (bill_id, item_id, expense_account_id, description, qty, unit, unit_price, vat_rate, sort_order)
      values (${billId}, ${l.itemId || null}, ${l.expenseAccountId || null}, ${l.description}, ${l.qty}, ${l.unit || null}, ${l.unitPrice}, ${l.vatRate ?? 5}, ${i++})
    `;
  }
}

export async function getQuoteLines(quoteId) { return await sql`select * from quote_lines where quote_id=${quoteId} order by sort_order`; }
export async function getInvoiceLines(invoiceId) { return await sql`select * from invoice_lines where invoice_id=${invoiceId} order by sort_order`; }
export async function getCreditNoteLines(cnId) { return await sql`select * from credit_note_lines where credit_note_id=${cnId} order by sort_order`; }
export async function getPoLines(poId) { return await sql`select * from po_lines where po_id=${poId} order by sort_order`; }
export async function getBillLines(billId) { return await sql`select * from bill_lines where bill_id=${billId} order by sort_order`; }
