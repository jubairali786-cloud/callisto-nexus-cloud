// Posts/reverses the GL entry for a partner capital transaction. Every transaction type
// touches Cash & Bank plus either Partners' Capital (equity) or Partner Loans Payable
// (liability) -- never an income or expense account, so none of these can ever show up
// as sales revenue or business profit on the P&L.
import { postJournalEntry, getSystemAccountId } from "./ledger.js";
import { round2 } from "./helpers.js";

// txn_type -> which side of the entry debits vs credits Cash & Bank / the equity-or-liability account.
// 'cash in' = Dr Bank / Cr the other account. 'cash out' = Dr the other account / Cr Bank.
const DIRECTION = {
  contribution: { cashIn: true, otherSubtype: "partners_capital" },
  loan: { cashIn: true, otherSubtype: "partner_loans" },
  withdrawal: { cashIn: false, otherSubtype: "partners_capital" },
  loan_repayment: { cashIn: false, otherSubtype: "partner_loans" },
  distribution: { cashIn: false, otherSubtype: "partners_capital" },
};

const LABEL = {
  contribution: "Capital contribution",
  loan: "Partner loan received",
  withdrawal: "Capital withdrawal",
  loan_repayment: "Partner loan repaid",
  distribution: "Profit distribution",
};

export async function postPartnerTransaction(orgId, txn, partnerName, bankGlAccountId, createdBy) {
  const dir = DIRECTION[txn.txn_type];
  if (!dir) throw new Error(`Unknown partner transaction type: ${txn.txn_type}`);
  const amountBase = round2(Number(txn.amount) * Number(txn.fx_rate || 1));
  const bankAcct = bankGlAccountId || (await getSystemAccountId(orgId, "bank"));
  const otherAcct = await getSystemAccountId(orgId, dir.otherSubtype);
  const memo = `${LABEL[txn.txn_type]} — ${partnerName}`;
  const lines = dir.cashIn
    ? [
        { accountId: bankAcct, debit: amountBase, credit: 0, description: memo },
        { accountId: otherAcct, debit: 0, credit: amountBase, description: memo },
      ]
    : [
        { accountId: otherAcct, debit: amountBase, credit: 0, description: memo },
        { accountId: bankAcct, debit: 0, credit: amountBase, description: memo },
      ];
  return await postJournalEntry({
    orgId, entryDate: txn.txn_date, memo, sourceType: "partner_transaction", sourceId: txn.id, createdBy, lines,
  });
}

// A 'new_investment' share transfer brings money into the company exactly like a
// contribution -- posted the same way, with its own source_type so it's traceable back
// to the share transfer rather than a partner_transactions row.
export async function postShareTransferInvestment(orgId, transfer, buyerName, bankGlAccountId, createdBy) {
  const amountBase = round2(Number(transfer.sale_price || 0));
  if (amountBase <= 0) return null;
  const bankAcct = bankGlAccountId || (await getSystemAccountId(orgId, "bank"));
  const capitalAcct = await getSystemAccountId(orgId, "partners_capital");
  const memo = `New investment — ${buyerName} (${Number(transfer.pct_transferred)}%)`;
  return await postJournalEntry({
    orgId, entryDate: transfer.effective_date, memo, sourceType: "share_transfer", sourceId: transfer.id, createdBy,
    lines: [
      { accountId: bankAcct, debit: amountBase, credit: 0, description: memo },
      { accountId: capitalAcct, debit: 0, credit: amountBase, description: memo },
    ],
  });
}
