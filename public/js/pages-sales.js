const SalesPages = (() => {
  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  async function loadClientsAndItems() {
    const [{ clients }, { items }] = await Promise.all([API.clients(), API.items()]);
    return { clients, items };
  }
  function clientSelect(clients, selected) {
    return selectHtml("f_clientId", clients.map((c) => ({ value: c.id, label: c.name })), selected, "Select a client…");
  }

  // Shared "Advance / partial payment requested" block used on both the Quote and
  // Invoice forms. On a quote it's just a stated requirement (e.g. "50% deposit to
  // proceed"); on an invoice the same amount also drives the Record Payment default.
  // It's always optional and purely informational at the document level — it never
  // moves a balance on its own.
  function advanceFieldsHtml(existing) {
    return `
      <div class="field">
        <label>Advance / partial payment requested <span style="font-weight:400;">(optional — just a stated request shown on the document; it doesn't affect any balance by itself)</span></label>
        <div class="grid-3">
          <div class="field"><label>Type</label>
            <select id="f_advanceType">
              <option value="" ${!existing?.advance_type ? "selected" : ""}>None</option>
              <option value="percent" ${existing?.advance_type === "percent" ? "selected" : ""}>Percentage of total</option>
              <option value="fixed" ${existing?.advance_type === "fixed" ? "selected" : ""}>Fixed amount</option>
            </select>
          </div>
          <div class="field"><label id="f_advanceValueLabel">Value</label>
            <input id="f_advanceValue" type="number" step="0.01" min="0" value="${existing?.advance_value != null ? existing.advance_value : ""}">
          </div>
          <div class="field"><label>Preview</label><div id="advancePreview" style="padding-top:8px;">—</div></div>
        </div>
      </div>
    `;
  }
  // Wires the block above to a LineItemsEditor instance so the preview recalculates as
  // lines or the advance fields change, and returns a reader for the save handler.
  function wireAdvanceFields(editor) {
    const advanceTypeEl = document.getElementById("f_advanceType");
    const advanceValueEl = document.getElementById("f_advanceValue");
    const advancePreviewEl = document.getElementById("advancePreview");
    const advanceValueLabelEl = document.getElementById("f_advanceValueLabel");
    function update() {
      const type = advanceTypeEl.value;
      advanceValueLabelEl.textContent = type === "percent" ? "Percentage (%)" : type === "fixed" ? "Fixed amount" : "Value";
      advanceValueEl.placeholder = type === "percent" ? "e.g. 30" : type === "fixed" ? "e.g. 1575.00" : "";
      advanceValueEl.disabled = !type;
      if (!type) { advancePreviewEl.textContent = "—"; return; }
      const total = editor.getTotals().total;
      const val = Number(advanceValueEl.value) || 0;
      let advance = type === "percent" ? (total * val) / 100 : val;
      advance = Math.min(Math.max(advance, 0), total);
      const remaining = Math.max(round2(total - advance), 0);
      advancePreviewEl.innerHTML = `Advance: <strong>${Util.money(advance)}</strong> &nbsp;·&nbsp; Remaining: <strong>${Util.money(remaining)}</strong>`;
    }
    advanceTypeEl.onchange = update;
    advanceValueEl.oninput = update;
    // The line-items editor replaces its own inner HTML on every add/remove/edit, but the
    // #lineEditor container node itself never gets replaced — so a delegated listener on it
    // keeps catching input/click events from freshly-rendered rows without the editor
    // needing to expose a change callback of its own.
    document.getElementById("lineEditor").addEventListener("input", update);
    document.getElementById("lineEditor").addEventListener("click", () => setTimeout(update, 0));
    update();
    return {
      getAdvance: () => {
        const advanceType = advanceTypeEl.value || null;
        const advanceValue = advanceType ? Number(advanceValueEl.value) || 0 : null;
        return { advanceType, advanceValue };
      },
    };
  }

  // ===================== QUOTES =====================
  async function renderQuoteList(root) {
    root.innerHTML = `<div class="content">${pageHeader("Quotes", `<a class="btn btn-primary" href="#/quotes/new">+ New Quote</a>`)}<div class="card" id="listCard">Loading…</div></div>`;
    async function load() {
      const { quotes } = await API.quotes();
      document.getElementById("listCard").innerHTML = quotes.length ? `
        <table class="clickable"><thead><tr><th>Number</th><th>Client</th><th>Date</th><th class="num">Total</th><th>Status</th><th class="col-del"></th></tr></thead>
        <tbody>${quotes.map((q) => `
          <tr data-nav="#/quotes/${q.id}">
            <td>${Util.escapeHtml(q.number)}</td><td>${Util.escapeHtml(q.client_name)}</td><td>${Util.dateStr(q.quote_date)}</td>
            <td class="num">${Util.money(q.total, q.currency_code)}</td><td>${pill(q.status)}</td>
            <td class="col-del"><button type="button" class="row-delete" data-del="${q.id}" title="Delete">&times;</button></td>
          </tr>`).join("")}</tbody></table>
      ` : emptyState("No quotes yet.");
      wireRowNav(document.getElementById("listCard"));
      document.getElementById("listCard").querySelectorAll("[data-del]").forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm("Delete this quote? This cannot be undone.")) return;
          try { await API.deleteQuote(btn.dataset.del); Toast.show("Quote deleted."); load(); } catch (err) { toastError(err); }
        };
      });
    }
    await load();
  }

  async function renderQuoteForm(root, id) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const { clients, items } = await loadClientsAndItems();
    const me = await API.me();
    let existing = null, lines = [];
    if (id) { const d = await API.quote(id); existing = d.quote; lines = d.lines.map(toEditorLine); }
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/quotes">&larr; Back to Quotes</a>
      ${pageHeader(existing ? `Edit ${existing.number}` : "New Quote")}
      <div class="card">
        <div class="grid-3">
          <div class="field"><label>Client *</label>${clientSelect(clients, existing?.client_id)}</div>
          <div class="field"><label>Quote date</label><input type="date" id="f_quoteDate" value="${(existing?.quote_date || Util.todayISO()).slice(0, 10)}"></div>
          <div class="field"><label>Expiry date</label><input type="date" id="f_expiryDate" value="${existing?.expiry_date ? existing.expiry_date.slice(0, 10) : ""}"></div>
        </div>
        <div class="grid-3">${currencyFieldsHtml(me.org?.base_currency, existing?.currency_code, existing?.fx_rate)}</div>
        <div class="field"><label>Lines</label><div id="lineEditor"></div></div>
        ${advanceFieldsHtml(existing)}
        <div class="field"><label>Notes</label><textarea id="f_notes" rows="2">${Util.escapeHtml(existing?.notes || "")}</textarea></div>
        <div class="field"><label>Terms</label><textarea id="f_terms" rows="2">${Util.escapeHtml(existing?.terms || "")}</textarea></div>
        <div class="btn-row"><button class="btn btn-primary" id="saveBtn">Save Quote</button></div>
      </div>
    </div>`;
    const editor = LineItemsEditor(document.getElementById("lineEditor"), { lines, items, includeDiscount: true });
    const advance = wireAdvanceFields(editor);
    document.getElementById("saveBtn").onclick = async () => {
      const clientId = document.getElementById("f_clientId").value;
      if (!clientId) return toastError(new Error("Please select a client."));
      const body = {
        clientId, quoteDate: document.getElementById("f_quoteDate").value, expiryDate: document.getElementById("f_expiryDate").value || null,
        notes: document.getElementById("f_notes").value.trim(), terms: document.getElementById("f_terms").value.trim(), lines: editor.getLines(),
        ...advance.getAdvance(),
        ...readCurrencyFields(),
      };
      try {
        const saved = existing ? await API.updateQuote(existing.id, body) : await API.createQuote(body);
        Toast.show("Quote saved.");
        location.hash = `#/quotes/${saved.quote.id}`;
      } catch (err) { toastError(err); }
    };
  }

  async function renderQuoteDetail(root, id) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const { quote, lines } = await API.quote(id);
    const advanceAmt = Number(quote.advance_amount || 0);
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/quotes">&larr; Back to Quotes</a>
      ${pageHeader(quote.number, actionsForQuote(quote))}
      ${docSummaryCard(quote, lines, quote.client_name)}
      ${quote.advance_type ? `<div class="card">
        <h2>Advance payment required</h2>
        <div class="grid-3">
          <div><label>Required to proceed</label><div><strong>${Util.money(advanceAmt, quote.currency_code)}</strong>
            ${quote.advance_type === "percent" ? ` (${Number(quote.advance_value)}% of total)` : " (fixed amount)"}</div></div>
          <div><label>Balance on completion</label><div>${Util.money(Math.max(round2(Number(quote.total) - advanceAmt), 0), quote.currency_code)}</div></div>
        </div>
        <p style="margin-top:8px; color:#666;">This carries over automatically if this quote is converted to an invoice.</p>
      </div>` : ""}
    </div>`;
    wireQuoteActions(root, quote, id);
  }

  function actionsForQuote(q) {
    let html = `<button class="btn" id="printBtn">Print / PDF</button>`;
    if (q.status === "draft") html += ` <a class="btn" href="#/quotes/${q.id}/edit">Edit</a>`;
    if (["draft", "sent"].includes(q.status)) html += ` <button class="btn btn-primary" id="acceptBtn">Mark Accepted</button>`;
    if (q.status === "accepted") html += ` <button class="btn btn-primary" id="convertBtn">Convert to Invoice</button>`;
    return html;
  }
  function wireQuoteActions(root, quote, id) {
    const printBtn = root.querySelector("#printBtn");
    if (printBtn) printBtn.onclick = () => printDocument("quote", quote, quote.client_name);
    const acceptBtn = root.querySelector("#acceptBtn");
    if (acceptBtn) acceptBtn.onclick = async () => { try { await API.quoteStatus(id, "accepted"); Toast.show("Quote marked accepted."); renderQuoteDetail(root, id); } catch (err) { toastError(err); } };
    const convertBtn = root.querySelector("#convertBtn");
    if (convertBtn) convertBtn.onclick = async () => {
      try { const { invoice } = await API.convertQuote(id); Toast.show("Converted to invoice " + invoice.number); location.hash = `#/invoices/${invoice.id}`; } catch (err) { toastError(err); }
    };
  }

  // ===================== INVOICES =====================
  async function renderInvoiceList(root) {
    root.innerHTML = `<div class="content">${pageHeader("Invoices", `<a class="btn btn-primary" href="#/invoices/new">+ New Invoice</a>`)}<div class="card" id="listCard">Loading…</div></div>`;
    async function load() {
      const { invoices } = await API.invoices();
      document.getElementById("listCard").innerHTML = invoices.length ? `
        <table class="clickable"><thead><tr><th>Number</th><th>Client</th><th>Date</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th><th class="col-del"></th></tr></thead>
        <tbody>${invoices.map((i) => `
          <tr data-nav="#/invoices/${i.id}">
            <td>${Util.escapeHtml(i.number)}</td><td>${Util.escapeHtml(i.client_name)}</td><td>${Util.dateStr(i.invoice_date)}</td>
            <td class="num">${Util.money(i.total, i.currency_code)}</td><td class="num">${Util.money(i.balance, i.currency_code)}</td><td>${pill(i.status)}</td>
            <td class="col-del"><button type="button" class="row-delete" data-del="${i.id}" title="Delete">&times;</button></td>
          </tr>`).join("")}</tbody></table>
      ` : emptyState("No invoices yet.");
      wireRowNav(document.getElementById("listCard"));
      document.getElementById("listCard").querySelectorAll("[data-del]").forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm("Delete this draft invoice? This cannot be undone.")) return;
          try { await API.deleteInvoice(btn.dataset.del); Toast.show("Invoice deleted."); load(); } catch (err) { toastError(err); }
        };
      });
    }
    await load();
  }

  async function renderInvoiceForm(root, id, opts) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const { clients, items } = await loadClientsAndItems();
    const me = await API.me();
    let existing = null, lines = [];
    if (id) { const d = await API.invoice(id); existing = d.invoice; lines = d.lines.map(toEditorLine); }
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/invoices">&larr; Back to Invoices</a>
      ${pageHeader(existing ? `Edit ${existing.number}` : "New Invoice")}
      <div class="card">
        <div class="grid-3">
          <div class="field"><label>Client *</label>${clientSelect(clients, existing?.client_id)}</div>
          <div class="field"><label>Invoice date</label><input type="date" id="f_invoiceDate" value="${(existing?.invoice_date || Util.todayISO()).slice(0, 10)}"></div>
          <div class="field"><label>Due date</label><input type="date" id="f_dueDate" value="${existing?.due_date ? existing.due_date.slice(0, 10) : ""}"></div>
        </div>
        <div class="grid-3">${currencyFieldsHtml(me.org?.base_currency, existing?.currency_code, existing?.fx_rate)}</div>
        <div class="field"><label>Lines</label><div id="lineEditor"></div></div>
        ${advanceFieldsHtml(existing)}
        <div class="field"><label>Notes</label><textarea id="f_notes" rows="2">${Util.escapeHtml(existing?.notes || "")}</textarea></div>
        <div class="field"><label>Terms</label><textarea id="f_terms" rows="2">${Util.escapeHtml(existing?.terms || "Payment due within 14 days.")}</textarea></div>
        <div class="btn-row"><button class="btn btn-primary" id="saveBtn">Save Invoice</button></div>
      </div>
    </div>`;
    const editor = LineItemsEditor(document.getElementById("lineEditor"), { lines, items, includeDiscount: true });
    const advance = wireAdvanceFields(editor);

    document.getElementById("saveBtn").onclick = async () => {
      const clientId = document.getElementById("f_clientId").value;
      if (!clientId) return toastError(new Error("Please select a client."));
      const body = {
        clientId, invoiceDate: document.getElementById("f_invoiceDate").value, dueDate: document.getElementById("f_dueDate").value || null,
        notes: document.getElementById("f_notes").value.trim(), terms: document.getElementById("f_terms").value.trim(), lines: editor.getLines(),
        ...advance.getAdvance(),
        ...readCurrencyFields(),
      };
      try {
        const saved = existing ? await API.updateInvoice(existing.id, body) : await API.createInvoice(body);
        Toast.show("Invoice saved.");
        location.hash = `#/invoices/${saved.invoice.id}`;
      } catch (err) { toastError(err); }
    };
  }

  async function renderInvoiceDetail(root, id) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const { invoice, lines, payments, creditNotes } = await API.invoice(id);
    const balance = Number(invoice.total) - Number(invoice.amount_paid) - creditNotes.filter((c) => c.status === "issued").reduce((s, c) => s + Number(c.total), 0);
    const advanceAmt = Number(invoice.advance_amount || 0);
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/invoices">&larr; Back to Invoices</a>
      ${pageHeader(invoice.number, actionsForInvoice(invoice, balance))}
      ${docSummaryCard(invoice, lines, invoice.client_name, { balance })}
      ${invoice.advance_type ? `<div class="card">
        <h2>Advance payment requested</h2>
        <div class="grid-3">
          <div><label>Requested</label><div><strong>${Util.money(advanceAmt, invoice.currency_code)}</strong>
            ${invoice.advance_type === "percent" ? ` (${Number(invoice.advance_value)}% of total)` : " (fixed amount)"}</div></div>
          <div><label>Payments received</label><div>${Util.money(invoice.amount_paid, invoice.currency_code)}</div></div>
          <div><label>Outstanding balance</label><div><strong>${Util.money(balance, invoice.currency_code)}</strong></div></div>
        </div>
      </div>` : ""}
      ${payments.length ? `<div class="card"><h2>Payments</h2>
        <table><thead><tr><th>Date</th><th class="num">Amount</th><th>Method</th><th>Reference</th><th>Notes</th></tr></thead>
        <tbody>${payments.map((p) => `<tr><td>${Util.dateStr(p.payment_date)}</td><td class="num">${Util.money(p.amount, p.currency_code)}</td><td>${Util.escapeHtml(p.method)}</td><td>${Util.escapeHtml(p.reference || "—")}</td><td>${Util.escapeHtml(p.notes || "—")}</td></tr>`).join("")}</tbody></table>
      </div>` : ""}
      ${creditNotes.length ? `<div class="card"><h2>Credit Notes</h2>
        <table class="clickable"><thead><tr><th>Number</th><th>Date</th><th class="num">Total</th><th>Status</th></tr></thead>
        <tbody>${creditNotes.map((c) => `<tr data-nav="#/credit-notes/${c.id}"><td>${Util.escapeHtml(c.number)}</td><td>${Util.dateStr(c.cn_date)}</td><td class="num">${Util.money(c.total, c.currency_code)}</td><td>${pill(c.status)}</td></tr>`).join("")}</tbody></table>
      </div>` : ""}
    </div>`;
    wireRowNav(root);
    wireInvoiceActions(root, invoice, id, balance);
  }

  function actionsForInvoice(inv, balance) {
    let html = `<button class="btn" id="printBtn">Print / PDF</button>`;
    if (inv.status === "draft") html += ` <a class="btn" href="#/invoices/${inv.id}/edit">Edit</a> <button class="btn btn-primary" id="issueBtn">Issue Invoice</button>`;
    if (["issued", "partially_paid"].includes(inv.status) && balance > 0.009) html += ` <button class="btn btn-primary" id="payBtn">Record Payment</button>`;
    if (["issued", "partially_paid"].includes(inv.status)) html += ` <button class="btn" id="creditBtn">Issue Credit Note</button>`;
    if (["issued", "partially_paid"].includes(inv.status) && Number(inv.amount_paid) === 0) html += ` <button class="btn btn-danger" id="voidBtn">Void</button>`;
    return html;
  }
  function wireInvoiceActions(root, invoice, id, balance) {
    const printBtn = root.querySelector("#printBtn");
    if (printBtn) printBtn.onclick = () => printDocument("invoice", invoice, invoice.client_name);
    const issueBtn = root.querySelector("#issueBtn");
    if (issueBtn) issueBtn.onclick = async () => { try { await API.issueInvoice(id); Toast.show("Invoice issued."); renderInvoiceDetail(root, id); } catch (err) { toastError(err); } };
    const voidBtn = root.querySelector("#voidBtn");
    if (voidBtn) voidBtn.onclick = async () => {
      if (!confirm("Void this invoice? This reverses its accounting entries and restocks any items sold.")) return;
      try { await API.voidInvoice(id); Toast.show("Invoice voided."); renderInvoiceDetail(root, id); } catch (err) { toastError(err); }
    };
    const payBtn = root.querySelector("#payBtn");
    if (payBtn) payBtn.onclick = () => openPaymentModal(invoice, balance, () => renderInvoiceDetail(root, id));
    const creditBtn = root.querySelector("#creditBtn");
    if (creditBtn) creditBtn.onclick = () => { location.hash = `#/credit-notes/new?invoiceId=${id}`; };
  }

  function openPaymentModal(invoice, balance, onSaved) {
    const advanceAmt = Number(invoice.advance_amount || 0);
    const alreadyPaid = Number(invoice.amount_paid || 0);
    // If an advance was requested and it hasn't been fully paid yet, default the amount
    // to whatever's left of that advance; otherwise default to the full remaining balance.
    const suggestedAmount = (advanceAmt > 0 && alreadyPaid < advanceAmt)
      ? round2(Math.min(advanceAmt - alreadyPaid, balance))
      : round2(balance);
    Modal.open(`
      <h3>Record payment — ${Util.escapeHtml(invoice.number)}</h3>
      <div class="field"><label>Balance due</label><div>${Util.money(balance, invoice.currency_code)}</div></div>
      ${advanceAmt > 0 ? `<div class="field"><label>Advance requested</label><div>${Util.money(advanceAmt, invoice.currency_code)}</div></div>` : ""}
      <form id="payForm">
        <div class="field"><label>Amount *</label><input id="f_amount" type="number" step="0.01" value="${suggestedAmount}" required></div>
        <div class="field"><label>Date</label><input id="f_date" type="date" value="${Util.todayISO()}"></div>
        <div class="field"><label>Method</label>
          <select id="f_method"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="cheque">Cheque</option></select>
        </div>
        <div class="field"><label>Reference</label><input id="f_reference"></div>
        <div class="field"><label>Notes</label><textarea id="f_notes" rows="2" placeholder="e.g. 30% advance payment"></textarea></div>
        <div class="btn-row"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
      </form>
    `, {
      onMount: (modal) => {
        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#payForm").onsubmit = async (e) => {
          e.preventDefault();
          try {
            await API.recordPayment(invoice.id, {
              amount: Number(modal.querySelector("#f_amount").value), paymentDate: modal.querySelector("#f_date").value,
              method: modal.querySelector("#f_method").value, reference: modal.querySelector("#f_reference").value.trim(),
              notes: modal.querySelector("#f_notes").value.trim(),
            });
            Toast.show("Payment recorded."); Modal.close(); onSaved && onSaved();
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  // ===================== CREDIT NOTES =====================
  async function renderCreditNoteList(root) {
    root.innerHTML = `<div class="content">${pageHeader("Credit Notes", `<a class="btn btn-primary" href="#/credit-notes/new">+ New Credit Note</a>`)}<div class="card" id="listCard">Loading…</div></div>`;
    async function load() {
      const { creditNotes } = await API.creditNotes();
      document.getElementById("listCard").innerHTML = creditNotes.length ? `
        <table class="clickable"><thead><tr><th>Number</th><th>Client</th><th>Against</th><th>Date</th><th class="num">Total</th><th>Status</th><th class="col-del"></th></tr></thead>
        <tbody>${creditNotes.map((c) => `
          <tr data-nav="#/credit-notes/${c.id}">
            <td>${Util.escapeHtml(c.number)}</td><td>${Util.escapeHtml(c.client_name)}</td><td>${Util.escapeHtml(c.invoice_number || "—")}</td><td>${Util.dateStr(c.cn_date)}</td>
            <td class="num">${Util.money(c.total, c.currency_code)}</td><td>${pill(c.status)}</td>
            <td class="col-del"><button type="button" class="row-delete" data-del="${c.id}" title="Delete">&times;</button></td>
          </tr>`).join("")}</tbody></table>
      ` : emptyState("No credit notes yet.");
      wireRowNav(document.getElementById("listCard"));
      document.getElementById("listCard").querySelectorAll("[data-del]").forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm("Delete this draft credit note?")) return;
          try { await API.deleteCreditNote(btn.dataset.del); Toast.show("Credit note deleted."); load(); } catch (err) { toastError(err); }
        };
      });
    }
    await load();
  }

  async function renderCreditNoteForm(root, params) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const { clients, items } = await loadClientsAndItems();
    let invoice = null, prefillLines = [];
    if (params.invoiceId) {
      const d = await API.invoice(params.invoiceId);
      invoice = d.invoice;
      prefillLines = d.lines.map(toEditorLine);
    }
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/credit-notes">&larr; Back to Credit Notes</a>
      ${pageHeader("New Credit Note")}
      <div class="card">
        <div class="grid-3">
          <div class="field"><label>Client *</label>${clientSelect(clients, invoice?.client_id)}</div>
          <div class="field"><label>Date</label><input type="date" id="f_cnDate" value="${Util.todayISO()}"></div>
          <div class="field"><label>Against invoice</label><input id="f_invoiceNumber" value="${invoice ? Util.escapeHtml(invoice.number) : ""}" disabled placeholder="(standalone)"></div>
        </div>
        <div class="field"><label><input type="checkbox" id="f_restock" checked style="width:auto; display:inline-block;"> Restock these items back into inventory</label></div>
        <div class="field"><label>Reason</label><input id="f_reason" placeholder="e.g. goods returned, pricing correction"></div>
        <div class="field"><label>Lines</label><div id="lineEditor"></div></div>
        <div class="btn-row"><button class="btn btn-primary" id="saveBtn">Save Credit Note</button></div>
      </div>
    </div>`;
    const editor = LineItemsEditor(document.getElementById("lineEditor"), { lines: prefillLines, items, includeDiscount: true });
    document.getElementById("saveBtn").onclick = async () => {
      const clientId = document.getElementById("f_clientId").value;
      if (!clientId) return toastError(new Error("Please select a client."));
      const body = {
        clientId, invoiceId: params.invoiceId || null, cnDate: document.getElementById("f_cnDate").value,
        restock: document.getElementById("f_restock").checked, reason: document.getElementById("f_reason").value.trim(), lines: editor.getLines(),
      };
      try {
        const saved = await API.createCreditNote(body);
        Toast.show("Credit note saved as draft.");
        location.hash = `#/credit-notes/${saved.creditNote.id}`;
      } catch (err) { toastError(err); }
    };
  }

  async function renderCreditNoteDetail(root, id) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const { creditNote, lines } = await API.creditNote(id);
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/credit-notes">&larr; Back to Credit Notes</a>
      ${pageHeader(creditNote.number, actionsForCreditNote(creditNote))}
      ${docSummaryCard(creditNote, lines, creditNote.client_name)}
    </div>`;
    const printBtn = root.querySelector("#printBtn");
    if (printBtn) printBtn.onclick = () => printDocument("credit_note", creditNote, creditNote.client_name);
    const issueBtn = root.querySelector("#issueBtn");
    if (issueBtn) issueBtn.onclick = async () => { try { await API.issueCreditNote(id); Toast.show("Credit note issued."); renderCreditNoteDetail(root, id); } catch (err) { toastError(err); } };
  }
  function actionsForCreditNote(cn) {
    let html = `<button class="btn" id="printBtn">Print / PDF</button>`;
    if (cn.status === "draft") html += ` <button class="btn btn-primary" id="issueBtn">Issue</button>`;
    return html;
  }

  // ---- shared helpers ----
  function toEditorLine(l) {
    return { itemId: l.item_id || "", description: l.description, qty: l.qty, unitPrice: l.unit_price, discountPct: l.discount_pct, vatRate: l.vat_rate };
  }
  function docSummaryCard(doc, lines, clientLabel, extra) {
    return `<div class="card">
      <div class="grid-3">
        <div><label>${doc.hasOwnProperty("cn_date") ? "Credit To" : "Bill To"}</label><div>${Util.escapeHtml(clientLabel)}</div></div>
        <div><label>Currency</label><div>${doc.currency_code} (fx ${doc.fx_rate})</div></div>
        ${extra?.balance != null ? `<div><label>Balance due</label><div><strong>${Util.money(extra.balance, doc.currency_code)}</strong></div></div>` : ""}
      </div>
      <table style="margin-top:14px;"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Disc.</th><th class="num">VAT</th><th class="num">Amount</th></tr></thead>
      <tbody>${lines.map((l) => {
        const base = Number(l.qty) * Number(l.unit_price) * (1 - Number(l.discount_pct || 0) / 100);
        const amt = base + base * (Number(l.vat_rate || 0) / 100);
        return `<tr><td>${Util.escapeHtml(l.description)}</td><td class="num">${l.qty}</td><td class="num">${Util.money(l.unit_price)}</td><td class="num">${l.discount_pct || 0}%</td><td class="num">${l.vat_rate}%</td><td class="num">${Util.money(amt)}</td></tr>`;
      }).join("")}</tbody></table>
      <div class="totals-box">
        <div class="row"><span>Subtotal</span><span>${Util.money(doc.subtotal, doc.currency_code)}</span></div>
        <div class="row"><span>VAT</span><span>${Util.money(doc.vat_total, doc.currency_code)}</span></div>
        <div class="row total"><span>Total</span><span>${Util.money(doc.total, doc.currency_code)}</span></div>
      </div>
      ${doc.notes ? `<div style="margin-top:10px;"><label>Notes</label><div>${Util.escapeHtml(doc.notes)}</div></div>` : ""}
    </div>`;
  }
  async function printDocument(type, doc, clientLabel) {
    try {
      const me = await API.me();
      let lines, payments;
      if (type === "quote") { lines = (await API.quote(doc.id)).lines; }
      else if (type === "invoice") { const d = await API.invoice(doc.id); lines = d.lines; payments = d.payments; doc = d.invoice; }
      else { lines = (await API.creditNote(doc.id)).lines; }
      const html = PrintDoc.buildMarkup({ type, doc, lines, payments, org: me.org, clientLabel });
      PrintDoc.openPrintWindow(html);
    } catch (err) { toastError(err); }
  }

  return {
    renderQuoteList, renderQuoteForm, renderQuoteDetail,
    renderInvoiceList, renderInvoiceForm, renderInvoiceDetail,
    renderCreditNoteList, renderCreditNoteForm, renderCreditNoteDetail,
  };
})();
