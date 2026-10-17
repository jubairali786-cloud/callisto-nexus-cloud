const PrintDoc = (() => {
  // type: 'quote' | 'invoice' | 'credit_note'
  function buildMarkup({ type, doc, lines, payments, org, clientLabel }) {
    const isQuote = type === "quote", isInvoice = type === "invoice", isCreditNote = type === "credit_note";
    const title = isQuote ? "QUOTATION" : isInvoice ? "TAX INVOICE" : "CREDIT NOTE";
    const number = doc.number;
    const dateField = isQuote ? doc.quote_date : isInvoice ? doc.invoice_date : doc.cn_date;
    const logo = (org && org.logo_b64) ? `data:image/png;base64,${org.logo_b64}` : `data:image/png;base64,${window.LOGO_B64}`;

    const rows = lines.map((l) => {
      const base = Number(l.qty) * Number(l.unit_price) * (1 - Number(l.discount_pct || 0) / 100);
      const vat = base * (Number(l.vat_rate || 0) / 100);
      return `<tr>
        <td>${Util.escapeHtml(l.description)}</td>
        <td class="num">${Number(l.qty)}</td>
        <td class="num">${Util.money(l.unit_price)}</td>
        <td class="num">${Number(l.discount_pct || 0)}%</td>
        <td class="num">${Number(l.vat_rate || 0)}%</td>
        <td class="num">${Util.money(base + vat)}</td>
      </tr>`;
    }).join("");

    const words = Util.amountInWords(Number(doc.total), doc.currency_code, "Fils");

    let statusBlock = "";
    let paymentHistoryBlock = "";
    if (isInvoice) {
      const balance = Number(doc.total) - Number(doc.amount_paid || 0);
      const advanceAmt = Number(doc.advance_amount || 0);
      statusBlock = `<div class="doc-meta">Status: <strong>${Util.escapeHtml((doc.status || "").toUpperCase())}</strong>
        ${advanceAmt > 0 ? ` · Advance requested: ${Util.money(advanceAmt, doc.currency_code)}${doc.advance_type === "percent" ? ` (${Number(doc.advance_value)}%)` : ""}` : ""}
        ${Number(doc.amount_paid) > 0 ? ` · Paid: ${Util.money(doc.amount_paid, doc.currency_code)} · Balance due: ${Util.money(balance, doc.currency_code)}` : ""}</div>`;
      if (payments && payments.length) {
        paymentHistoryBlock = `
          <div class="doc-meta" style="margin-top:10px;"><strong>Payment history</strong></div>
          <table class="doc-table">
            <thead><tr><th>Date</th><th class="num">Amount</th><th>Method</th><th>Reference</th></tr></thead>
            <tbody>${payments.map((p) => `<tr>
              <td>${Util.dateStr(p.payment_date)}</td>
              <td class="num">${Util.money(p.amount, p.currency_code)}</td>
              <td>${Util.escapeHtml((p.method || "").replace(/_/g, " "))}</td>
              <td>${Util.escapeHtml(p.reference || "—")}</td>
            </tr>`).join("")}</tbody>
          </table>`;
      }
    }

    return `
      <div class="doc-page">
        <div class="doc-head">
          <div class="co">
            <img src="${logo}" alt="logo">
            <div>
              <div class="co-name">${Util.escapeHtml(org?.name || "Callisto Nexus Technical Services L.L.C.")}</div>
              <div class="co-sub">${Util.escapeHtml(org?.address || "")}${org?.trn ? ` · TRN ${Util.escapeHtml(org.trn)}` : ""}</div>
            </div>
          </div>
          <div class="doc-title">
            <h2>${title}</h2>
            <div class="doc-meta"># ${Util.escapeHtml(number)}</div>
            <div class="doc-meta">Date: ${Util.dateStr(dateField)}</div>
            ${isInvoice && doc.due_date ? `<div class="doc-meta">Due: ${Util.dateStr(doc.due_date)}</div>` : ""}
            ${isQuote && doc.expiry_date ? `<div class="doc-meta">Valid until: ${Util.dateStr(doc.expiry_date)}</div>` : ""}
            ${statusBlock}
          </div>
        </div>
        <div class="doc-meta"><strong>${isCreditNote ? "Credit To" : isQuote ? "Quote For" : "Bill To"}:</strong> ${Util.escapeHtml(clientLabel)}</div>
        ${isCreditNote && doc.invoice_number ? `<div class="doc-meta">Against invoice: ${Util.escapeHtml(doc.invoice_number)}</div>` : ""}
        ${isCreditNote && doc.reason ? `<div class="doc-meta">Reason: ${Util.escapeHtml(doc.reason)}</div>` : ""}
        <table class="doc-table">
          <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Disc.</th><th class="num">VAT</th><th class="num">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="doc-totals">
          <div class="row"><span>Subtotal</span><span>${Util.money(doc.subtotal, doc.currency_code)}</span></div>
          <div class="row"><span>VAT</span><span>${Util.money(doc.vat_total, doc.currency_code)}</span></div>
          <div class="row grand"><span>Total</span><span>${Util.money(doc.total, doc.currency_code)}</span></div>
        </div>
        <div class="doc-amount-words">Amount in words: ${Util.escapeHtml(words)} — Total: ${Util.money(doc.total, doc.currency_code)}</div>
        ${paymentHistoryBlock}
        ${doc.notes ? `<div class="doc-meta">${Util.escapeHtml(doc.notes)}</div>` : ""}
        ${!isCreditNote ? `<div class="doc-foot">${Util.escapeHtml(doc.terms || "Thank you for your business.")}</div>` : ""}
      </div>
    `;
  }

  function openPrintWindow(innerHtml) {
    const w = window.open("", "_blank");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Print</title>
      <link rel="stylesheet" href="/styles.css"></head>
      <body style="background:#fff; padding:20px;">${innerHtml}
      <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
      </body></html>`);
    w.document.close();
  }

  return { buildMarkup, openPrintWindow };
})();
