const PrintDoc = (() => {
  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  // Turns the document's advance_type/advance_value into a plain-English payment-terms
  // sentence, in the same style vendors commonly use on their own quotes/invoices
  // ("50% Advance & 50% After delivery", "100% Advance along with LPO", etc.). Returns
  // null when no advance was requested, so the Terms & Conditions section can fall back
  // to whatever the user typed in the Terms field (or the default thank-you line).
  function advancePaymentTermsLine(doc) {
    const amt = Number(doc.advance_amount || 0);
    if (!doc.advance_type || amt <= 0) return null;
    const total = Number(doc.total);
    const remaining = Math.max(round2(total - amt), 0);
    if (doc.advance_type === "percent") {
      const pct = Number(doc.advance_value);
      if (pct >= 99.995) return `100% advance payment (${Util.money(amt, doc.currency_code)}) required before work/delivery commences.`;
      const remainingPct = round2(100 - pct);
      return `${pct}% advance payment (${Util.money(amt, doc.currency_code)}) required to proceed; remaining ${remainingPct}% (${Util.money(remaining, doc.currency_code)}) due on completion/delivery.`;
    }
    return `Advance payment of ${Util.money(amt, doc.currency_code)} required to proceed; remaining balance of ${Util.money(remaining, doc.currency_code)} due on completion/delivery.`;
  }

  // Builds the printed "Terms & Conditions" block: an auto-generated Payment Terms line
  // (from the advance request, when one's set) plus whatever the user typed in the Terms
  // field, each as its own bullet — matching the structured Terms & Conditions sections
  // common on vendor quotes, rather than one plain paragraph. Falls back to the original
  // single thank-you line when there's neither an advance nor custom terms text.
  function buildTermsBlock(doc) {
    const paymentLine = advancePaymentTermsLine(doc);
    const customLines = (doc.terms || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!paymentLine && !customLines.length) {
      return `<div class="doc-foot">Thank you for your business.</div>`;
    }
    const items = [];
    if (paymentLine) items.push(`<strong>Payment Terms:</strong> ${Util.escapeHtml(paymentLine)}`);
    customLines.forEach((l) => items.push(Util.escapeHtml(l)));
    return `<div class="doc-foot">
      <div style="font-weight:700; font-size:12.5px; margin-bottom:6px; color:#1c1c1e;">Terms &amp; Conditions</div>
      <ul style="margin:0 0 8px; padding-left:18px;">
        ${items.map((i) => `<li style="margin-bottom:3px;">${i}</li>`).join("")}
      </ul>
      Thank you for your business.
    </div>`;
  }

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
        <td class="num">${Util.escapeHtml(l.unit || "")}</td>
        <td class="num">${Util.money(l.unit_price)}</td>
        <td class="num">${Number(l.discount_pct || 0)}%</td>
        <td class="num">${Number(l.vat_rate || 0)}%</td>
        <td class="num">${Util.money(base + vat)}</td>
      </tr>`;
    }).join("");

    const words = Util.amountInWords(Number(doc.total), doc.currency_code, "Fils");

    let statusBlock = "";
    let paymentSummaryBlock = "";
    let paymentHistoryBlock = "";
    if (isInvoice) {
      const balance = Number(doc.total) - Number(doc.amount_paid || 0);
      const advanceAmt = Number(doc.advance_amount || 0);
      // Status isn't shown on the printed document itself — it's an internal tracking
      // field (issued/paid/etc), not something that belongs on a document handed to the
      // client. The money details (advance/paid/balance) go below the Total.
      paymentSummaryBlock = `<div class="doc-totals" style="margin-top:6px;">
        ${advanceAmt > 0 ? `<div class="row"><span>Advance requested${doc.advance_type === "percent" ? ` (${Number(doc.advance_value)}%)` : ""}</span><span>${Util.money(advanceAmt, doc.currency_code)}</span></div>` : ""}
        ${Number(doc.amount_paid) > 0 ? `<div class="row"><span>Paid</span><span>${Util.money(doc.amount_paid, doc.currency_code)}</span></div>` : ""}
        <div class="row"><span>Balance due</span><span><strong>${Util.money(balance, doc.currency_code)}</strong></span></div>
      </div>`;
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
    } else if (isQuote) {
      // Quotes don't track payments — just state the advance requirement, below the Total,
      // the same place it shows on an invoice.
      const advanceAmt = Number(doc.advance_amount || 0);
      if (advanceAmt > 0) {
        const remaining = Math.max(Number(doc.total) - advanceAmt, 0);
        paymentSummaryBlock = `<div class="doc-totals" style="margin-top:6px;">
          <div class="row"><span>Advance payment required${doc.advance_type === "percent" ? ` (${Number(doc.advance_value)}%)` : ""}</span><span>${Util.money(advanceAmt, doc.currency_code)}</span></div>
          <div class="row"><span>Balance on completion</span><span>${Util.money(remaining, doc.currency_code)}</span></div>
        </div>`;
      }
    }

    return `
      <div class="doc-page">
        <div class="doc-logo-center"><img src="${logo}" alt="logo"></div>
        <div class="doc-head">
          <div class="co">
            <div>
              <div class="co-name">${Util.escapeHtml(org?.name || "Callisto Nexus Technical Services L.L.C.")}</div>
              ${org?.email ? `<div class="co-sub">Email: ${Util.escapeHtml(org.email)}</div>` : ""}
              ${org?.phone ? `<div class="co-sub">Phone: ${Util.escapeHtml(org.phone)}</div>` : ""}
              ${(org?.address || org?.trn) ? `<div class="co-sub">Address: ${Util.escapeHtml(org?.address || "")}${org?.trn ? ` · TRN ${Util.escapeHtml(org.trn)}` : ""}</div>` : ""}
              ${org?.website ? `<div class="co-sub">Website: ${Util.escapeHtml(org.website)}</div>` : ""}
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
        <div class="doc-to">
          <div class="doc-to-label">${isCreditNote ? "Credit To" : isQuote ? "To" : "Bill To"}</div>
          <div class="doc-to-name">${Util.escapeHtml(doc.client_company_name || clientLabel)}</div>
          ${doc.client_company_name && clientLabel && clientLabel !== doc.client_company_name ? `<div>Attn: ${Util.escapeHtml(clientLabel)}</div>` : ""}
          ${doc.client_address ? `<div>${Util.escapeHtml(doc.client_address).replace(/\n/g, "<br>")}</div>` : ""}
          ${doc.client_trn ? `<div>TRN: ${Util.escapeHtml(doc.client_trn)}</div>` : ""}
          ${doc.client_phone ? `<div>Phone: ${Util.escapeHtml(doc.client_phone)}</div>` : ""}
          ${doc.client_tel ? `<div>Tel: ${Util.escapeHtml(doc.client_tel)}</div>` : ""}
          ${doc.client_email ? `<div>Email: ${Util.escapeHtml(doc.client_email)}</div>` : ""}
        </div>
        ${isCreditNote && doc.invoice_number ? `<div class="doc-meta">Against invoice: ${Util.escapeHtml(doc.invoice_number)}</div>` : ""}
        ${isCreditNote && doc.reason ? `<div class="doc-meta">Reason: ${Util.escapeHtml(doc.reason)}</div>` : ""}
        <table class="doc-table">
          <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Unit price</th><th class="num">Disc.</th><th class="num">VAT</th><th class="num">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="doc-totals">
          <div class="row"><span>Subtotal</span><span>${Util.money(doc.subtotal, doc.currency_code)}</span></div>
          <div class="row"><span>VAT</span><span>${Util.money(doc.vat_total, doc.currency_code)}</span></div>
          <div class="row grand"><span>Total</span><span>${Util.money(doc.total, doc.currency_code)}</span></div>
        </div>
        ${paymentSummaryBlock}
        <div class="doc-amount-words">Amount in words: ${Util.escapeHtml(words)} — Total: ${Util.money(doc.total, doc.currency_code)}</div>
        ${paymentHistoryBlock}
        ${doc.notes ? `<div class="doc-meta">${Util.escapeHtml(doc.notes)}</div>` : ""}
        ${!isCreditNote ? buildTermsBlock(doc) : ""}
        ${isQuote && doc.show_signoff !== false ? buildSignoffBlock(org) : ""}
      </div>
    `;
  }

  // Authorisation and client acceptance block — a signature area for the quotation to be
  // physically (or digitally, once printed/signed/scanned back) signed off by both sides.
  // Quotes only, matching the original spec's "customer acceptance/signature area" request
  // for the Quotation PDF specifically — invoices/credit notes don't carry this block.
  function buildSignoffBlock(org) {
    const companyName = Util.escapeHtml(org?.name || "Callisto Nexus Technical Services L.L.C.");
    return `
      <div class="doc-signoff">
        <h3>Authorisation and client acceptance</h3>
        <div class="signoff-table">
          <div class="signoff-row signoff-row-head">
            <div>For ${companyName}</div>
            <div>Accepted for the client</div>
          </div>
          <div class="signoff-row">
            <div>Name / Title:</div>
            <div>Name / Title:</div>
          </div>
          <div class="signoff-row">
            <div>Signature:</div>
            <div>Signature:</div>
          </div>
          <div class="signoff-row">
            <div>Date:</div>
            <div>Date:</div>
          </div>
          <div class="signoff-row">
            <div>Company stamp:</div>
            <div>Company stamp:</div>
          </div>
        </div>
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
