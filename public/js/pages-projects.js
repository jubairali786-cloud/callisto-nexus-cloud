const ProjectPages = (() => {
  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  const KIND_LABELS = { lpo: "Customer LPO", signed_quotation: "Signed quotation", contract: "Contract", completion: "Completion document", other: "Document" };
  const STATUS_LABELS = { quotation_sent: "Quotation Sent", awaiting_lpo: "Awaiting LPO", approved: "Approved", in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled" };
  const QUOTE_STATUS_LABELS = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Rejected", converted: "Converted" };
  const INVOICE_KIND_LABELS = { standard: "Standard", advance: "Advance", progress: "Progress", final: "Final" };
  const PREFILL_KEY = "callistoPrefillProjectId";

  function clientSelect(clients, selected) {
    return selectHtml("f_clientId", clients.map((c) => ({ value: c.id, label: c.name })), selected, "Select a client…");
  }
  function statusSelect(id, selected) {
    return `<select id="${id}">${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${v === selected ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  }
  function quotePill(status) { return `<span class="pill pill-${status}">${Util.escapeHtml(QUOTE_STATUS_LABELS[status] || status)}</span>`; }

  // ===================== LIST =====================
  async function renderList(root) {
    root.innerHTML = `<div class="content">${pageHeader("Projects")}
      <div class="field" style="max-width:360px;"><input id="projectFilter" placeholder="Filter by number, name, or client…"></div>
      <div class="card" id="listCard">Loading…</div></div>`;
    const { projects } = await API.projects();
    function draw(filtered) {
      document.getElementById("listCard").innerHTML = filtered.length ? `
        <table class="clickable"><thead><tr>
          <th>Project #</th><th>Name</th><th>Client</th><th>Status</th>
          <th class="num">Approved Value</th><th class="num">Invoiced</th><th class="num">Remaining</th>
        </tr></thead>
        <tbody>${filtered.map((p) => `
          <tr data-nav="#/projects/${p.id}">
            <td>${Util.escapeHtml(p.project_number)}</td><td>${Util.escapeHtml(p.name)}</td><td>${Util.escapeHtml(p.client_name)}</td>
            <td>${pill(p.status)}</td>
            <td class="num">${p.approved_value != null ? Util.money(p.approved_value, p.approved_currency) : "—"}</td>
            <td class="num">${Util.money(p.invoiced_total, p.approved_currency)}</td>
            <td class="num">${p.remaining_to_invoice != null ? Util.money(p.remaining_to_invoice, p.approved_currency) : "—"}</td>
          </tr>`).join("")}</tbody></table>
      ` : emptyState("No projects yet. Projects are created automatically when you accept a quotation — go to Quotations to accept one.");
      wireRowNav(document.getElementById("listCard"));
    }
    draw(projects);
    document.getElementById("projectFilter").oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) return draw(projects);
      draw(projects.filter((p) => [p.project_number, p.name, p.client_name].some((v) => (v || "").toLowerCase().includes(q))));
    };
  }

  // ===================== CREATE / EDIT =====================
  // There is no more manual "create a project" path in the UI — per the current workflow, a
  // project is only ever created by accepting a quotation (see SalesPages' Accept Quotation
  // action). This page still handles EDITING an existing project (status, notes, approved
  // value/payment terms overrides); `id` is always required to reach it now.
  async function renderForm(root, id) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    if (!id) {
      root.innerHTML = `<div class="content">${pageHeader("Projects")}
        <div class="card">${emptyState("Projects are created automatically when a quotation is accepted — open a quotation and use \"Accept Quotation\" there. This page is only for editing an existing project.")}</div>
        <div class="btn-row"><a class="btn btn-primary" href="#/quotes">Go to Quotations</a></div>
      </div>`;
      return;
    }
    const { project: existing } = await API.project(id);
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/projects/${id}">&larr; Back to ${Util.escapeHtml(existing.project_number)}</a>
      ${pageHeader(`Edit ${existing.project_number}`)}
      <div class="card">
        <div class="grid-2">
          <div class="field"><label>Project name *</label><input id="f_name" value="${Util.escapeHtml(existing.name || "")}"></div>
          <div class="field"><label>Client / Company</label><div style="padding-top:8px; color:var(--text-muted);">${Util.escapeHtml(existing.client_name)} (set by the accepted quotation — can't be changed here)</div></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Contact person</label><input id="f_contactPerson" value="${Util.escapeHtml(existing.contact_person || "")}"></div>
          <div class="field"><label>Project location</label><input id="f_location" value="${Util.escapeHtml(existing.location || "")}"></div>
        </div>
        <div class="field"><label>Scope of work</label><textarea id="f_scopeOfWork" rows="2">${Util.escapeHtml(existing.scope_of_work || "")}</textarea></div>
        <div class="field"><label>Payment terms</label><textarea id="f_paymentTerms" rows="2">${Util.escapeHtml(existing.payment_terms || "")}</textarea></div>
        <div class="field"><label>Notes</label><textarea id="f_notes" rows="2">${Util.escapeHtml(existing.notes || "")}</textarea></div>
        <div class="grid-2">
          <div class="field"><label>Project status</label>${statusSelect("f_status", existing.status || "approved")}</div>
          <div class="field"><label>Approved project total <span style="font-weight:400;">(VAT-inclusive — basis for invoicing; auto-filled from the accepted quotation, but can be corrected here)</span></label>
            <input id="f_approvedValue" type="number" step="0.01" min="0" value="${existing.approved_value != null ? existing.approved_value : ""}">
          </div>
        </div>
        <p style="font-size:12.5px; color:var(--text-muted);">Project status is independent of invoice/payment status — it just tracks where this job is in your own workflow.</p>
        <div class="btn-row"><button class="btn btn-primary" id="saveBtn">Save Project</button></div>
      </div>
    </div>`;
    document.getElementById("saveBtn").onclick = async () => {
      const name = document.getElementById("f_name").value.trim();
      if (!name) return toastError(new Error("Please enter a project name."));
      const body = {
        name, clientId: existing.client_id, contactPerson: document.getElementById("f_contactPerson").value.trim(),
        location: document.getElementById("f_location").value.trim(), scopeOfWork: document.getElementById("f_scopeOfWork").value.trim(),
        paymentTerms: document.getElementById("f_paymentTerms").value.trim(),
        notes: document.getElementById("f_notes").value.trim(), status: document.getElementById("f_status").value,
        approvedValue: document.getElementById("f_approvedValue").value || null,
      };
      try {
        const saved = await API.updateProject(existing.id, body);
        Toast.show("Project saved.");
        location.hash = `#/projects/${saved.project.id}`;
      } catch (err) { toastError(err); }
    };
  }

  // ===================== DETAIL (tabbed) =====================
  const TABS = [["overview", "Overview"], ["quotation", "Quotation & LPO"], ["invoices", "Invoices & Payments"], ["purchases", "Purchases & Expenses"], ["documents", "Documents"]];

  async function renderDetail(root, id, tab) {
    tab = TABS.some(([k]) => k === tab) ? tab : "overview";
    root.innerHTML = `<div class="content">Loading…</div>`;
    const data = await API.project(id);
    const { project, quotes, invoices, attachments, payments, purchaseOrders, bills, billing, activity, hasApprovedLpo, acceptedQuote } = data;

    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/projects">&larr; Back to Projects</a>
      ${pageHeader(project.project_number, `<a class="btn" href="#/projects/${id}/edit">Edit</a>`)}
      <div class="filter-tabs">${TABS.map(([k, label]) => `<button type="button" data-tab="${k}" class="${k === tab ? "active" : ""}">${label}</button>`).join("")}</div>
      ${tab === "overview" ? overviewTabHtml(project, billing, acceptedQuote, activity) : ""}
      ${tab === "quotation" ? quotationTabHtml(quotes, attachments) : ""}
      ${tab === "invoices" ? invoicesTabHtml(invoices, payments, hasApprovedLpo && project.status !== "cancelled") : ""}
      ${tab === "purchases" ? purchasesTabHtml(purchaseOrders, bills) : ""}
      ${tab === "documents" ? documentsTabHtml(attachments) : ""}
    </div>`;

    wireRowNav(root);
    root.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => {
      location.hash = `#/projects/${id}${b.dataset.tab === "overview" ? "" : "/" + b.dataset.tab}`;
    });

    const reload = () => renderDetail(root, id, tab);

    if (tab === "quotation") {
      const uploadBtn = root.querySelector("#uploadLpoBtn");
      if (uploadBtn) uploadBtn.onclick = () => openUploadModal(project, quotes, "lpo", reload);
      const linkQuoteBtn = root.querySelector("#linkQuoteBtn");
      if (linkQuoteBtn) linkQuoteBtn.onclick = () => linkExistingQuote(project, reload);
      root.querySelectorAll("[data-approve]").forEach((btn) => btn.onclick = async () => {
        try { await API.updateAttachmentApproval(btn.dataset.approve, "approved"); Toast.show("LPO approved."); reload(); } catch (err) { toastError(err); }
      });
      root.querySelectorAll("[data-reject]").forEach((btn) => btn.onclick = async () => {
        if (!confirm("Reject this LPO?")) return;
        try { await API.updateAttachmentApproval(btn.dataset.reject, "rejected"); Toast.show("LPO rejected."); reload(); } catch (err) { toastError(err); }
      });
    }

    if (tab === "invoices") {
      const createInvBtn = root.querySelector("#createInvoiceBtn");
      if (createInvBtn) createInvBtn.onclick = () => openCreateInvoiceModal(project, billing, reload);
      const linkInvBtn = root.querySelector("#linkInvoiceBtn");
      if (linkInvBtn) linkInvBtn.onclick = () => linkExistingInvoice(project, reload);
      root.querySelectorAll("[data-pay-invoice]").forEach((btn) => btn.onclick = (e) => {
        e.stopPropagation();
        const inv = invoices.find((i) => i.id === btn.dataset.payInvoice);
        openRecordPaymentModal(inv, reload);
      });
    }

    if (tab === "purchases") {
      const newPoBtn = root.querySelector("#newPoBtn");
      if (newPoBtn) newPoBtn.onclick = () => { try { sessionStorage.setItem(PREFILL_KEY, project.id); } catch (e) {} location.hash = "#/purchase-orders/new"; };
      const newBillBtn = root.querySelector("#newBillBtn");
      if (newBillBtn) newBillBtn.onclick = () => { try { sessionStorage.setItem(PREFILL_KEY, project.id); } catch (e) {} location.hash = "#/bills/new"; };
      const linkPoBtn = root.querySelector("#linkPoBtn");
      if (linkPoBtn) linkPoBtn.onclick = () => linkExistingPo(project, reload);
      const linkBillBtn = root.querySelector("#linkBillBtn");
      if (linkBillBtn) linkBillBtn.onclick = () => linkExistingBill(project, reload);
    }

    if (tab === "documents") {
      const uploadBtn = root.querySelector("#uploadDocBtn");
      if (uploadBtn) uploadBtn.onclick = () => openUploadModal(project, quotes, null, reload);
    }
  }

  // ---- Overview tab ----
  function overviewTabHtml(project, billing, acceptedQuote, activity) {
    return `
      <div class="card">
        <div class="grid-3">
          <div><label>Project name</label><div>${Util.escapeHtml(project.name)}</div></div>
          <div><label>Client / Company</label><div>${Util.escapeHtml(project.client_name)}</div></div>
          <div><label>Status</label><div>${pill(project.status)}</div></div>
        </div>
        <div class="grid-3" style="margin-top:10px;">
          <div><label>Contact</label><div>${Util.escapeHtml(project.contact_person || project.client_email || project.client_phone || "—")}</div></div>
          <div><label>Location</label><div>${Util.escapeHtml(project.location || "—")}</div></div>
          <div><label>Created</label><div>${Util.dateStr(project.created_at)}</div></div>
        </div>
        ${project.scope_of_work ? `<div style="margin-top:10px;"><label>Scope of work</label><div>${Util.escapeHtml(project.scope_of_work)}</div></div>` : ""}
        ${acceptedQuote ? `<div style="margin-top:10px;"><label>Accepted quotation</label><div><a href="#/quotes/${acceptedQuote.id}">${Util.escapeHtml(acceptedQuote.number)}</a> ${acceptedQuote.accepted_at ? `— accepted ${Util.dateStr(acceptedQuote.accepted_at)}` : ""}</div></div>` : ""}
        <div class="grid-2" style="margin-top:10px;">
          <div><label>Approved quotation value</label><div>${project.approved_value != null ? Util.money(project.approved_value, project.approved_currency) : "—"}</div></div>
          <div><label>Payment terms</label><div>${Util.escapeHtml(project.payment_terms || "—")}</div></div>
        </div>
        ${project.notes ? `<div style="margin-top:10px;"><label>Notes</label><div>${Util.escapeHtml(project.notes)}</div></div>` : ""}
      </div>

      <div class="card">
        <h2>Financial summary</h2>
        <div class="grid-4">
          <div class="stat-box"><div class="label">Approved Value</div><div class="value">${project.approved_value != null ? Util.money(project.approved_value, project.approved_currency) : "—"}</div></div>
          <div class="stat-box"><div class="label">Total Invoiced</div><div class="value">${Util.money(billing.invoicedTotal, project.approved_currency)}</div></div>
          <div class="stat-box"><div class="label">Payments Received</div><div class="value good">${Util.money(billing.paymentsReceived, project.approved_currency)}</div></div>
          <div class="stat-box"><div class="label">Outstanding Invoice Balance</div><div class="value">${Util.money(billing.outstandingOnInvoices, project.approved_currency)}</div></div>
        </div>
        <div class="grid-4" style="margin-top:14px;">
          <div class="stat-box"><div class="label">Remaining to Invoice</div><div class="value">${billing.remainingToInvoice != null ? Util.money(billing.remainingToInvoice, project.approved_currency) : "Not calculable"}</div></div>
          <div class="stat-box"><div class="label">PO Commitments</div><div class="value">${Util.money(billing.poCommitments, project.approved_currency)}</div></div>
          <div class="stat-box"><div class="label">Supplier Bills &amp; Expenses</div><div class="value">${Util.money(billing.supplierBillsTotal, project.approved_currency)}</div></div>
          <div class="stat-box"><div class="label">Payments Made to Suppliers</div><div class="value">${Util.money(billing.paymentsToSuppliers, project.approved_currency)}</div></div>
        </div>
        <div class="grid-2" style="margin-top:14px;">
          <div class="stat-box"><div class="label">Project Profit</div><div class="value ${billing.projectProfit >= 0 ? "good" : ""}">${Util.money(billing.projectProfit, project.approved_currency)}</div></div>
        </div>
        <p style="font-size:12px; color:var(--text-muted); margin-top:10px;"><strong>Project Profit</strong> = ${Util.escapeHtml(billing.profitBasis)}</p>
        ${billing.warnings.length ? billing.warnings.map((w) => `<p style="font-size:12.5px; color:var(--warn); margin-top:10px;">&#9888; ${Util.escapeHtml(w)}</p>`).join("") : ""}
      </div>

      <div class="card">
        <h2>Activity</h2>
        ${activity.length ? `<ul style="margin:0; padding-left:18px;">${activity.map((e) => `<li style="margin-bottom:6px; font-size:13.5px;">${Util.dateStr(e.date)} — ${e.href ? `<a href="${e.href}">${Util.escapeHtml(e.label)}</a>` : Util.escapeHtml(e.label)}</li>`).join("")}</ul>` : emptyState("No activity yet.")}
      </div>
    `;
  }

  // ---- Quotation & LPO tab ----
  function quotationTabHtml(quotes, attachments) {
    const lpos = attachments.filter((a) => a.kind === "lpo");
    return `
      <div class="card">
        <h2>Quotations</h2>
        ${quotes.length ? `<table class="clickable"><thead><tr><th>Number</th><th>Date</th><th class="num">Total</th><th>Status</th></tr></thead>
          <tbody>${quotes.map((q) => `<tr data-nav="#/quotes/${q.id}"><td>${Util.escapeHtml(q.number)}</td><td>${Util.dateStr(q.quote_date)}</td><td class="num">${Util.money(q.total, q.currency_code)}</td><td>${quotePill(q.status)}</td></tr>`).join("")}</tbody></table>`
          : emptyState("No quotations linked to this project yet.")}
        <div class="btn-row"><button type="button" class="btn" id="linkQuoteBtn">+ Link existing quotation</button></div>
      </div>

      <div class="card">
        <h2>Customer LPO</h2>
        ${lpos.length ? `<table><thead><tr><th>File</th><th>LPO #</th><th>LPO Date</th><th class="num">LPO Value</th><th>Status</th><th>Uploaded</th><th></th></tr></thead>
          <tbody>${lpos.map((a) => `
            <tr>
              <td><a href="${API.attachmentFileUrl(a.id)}" target="_blank" rel="noopener">${Util.escapeHtml(a.file_name)}</a></td>
              <td>${Util.escapeHtml(a.lpo_number || "—")}</td>
              <td>${a.lpo_date ? Util.dateStr(a.lpo_date) : "—"}</td>
              <td class="num">${a.lpo_value != null ? Util.money(a.lpo_value) : "—"}</td>
              <td>${pill(a.approval_status)}</td>
              <td>${Util.dateStr(a.created_at)}</td>
              <td>${a.approval_status === "pending" ? `<button type="button" class="btn btn-sm" data-approve="${a.id}">Approve</button> <button type="button" class="btn btn-sm" data-reject="${a.id}">Reject</button>` : ""}</td>
            </tr>`).join("")}</tbody></table>`
          : emptyState("No customer LPO uploaded yet.")}
        <div class="btn-row"><button type="button" class="btn btn-primary" id="uploadLpoBtn">+ Upload Customer LPO</button></div>
      </div>
    `;
  }

  // ---- Invoices & Payments tab ----
  function invoicesTabHtml(invoices, payments, canInvoice) {
    return `
      <div class="card">
        <h2>Invoices</h2>
        ${invoices.length ? `<table class="clickable"><thead><tr><th>Number</th><th>Kind</th><th>Date</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
          <tbody>${invoices.map((i) => `
            <tr data-nav="#/invoices/${i.id}">
              <td>${Util.escapeHtml(i.number)}</td><td>${INVOICE_KIND_LABELS[i.invoice_kind] || i.invoice_kind}</td><td>${Util.dateStr(i.invoice_date)}</td>
              <td class="num">${Util.money(i.total, i.currency_code)}</td><td class="num">${Util.money(i.amount_paid, i.currency_code)}</td>
              <td class="num">${Util.money(i.balance, i.currency_code)}</td>
              <td>${pill(i.status)}</td>
              <td>${["issued", "partially_paid"].includes(i.status) ? `<button type="button" class="btn btn-sm" data-pay-invoice="${i.id}">Record Payment</button>` : ""}</td>
            </tr>`).join("")}</tbody></table>`
          : emptyState("No invoices linked to this project yet.")}
        <div class="btn-row">
          <button type="button" class="btn btn-primary" id="createInvoiceBtn" ${canInvoice ? "" : "disabled title=\"Record and approve the customer's signed LPO first (Quotation & LPO tab)\""}>+ Create Advance / Progress / Final Invoice</button>
          <button type="button" class="btn" id="linkInvoiceBtn">+ Link existing invoice</button>
        </div>
      </div>

      <div class="card">
        <h2>Payments received</h2>
        ${payments.length ? `<table><thead><tr><th>Date</th><th class="num">Amount</th><th>Invoice</th></tr></thead>
          <tbody>${payments.map((p) => `<tr><td>${Util.dateStr(p.payment_date)}</td><td class="num">${Util.money(p.amount, p.currency_code)}</td><td><a href="#/invoices/${p.invoice_id}">${Util.escapeHtml(p.invoice_number)}</a></td></tr>`).join("")}</tbody></table>`
          : emptyState("No payments recorded yet.")}
      </div>
    `;
  }

  // ---- Purchases & Expenses tab ----
  function purchasesTabHtml(purchaseOrders, bills) {
    return `
      <div class="card">
        <h2>Purchase Orders</h2>
        ${purchaseOrders.length ? `<table class="clickable"><thead><tr><th>Number</th><th>Vendor</th><th>Date</th><th class="num">Total</th><th>Status</th></tr></thead>
          <tbody>${purchaseOrders.map((po) => `<tr data-nav="#/purchase-orders/${po.id}"><td>${Util.escapeHtml(po.number)}</td><td>${Util.escapeHtml(po.vendor_name)}</td><td>${Util.dateStr(po.po_date)}</td><td class="num">${Util.money(po.total, po.currency_code)}</td><td>${pill(po.status)}</td></tr>`).join("")}</tbody></table>`
          : emptyState("No purchase orders linked to this project yet.")}
        <div class="btn-row">
          <button type="button" class="btn btn-primary" id="newPoBtn">+ New Purchase Order</button>
          <button type="button" class="btn" id="linkPoBtn">+ Link existing PO</button>
        </div>
      </div>

      <div class="card">
        <h2>Supplier Bills &amp; Expenses</h2>
        ${bills.length ? `<table class="clickable"><thead><tr><th>Number</th><th>Vendor</th><th>Date</th><th class="num">Total</th><th class="num">Paid</th><th>Status</th></tr></thead>
          <tbody>${bills.map((b) => `<tr data-nav="#/bills/${b.id}"><td>${Util.escapeHtml(b.number)}</td><td>${Util.escapeHtml(b.vendor_name)}</td><td>${Util.dateStr(b.bill_date)}</td><td class="num">${Util.money(b.total, b.currency_code)}</td><td class="num">${Util.money(b.amount_paid, b.currency_code)}</td><td>${pill(b.status)}</td></tr>`).join("")}</tbody></table>`
          : emptyState("No supplier bills or expenses linked to this project yet.")}
        <div class="btn-row">
          <button type="button" class="btn btn-primary" id="newBillBtn">+ Add Supplier Bill / Expense</button>
          <button type="button" class="btn" id="linkBillBtn">+ Link existing bill</button>
        </div>
      </div>
    `;
  }

  // ---- Documents tab ----
  function documentsTabHtml(attachments) {
    const docs = attachments.filter((a) => a.kind !== "lpo");
    return `
      <div class="card">
        <h2>Project Documents</h2>
        ${docs.length ? `<table><thead><tr><th>Type</th><th>File</th><th>Notes</th><th>Uploaded</th></tr></thead>
          <tbody>${docs.map((a) => `
            <tr>
              <td>${KIND_LABELS[a.kind] || "Document"}</td>
              <td><a href="${API.attachmentFileUrl(a.id)}" target="_blank" rel="noopener">${Util.escapeHtml(a.file_name)}</a></td>
              <td>${Util.escapeHtml(a.notes || "—")}</td>
              <td>${Util.dateStr(a.created_at)}</td>
            </tr>`).join("")}</tbody></table>`
          : emptyState("No signed quotations, contracts, or completion documents uploaded yet.")}
        <div class="btn-row"><button type="button" class="btn btn-primary" id="uploadDocBtn">+ Upload Document</button></div>
      </div>
    `;
  }

  // ===================== Link-existing-record modals =====================
  function openLinkModal(title, options, onPick) {
    if (!options.length) { Toast.show("Nothing eligible to link right now."); return; }
    Modal.open(`
      <h3>${title}</h3>
      <div class="field"><label>Select a record</label>${selectHtml("f_linkPick", options, "", "Choose…")}</div>
      <div class="btn-row"><button type="button" class="btn btn-primary" id="confirmLinkBtn">Link</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
    `, {
      onMount: (modal) => {
        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#confirmLinkBtn").onclick = async () => {
          const val = modal.querySelector("#f_linkPick").value;
          if (!val) return toastError(new Error("Please choose a record."));
          try { await onPick(val); Modal.close(); } catch (err) { toastError(err); }
        };
      },
    });
  }
  async function linkExistingQuote(project, onDone) {
    const { quotes } = await API.quotes();
    const candidates = quotes.filter((q) => q.client_id === project.client_id && !q.project_id);
    openLinkModal("Link an existing quotation", candidates.map((q) => ({ value: q.id, label: `${q.number} — ${Util.money(q.total, q.currency_code)} (${QUOTE_STATUS_LABELS[q.status] || q.status})` })),
      async (quoteId) => { await API.linkQuoteToProject(quoteId, project.id); Toast.show("Quotation linked."); onDone(); });
  }
  async function linkExistingInvoice(project, onDone) {
    const { invoices } = await API.invoices();
    const candidates = invoices.filter((i) => i.client_id === project.client_id && !i.project_id);
    openLinkModal("Link an existing invoice", candidates.map((i) => ({ value: i.id, label: `${i.number} — ${Util.money(i.total, i.currency_code)} (${i.status})` })),
      async (invoiceId) => { await API.linkInvoiceToProject(invoiceId, project.id); Toast.show("Invoice linked."); onDone(); });
  }
  async function linkExistingPo(project, onDone) {
    const { purchaseOrders } = await API.purchaseOrders();
    const candidates = purchaseOrders.filter((po) => !po.project_id);
    openLinkModal("Link an existing purchase order", candidates.map((po) => ({ value: po.id, label: `${po.number} — ${Util.escapeHtml(po.vendor_name)} — ${Util.money(po.total, po.currency_code)}` })),
      async (poId) => { await API.linkPoToProject(poId, project.id); Toast.show("Purchase order linked."); onDone(); });
  }
  async function linkExistingBill(project, onDone) {
    const { bills } = await API.bills();
    const candidates = bills.filter((b) => !b.project_id);
    openLinkModal("Link an existing bill", candidates.map((b) => ({ value: b.id, label: `${b.number} — ${Util.escapeHtml(b.vendor_name)} — ${Util.money(b.total, b.currency_code)}` })),
      async (billId) => { await API.linkBillToProject(billId, project.id); Toast.show("Bill linked."); onDone(); });
  }

  // ===================== Record Payment (quick shortcut) =====================
  function openRecordPaymentModal(invoice, onSaved) {
    const balance = round2(Number(invoice.total) - Number(invoice.amount_paid));
    Modal.open(`
      <h3>Record payment — ${Util.escapeHtml(invoice.number)}</h3>
      <div class="field"><label>Balance due</label><div>${Util.money(balance, invoice.currency_code)}</div></div>
      <form id="payForm">
        <div class="field"><label>Amount *</label><input id="f_amount" type="number" step="0.01" value="${balance}" required></div>
        <div class="field"><label>Date</label><input id="f_date" type="date" value="${Util.todayISO()}"></div>
        <div class="field"><label>Reference</label><input id="f_reference"></div>
        <div class="btn-row"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
      </form>
    `, {
      onMount: (modal) => {
        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#payForm").onsubmit = async (e) => {
          e.preventDefault();
          try {
            await API.recordPayment(invoice.id, { amount: Number(modal.querySelector("#f_amount").value), paymentDate: modal.querySelector("#f_date").value, reference: modal.querySelector("#f_reference").value.trim() });
            Toast.show("Payment recorded."); Modal.close(); onSaved && onSaved();
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  // ===================== Upload attachment modal =====================
  // forceKind: "lpo" (Quotation & LPO tab's button) or null (Documents tab's button, where
  // the type is chosen in the form, defaulting to something other than LPO).
  function openUploadModal(project, quotes, forceKind, onSaved) {
    Modal.open(`
      <h3>Upload ${forceKind === "lpo" ? "Customer LPO" : "document"} — ${Util.escapeHtml(project.project_number)}</h3>
      <form id="uploadForm">
        ${forceKind ? `<input type="hidden" id="f_kind" value="${forceKind}">` : `
        <div class="field"><label>Document type</label>
          <select id="f_kind">
            <option value="signed_quotation">Signed quotation</option>
            <option value="contract">Contract</option>
            <option value="completion">Completion document</option>
            <option value="other">Other</option>
          </select>
        </div>`}
        <div class="field"><label>File (PDF, JPG, or PNG) *</label><input type="file" id="f_file" accept="application/pdf,image/jpeg,image/png" required></div>
        <div id="lpoFields" style="${forceKind === "lpo" ? "" : "display:none;"}">
          <div class="field-row">
            <div class="field"><label>LPO number <span style="font-weight:400; color:var(--text-muted);">(optional — auto-generated if left blank)</span></label><input id="f_lpoNumber" placeholder="Leave blank to auto-generate"></div>
            <div class="field"><label>LPO date</label><input type="date" id="f_lpoDate"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>LPO value</label><input type="number" step="0.01" id="f_lpoValue"></div>
            <div class="field"><label>Related quotation</label>${selectHtml("f_relatedQuoteId", quotes.map((q) => ({ value: q.id, label: q.number })), "", "— none —")}</div>
          </div>
        </div>
        <div class="field"><label>Notes</label><textarea id="f_notes" rows="2"></textarea></div>
        <div class="btn-row"><button type="submit" class="btn btn-primary">Upload</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
      </form>
    `, {
      onMount: (modal) => {
        const kindEl = modal.querySelector("#f_kind");
        if (!forceKind) {
          const lpoFields = modal.querySelector("#lpoFields");
          const toggle = () => { lpoFields.style.display = kindEl.value === "lpo" ? "" : "none"; };
          kindEl.onchange = toggle; toggle();
        }
        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#uploadForm").onsubmit = async (e) => {
          e.preventDefault();
          const fileInput = modal.querySelector("#f_file");
          const file = fileInput.files[0];
          if (!file) return toastError(new Error("Please choose a file."));
          if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) return toastError(new Error("Only PDF, JPG, or PNG files are supported."));
          if (file.size > 10 * 1024 * 1024) return toastError(new Error("That file is too large (max ~10MB)."));
          try {
            const fileB64 = await fileToBase64(file);
            await API.uploadProjectAttachment(project.id, {
              kind: kindEl.value, fileName: file.name, mimeType: file.type, fileB64, fileSize: file.size,
              lpoNumber: modal.querySelector("#f_lpoNumber")?.value.trim(), lpoDate: modal.querySelector("#f_lpoDate")?.value || null,
              lpoValue: modal.querySelector("#f_lpoValue")?.value || null, relatedQuoteId: modal.querySelector("#f_relatedQuoteId")?.value || null,
              notes: modal.querySelector("#f_notes").value.trim(),
            });
            Toast.show("Uploaded."); Modal.close(); onSaved && onSaved();
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  // ===================== Create Invoice (advance / progress / final) modal =====================
  function openCreateInvoiceModal(project, billing, onSaved) {
    const approvedValue = Number(project.approved_value);
    Modal.open(`
      <h3>Create Invoice — ${Util.escapeHtml(project.project_number)}</h3>
      <div class="field"><label>Approved project total</label><div><strong>${Util.money(approvedValue, project.approved_currency)}</strong></div></div>
      <div class="field"><label>Already invoiced</label><div>${Util.money(billing.invoicedTotal, project.approved_currency)}</div></div>
      <form id="advForm">
        <div class="field"><label>Invoice kind</label>
          <select id="f_invoiceKind">
            <option value="advance">Advance</option>
            <option value="progress">Progress</option>
            <option value="final">Final</option>
          </select>
        </div>
        <div class="field-row">
          <div class="field"><label>Amount type</label>
            <select id="f_advanceType"><option value="percent">Percentage of approved total</option><option value="fixed">Fixed amount</option></select>
          </div>
          <div class="field"><label id="f_advanceValueLabel">Percentage (%)</label><input id="f_advanceValue" type="number" step="0.01" min="0" value="50"></div>
        </div>
        <div class="field"><label>VAT rate (%) <span style="font-weight:400;">applied to this line, matching your normal VAT treatment</span></label><input id="f_vatRate" type="number" step="0.01" value="5"></div>
        <div class="field" style="background:var(--surface-2); border-radius:8px; padding:12px;" id="advPreview">—</div>
        <div class="field"><label>Notes (optional)</label><textarea id="f_notes" rows="2"></textarea></div>
        <div class="btn-row"><button type="submit" class="btn btn-primary">Create Draft Invoice</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
      </form>
    `, {
      onMount: (modal) => {
        const kindEl = modal.querySelector("#f_invoiceKind");
        const typeEl = modal.querySelector("#f_advanceType");
        const valueEl = modal.querySelector("#f_advanceValue");
        const vatEl = modal.querySelector("#f_vatRate");
        const labelEl = modal.querySelector("#f_advanceValueLabel");
        const preview = modal.querySelector("#advPreview");
        const remaining = round2(Math.max(approvedValue - billing.invoicedTotal, 0));
        function update() {
          labelEl.textContent = typeEl.value === "percent" ? "Percentage (%)" : "Fixed amount";
          const val = Number(valueEl.value) || 0;
          const advanceAmount = round2(typeEl.value === "percent" ? (approvedValue * val) / 100 : val);
          const remainingAfter = round2(Math.max(remaining - advanceAmount, 0));
          const over = advanceAmount > remaining + 0.01;
          preview.innerHTML = `
            ${kindEl.options[kindEl.selectedIndex].text} invoice amount: <strong>${Util.money(advanceAmount, project.approved_currency)}</strong><br>
            Remaining contract amount to invoice after this: <strong>${Util.money(remainingAfter, project.approved_currency)}</strong>
            ${over ? `<div style="color:var(--bad); margin-top:6px;">This exceeds the remaining uninvoiced amount of ${Util.money(remaining, project.approved_currency)}.</div>` : ""}
          `;
        }
        kindEl.onchange = update; typeEl.onchange = update; valueEl.oninput = update; vatEl.oninput = update; update();
        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#advForm").onsubmit = async (e) => {
          e.preventDefault();
          try {
            const res = await API.createAdvanceInvoice(project.id, {
              invoiceKind: kindEl.value, advanceType: typeEl.value, advanceValue: Number(valueEl.value), vatRate: Number(vatEl.value),
              notes: modal.querySelector("#f_notes").value.trim(),
            });
            Toast.show(`${INVOICE_KIND_LABELS[kindEl.value]} invoice ${res.invoice.number} created as a draft.`);
            Modal.close();
            location.hash = `#/invoices/${res.invoice.id}`;
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  return { renderList, renderForm, renderDetail };
})();
