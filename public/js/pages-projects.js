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

  function clientSelect(clients, selected) {
    return selectHtml("f_clientId", clients.map((c) => ({ value: c.id, label: c.name })), selected, "Select a client…");
  }
  function statusSelect(id, selected) {
    return `<select id="${id}">${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${v === selected ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  }

  // ===================== LIST =====================
  async function renderList(root) {
    root.innerHTML = `<div class="content">${pageHeader("Projects", `<a class="btn btn-primary" href="#/projects/new">+ New Project</a>`)}
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
      ` : emptyState("No projects yet.");
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
  async function renderForm(root, id) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const [{ clients }, existingData] = await Promise.all([API.clients(), id ? API.project(id) : null]);
    const existing = existingData?.project || null;
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/projects">&larr; Back to Projects</a>
      ${pageHeader(existing ? `Edit ${existing.project_number}` : "New Project")}
      <div class="card">
        <div class="grid-2">
          <div class="field"><label>Project name *</label><input id="f_name" value="${Util.escapeHtml(existing?.name || "")}"></div>
          <div class="field"><label>Client / Company *</label>${clientSelect(clients, existing?.client_id)}</div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Contact person</label><input id="f_contactPerson" value="${Util.escapeHtml(existing?.contact_person || "")}"></div>
          <div class="field"><label>Project location</label><input id="f_location" value="${Util.escapeHtml(existing?.location || "")}"></div>
        </div>
        <div class="field"><label>Scope of work</label><textarea id="f_scopeOfWork" rows="2">${Util.escapeHtml(existing?.scope_of_work || "")}</textarea></div>
        <div class="field"><label>Notes</label><textarea id="f_notes" rows="2">${Util.escapeHtml(existing?.notes || "")}</textarea></div>
        <div class="grid-2">
          <div class="field"><label>Project status</label>${statusSelect("f_status", existing?.status || "quotation_sent")}</div>
          <div class="field"><label>Approved project total <span style="font-weight:400;">(VAT-inclusive — basis for advance-invoice %; usually auto-filled from an approved LPO)</span></label>
            <input id="f_approvedValue" type="number" step="0.01" min="0" value="${existing?.approved_value != null ? existing.approved_value : ""}">
          </div>
        </div>
        ${existing ? `<p style="font-size:12.5px; color:var(--text-muted);">Project status is independent of invoice/payment status — it just tracks where this job is in your own workflow.</p>` : ""}
        <div class="btn-row"><button class="btn btn-primary" id="saveBtn">Save Project</button></div>
      </div>
    </div>`;
    document.getElementById("saveBtn").onclick = async () => {
      const clientId = document.getElementById("f_clientId").value;
      const name = document.getElementById("f_name").value.trim();
      if (!name) return toastError(new Error("Please enter a project name."));
      if (!clientId) return toastError(new Error("Please select a client."));
      const body = {
        name, clientId, contactPerson: document.getElementById("f_contactPerson").value.trim(),
        location: document.getElementById("f_location").value.trim(), scopeOfWork: document.getElementById("f_scopeOfWork").value.trim(),
        notes: document.getElementById("f_notes").value.trim(), status: document.getElementById("f_status").value,
        approvedValue: document.getElementById("f_approvedValue").value || null,
      };
      try {
        const saved = existing ? await API.updateProject(existing.id, body) : await API.createProject(body);
        Toast.show("Project saved.");
        location.hash = `#/projects/${saved.project.id}`;
      } catch (err) { toastError(err); }
    };
  }

  // ===================== DETAIL =====================
  async function renderDetail(root, id) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const data = await API.project(id);
    const { project, quotes, invoices, attachments, payments, billing, activity, hasApprovedLpo } = data;
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/projects">&larr; Back to Projects</a>
      ${pageHeader(project.project_number, actionsForProject(project, hasApprovedLpo))}
      <div class="card">
        <div class="grid-3">
          <div><label>Project name</label><div>${Util.escapeHtml(project.name)}</div></div>
          <div><label>Client</label><div>${Util.escapeHtml(project.client_name)}</div></div>
          <div><label>Status</label><div>${pill(project.status)}</div></div>
        </div>
        <div class="grid-3" style="margin-top:10px;">
          <div><label>Contact person</label><div>${Util.escapeHtml(project.contact_person || "—")}</div></div>
          <div><label>Location</label><div>${Util.escapeHtml(project.location || "—")}</div></div>
          <div><label>Created</label><div>${Util.dateStr(project.created_at)}</div></div>
        </div>
        ${project.scope_of_work ? `<div style="margin-top:10px;"><label>Scope of work</label><div>${Util.escapeHtml(project.scope_of_work)}</div></div>` : ""}
        ${project.notes ? `<div style="margin-top:10px;"><label>Notes</label><div>${Util.escapeHtml(project.notes)}</div></div>` : ""}
      </div>

      <div class="card">
        <h2>Billing summary</h2>
        <div class="grid-4">
          <div class="stat-box"><div class="label">Approved Value</div><div class="value">${project.approved_value != null ? Util.money(project.approved_value, project.approved_currency) : "—"}</div></div>
          <div class="stat-box"><div class="label">Invoiced</div><div class="value">${Util.money(billing.invoicedTotal, project.approved_currency)}</div></div>
          <div class="stat-box"><div class="label">Payments Received</div><div class="value good">${Util.money(billing.paymentsReceived, project.approved_currency)}</div></div>
          <div class="stat-box"><div class="label">Outstanding on Invoices</div><div class="value">${Util.money(billing.outstandingOnInvoices, project.approved_currency)}</div></div>
        </div>
        <div class="grid-2" style="margin-top:14px;">
          <div class="stat-box"><div class="label">Remaining Contract Amount to Invoice</div><div class="value">${billing.remainingToInvoice != null ? Util.money(billing.remainingToInvoice, project.approved_currency) : "Not calculable"}</div></div>
        </div>
        ${billing.warnings.length ? billing.warnings.map((w) => `<p style="font-size:12.5px; color:var(--warn); margin-top:10px;">&#9888; ${Util.escapeHtml(w)}</p>`).join("") : ""}
        <p style="font-size:12px; color:var(--text-muted); margin-top:10px;">Related purchases and expenses aren't linked to projects yet in this version — only quotations, invoices, and payments are reflected above.</p>
      </div>

      <div class="card">
        <h2>Quotations</h2>
        ${quotes.length ? `<table class="clickable"><thead><tr><th>Number</th><th>Date</th><th class="num">Total</th><th>Status</th></tr></thead>
          <tbody>${quotes.map((q) => `<tr data-nav="#/quotes/${q.id}"><td>${Util.escapeHtml(q.number)}</td><td>${Util.dateStr(q.quote_date)}</td><td class="num">${Util.money(q.total, q.currency_code)}</td><td>${pill(q.status)}</td></tr>`).join("")}</tbody></table>`
          : emptyState("No quotations linked to this project yet.")}
      </div>

      <div class="card">
        <h2>Invoices</h2>
        ${invoices.length ? `<table class="clickable"><thead><tr><th>Number</th><th>Type</th><th>Date</th><th class="num">Total</th><th class="num">Paid</th><th>Status</th></tr></thead>
          <tbody>${invoices.map((i) => `<tr data-nav="#/invoices/${i.id}"><td>${Util.escapeHtml(i.number)}</td><td style="text-transform:capitalize;">${i.invoice_kind}</td><td>${Util.dateStr(i.invoice_date)}</td><td class="num">${Util.money(i.total, i.currency_code)}</td><td class="num">${Util.money(i.amount_paid, i.currency_code)}</td><td>${pill(i.status)}</td></tr>`).join("")}</tbody></table>`
          : emptyState("No invoices linked to this project yet.")}
      </div>

      <div class="card">
        <h2>Customer LPO &amp; Attachments</h2>
        ${attachments.length ? `<table><thead><tr><th>Type</th><th>File</th><th>LPO #</th><th class="num">LPO Value</th><th>Status</th><th>Uploaded</th><th></th></tr></thead>
          <tbody>${attachments.map((a) => `
            <tr>
              <td>${KIND_LABELS[a.kind] || "Document"}</td>
              <td><a href="${API.attachmentFileUrl(a.id)}" target="_blank" rel="noopener">${Util.escapeHtml(a.file_name)}</a></td>
              <td>${Util.escapeHtml(a.lpo_number || "—")}</td>
              <td class="num">${a.lpo_value != null ? Util.money(a.lpo_value, project.approved_currency) : "—"}</td>
              <td>${a.kind === "lpo" ? pill(a.approval_status) : "—"}</td>
              <td>${Util.dateStr(a.created_at)}</td>
              <td>${a.kind === "lpo" && a.approval_status === "pending" ? `<button type="button" class="btn btn-sm" data-approve="${a.id}">Approve</button> <button type="button" class="btn btn-sm" data-reject="${a.id}">Reject</button>` : ""}</td>
            </tr>`).join("")}</tbody></table>`
          : emptyState("No LPOs, signed quotations, contracts, or completion documents uploaded yet.")}
        <div class="btn-row"><button class="btn" id="uploadBtn">+ Upload Attachment</button></div>
      </div>

      <div class="card">
        <h2>Activity</h2>
        ${activity.length ? `<ul style="margin:0; padding-left:18px;">${activity.map((e) => `<li style="margin-bottom:6px; font-size:13.5px;">${Util.dateStr(e.date)} — ${e.href ? `<a href="${e.href}">${Util.escapeHtml(e.label)}</a>` : Util.escapeHtml(e.label)}</li>`).join("")}</ul>` : emptyState("No activity yet.")}
      </div>
    </div>`;

    wireRowNav(root);
    const editBtn = root.querySelector("#editBtn");
    if (editBtn) editBtn.onclick = () => { location.hash = `#/projects/${id}/edit`; };
    const advBtn = root.querySelector("#advanceInvoiceBtn");
    if (advBtn) advBtn.onclick = () => openAdvanceInvoiceModal(project, billing, () => renderDetail(root, id));
    root.querySelector("#uploadBtn").onclick = () => openUploadModal(project, quotes, () => renderDetail(root, id));
    root.querySelectorAll("[data-approve]").forEach((btn) => btn.onclick = async () => {
      try { await API.updateAttachmentApproval(btn.dataset.approve, "approved"); Toast.show("LPO approved."); renderDetail(root, id); } catch (err) { toastError(err); }
    });
    root.querySelectorAll("[data-reject]").forEach((btn) => btn.onclick = async () => {
      if (!confirm("Reject this LPO?")) return;
      try { await API.updateAttachmentApproval(btn.dataset.reject, "rejected"); Toast.show("LPO rejected."); renderDetail(root, id); } catch (err) { toastError(err); }
    });
  }

  function actionsForProject(project, hasApprovedLpo) {
    let html = `<button class="btn" id="editBtn">Edit</button>`;
    if (hasApprovedLpo && project.status !== "cancelled") html += ` <button class="btn btn-primary" id="advanceInvoiceBtn">Create Advance Invoice</button>`;
    return html;
  }

  // ===================== Upload attachment modal =====================
  function openUploadModal(project, quotes, onSaved) {
    Modal.open(`
      <h3>Upload attachment — ${Util.escapeHtml(project.project_number)}</h3>
      <form id="uploadForm">
        <div class="field"><label>Document type</label>
          <select id="f_kind">
            <option value="lpo">Customer LPO</option>
            <option value="signed_quotation">Signed quotation</option>
            <option value="contract">Contract</option>
            <option value="completion">Completion document</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="field"><label>File (PDF, JPG, or PNG) *</label><input type="file" id="f_file" accept="application/pdf,image/jpeg,image/png" required></div>
        <div id="lpoFields" style="display:none;">
          <div class="field-row">
            <div class="field"><label>LPO number</label><input id="f_lpoNumber"></div>
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
        const lpoFields = modal.querySelector("#lpoFields");
        const toggle = () => { lpoFields.style.display = kindEl.value === "lpo" ? "" : "none"; };
        kindEl.onchange = toggle; toggle();
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

  // ===================== Create Advance Invoice modal =====================
  function openAdvanceInvoiceModal(project, billing, onSaved) {
    const approvedValue = Number(project.approved_value);
    Modal.open(`
      <h3>Create Advance Invoice — ${Util.escapeHtml(project.project_number)}</h3>
      <div class="field"><label>Approved project total</label><div><strong>${Util.money(approvedValue, project.approved_currency)}</strong></div></div>
      <div class="field"><label>Already invoiced</label><div>${Util.money(billing.invoicedTotal, project.approved_currency)}</div></div>
      <form id="advForm">
        <div class="field-row">
          <div class="field"><label>Advance type</label>
            <select id="f_advanceType"><option value="percent">Percentage of approved total</option><option value="fixed">Fixed amount</option></select>
          </div>
          <div class="field"><label id="f_advanceValueLabel">Percentage (%)</label><input id="f_advanceValue" type="number" step="0.01" min="0" value="50"></div>
        </div>
        <div class="field"><label>VAT rate (%) <span style="font-weight:400;">applied to this advance line, matching your normal VAT treatment</span></label><input id="f_vatRate" type="number" step="0.01" value="5"></div>
        <div class="field" style="background:var(--surface-2); border-radius:8px; padding:12px;" id="advPreview">—</div>
        <div class="field"><label>Notes (optional)</label><textarea id="f_notes" rows="2"></textarea></div>
        <div class="btn-row"><button type="submit" class="btn btn-primary">Create Draft Advance Invoice</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
      </form>
    `, {
      onMount: (modal) => {
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
            Advance invoice amount: <strong>${Util.money(advanceAmount, project.approved_currency)}</strong><br>
            Remaining contract amount to invoice after this: <strong>${Util.money(remainingAfter, project.approved_currency)}</strong>
            ${over ? `<div style="color:var(--bad); margin-top:6px;">This exceeds the remaining uninvoiced amount of ${Util.money(remaining, project.approved_currency)}.</div>` : ""}
          `;
        }
        typeEl.onchange = update; valueEl.oninput = update; vatEl.oninput = update; update();
        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#advForm").onsubmit = async (e) => {
          e.preventDefault();
          try {
            const res = await API.createAdvanceInvoice(project.id, {
              advanceType: typeEl.value, advanceValue: Number(valueEl.value), vatRate: Number(vatEl.value),
              notes: modal.querySelector("#f_notes").value.trim(),
            });
            Toast.show(`Advance invoice ${res.invoice.number} created as a draft.`);
            Modal.close();
            location.hash = `#/invoices/${res.invoice.id}`;
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  return { renderList, renderForm, renderDetail };
})();
