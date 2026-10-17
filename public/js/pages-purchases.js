const PurchasePages = (() => {
  async function loadVendorsAndItems() {
    const [{ vendors }, { items }, { projects }] = await Promise.all([API.vendors(), API.items(), API.projects()]);
    return { vendors, items, projects };
  }
  function vendorSelect(vendors, selected) {
    return selectHtml("f_vendorId", vendors.map((v) => ({ value: v.id, label: v.name })), selected, "Select a vendor…");
  }
  function toEditorLine(l) { return { itemId: l.item_id || "", description: l.description, qty: l.qty, unitPrice: l.unit_price, vatRate: l.vat_rate, expenseAccountId: l.expense_account_id || "" }; }

  // Unlike the Project Number field on quotes/invoices, a PO/Bill's project picker never
  // touches the vendor — a project has one client, but is supplied by many vendors — so this
  // is just "pick an existing project, or none", no client auto-fill and no inline "create a
  // new project" option (that stays on the quote/invoice forms, where a project naturally
  // starts its life).
  function projectPickerHtml(existing, label) {
    return `
      <div class="field">
        <label>Project <span style="font-weight:400;">(optional — ${label})</span></label>
        <input id="f_projectPicker" list="projectOptionsList" placeholder="Search by project number, name, or client…" value="${existing?.project_number ? Util.escapeHtml(existing.project_number) : ""}" autocomplete="off">
        <datalist id="projectOptionsList"></datalist>
      </div>
    `;
  }
  // When arriving here via "+ New Purchase Order" / "+ Add Supplier Bill" from inside a
  // project page, that page stashes the project's id for one use so this form opens with
  // it already picked — read-and-clear immediately so it never leaks into an unrelated
  // "+ New PO" click from the main Purchase Orders nav afterwards.
  function consumePrefillProjectId() {
    try {
      const id = sessionStorage.getItem("callistoPrefillProjectId");
      sessionStorage.removeItem("callistoPrefillProjectId");
      return id || null;
    } catch (e) { return null; }
  }
  function wireProjectPicker(projects, prefillProjectId) {
    const picker = document.getElementById("f_projectPicker");
    const datalist = document.getElementById("projectOptionsList");
    datalist.innerHTML = projects.map((p) => `<option value="${Util.escapeHtml(p.project_number)} — ${Util.escapeHtml(p.name)} (${Util.escapeHtml(p.client_name)})">`).join("");
    function findProjectFromInput(val) {
      val = (val || "").trim();
      if (!val) return null;
      const numPart = val.split(" — ")[0].trim();
      return projects.find((p) => p.project_number === numPart) || null;
    }
    if (prefillProjectId) {
      const match = projects.find((p) => p.id === prefillProjectId);
      if (match) picker.value = `${match.project_number} — ${match.name} (${match.client_name})`;
    }
    return { getProjectId: () => (findProjectFromInput(picker.value)?.id || null) };
  }
  // Small inline "link to project" control for the detail pages — POs and Bills have no
  // edit form at all (create-only, like the rest of this module), so this is the only way
  // to attach a project to one after it's already been created.
  function linkProjectControlHtml(record) {
    return `
      <div style="margin-top:10px;">
        <label style="font-size:12.5px; color:var(--text-muted);">Project</label>
        <div style="display:flex; gap:8px; align-items:center;">
          ${record.project_number
            ? `<a href="#/projects/${record.project_id}">${Util.escapeHtml(record.project_number)}</a>`
            : `<span style="color:var(--text-muted);">Not linked to a project</span>`}
          <button type="button" class="btn" id="linkProjectBtn" style="padding:4px 10px; font-size:12.5px;">${record.project_number ? "Change" : "Link"}</button>
        </div>
      </div>
    `;
  }
  function wireLinkProjectControl(root, record, onLink) {
    const btn = root.querySelector("#linkProjectBtn");
    if (!btn) return;
    btn.onclick = async () => {
      const { projects } = await API.projects();
      Modal.open(`
        <h3>Link to a project</h3>
        <div class="field">
          <label>Project</label>
          <input id="f_linkProjectPicker" list="linkProjectOptionsList" placeholder="Search by project number, name, or client… (leave blank to unlink)" value="${record.project_number ? Util.escapeHtml(record.project_number) : ""}" autocomplete="off">
          <datalist id="linkProjectOptionsList">${projects.map((p) => `<option value="${Util.escapeHtml(p.project_number)} — ${Util.escapeHtml(p.name)} (${Util.escapeHtml(p.client_name)})">`).join("")}</datalist>
        </div>
        <div class="btn-row"><button type="button" class="btn btn-primary" id="saveLinkBtn">Save</button><button type="button" class="btn" id="cancelLinkBtn">Cancel</button></div>
      `, {
        onMount: (modal) => {
          modal.querySelector("#cancelLinkBtn").onclick = () => Modal.close();
          modal.querySelector("#saveLinkBtn").onclick = async () => {
            const val = modal.querySelector("#f_linkProjectPicker").value.trim();
            const numPart = val.split(" — ")[0].trim();
            const matched = numPart ? projects.find((p) => p.project_number === numPart) : null;
            if (val && !matched) return toastError(new Error("That doesn't match a project — pick one from the list, or clear the field to unlink."));
            try {
              await onLink(matched ? matched.id : null);
              Toast.show("Project link updated.");
              Modal.close();
            } catch (err) { toastError(err); }
          };
        },
      });
    };
  }

  // ===================== PURCHASE ORDERS =====================
  async function renderPoList(root) {
    root.innerHTML = `<div class="content">${pageHeader("Purchase Orders", `<a class="btn btn-primary" href="#/purchase-orders/new">+ New PO</a>`)}<div class="card" id="listCard">Loading…</div></div>`;
    async function load() {
      const { purchaseOrders } = await API.purchaseOrders();
      document.getElementById("listCard").innerHTML = purchaseOrders.length ? `
        <table class="clickable"><thead><tr><th>Number</th><th>Vendor</th><th>Project</th><th>Date</th><th class="num">Total</th><th>Status</th><th class="col-del"></th></tr></thead>
        <tbody>${purchaseOrders.map((p) => `
          <tr data-nav="#/purchase-orders/${p.id}">
            <td>${Util.escapeHtml(p.number)}</td><td>${Util.escapeHtml(p.vendor_name)}</td><td>${p.project_number ? Util.escapeHtml(p.project_number) : "—"}</td><td>${Util.dateStr(p.po_date)}</td>
            <td class="num">${Util.money(p.total, p.currency_code)}</td><td>${pill(p.status)}</td>
            <td class="col-del"><button type="button" class="row-delete" data-del="${p.id}" title="Delete">&times;</button></td>
          </tr>`).join("")}</tbody></table>
      ` : emptyState("No purchase orders yet.");
      wireRowNav(document.getElementById("listCard"));
      document.getElementById("listCard").querySelectorAll("[data-del]").forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm("Delete this purchase order?")) return;
          try { await API.deletePurchaseOrder(btn.dataset.del); Toast.show("Purchase order deleted."); load(); } catch (err) { toastError(err); }
        };
      });
    }
    await load();
  }

  async function renderPoForm(root) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const { vendors, items, projects } = await loadVendorsAndItems();
    const me = await API.me();
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/purchase-orders">&larr; Back to Purchase Orders</a>
      ${pageHeader("New Purchase Order")}
      <div class="card">
        <div class="grid-2">
          <div class="field"><label>Vendor *</label>${vendorSelect(vendors)}</div>
          <div class="field"><label>PO date</label><input type="date" id="f_poDate" value="${Util.todayISO()}"></div>
        </div>
        ${projectPickerHtml(null, "links this purchase to a project for cost tracking")}
        <div class="grid-2">${currencyFieldsHtml(me.org?.base_currency)}</div>
        <div class="field"><label>Lines</label><div id="lineEditor"></div></div>
        <div class="field"><label>Notes</label><textarea id="f_notes" rows="2"></textarea></div>
        <div class="btn-row"><button class="btn btn-primary" id="saveBtn">Save Purchase Order</button></div>
      </div>
    </div>`;
    const editor = LineItemsEditor(document.getElementById("lineEditor"), { items, includeDiscount: false });
    const projectPicker = wireProjectPicker(projects, consumePrefillProjectId());
    document.getElementById("saveBtn").onclick = async () => {
      const vendorId = document.getElementById("f_vendorId").value;
      if (!vendorId) return toastError(new Error("Please select a vendor."));
      try {
        const saved = await API.createPurchaseOrder({ vendorId, projectId: projectPicker.getProjectId(), poDate: document.getElementById("f_poDate").value, notes: document.getElementById("f_notes").value.trim(), lines: editor.getLines(), ...readCurrencyFields() });
        Toast.show("Purchase order saved.");
        location.hash = `#/purchase-orders/${saved.purchaseOrder.id}`;
      } catch (err) { toastError(err); }
    };
  }

  async function renderPoDetail(root, id) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const { purchaseOrder, lines } = await API.purchaseOrder(id);
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/purchase-orders">&larr; Back to Purchase Orders</a>
      ${pageHeader(purchaseOrder.number, poActions(purchaseOrder))}
      <div class="card">
        <div class="grid-2"><div><label>Vendor</label><div>${Util.escapeHtml(purchaseOrder.vendor_name)}</div></div><div><label>Date</label><div>${Util.dateStr(purchaseOrder.po_date)}</div></div></div>
        ${linkProjectControlHtml(purchaseOrder)}
        <table style="margin-top:14px;"><thead><tr><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price</th><th class="num">VAT</th></tr></thead>
        <tbody>${lines.map((l) => `<tr><td>${Util.escapeHtml(l.description)}</td><td class="num">${l.qty}</td><td>${Util.escapeHtml(l.unit || "—")}</td><td class="num">${Util.money(l.unit_price)}</td><td class="num">${l.vat_rate}%</td></tr>`).join("")}</tbody></table>
        <div class="totals-box"><div class="row"><span>Subtotal</span><span>${Util.money(purchaseOrder.subtotal)}</span></div><div class="row"><span>VAT</span><span>${Util.money(purchaseOrder.vat_total)}</span></div><div class="row total"><span>Total</span><span>${Util.money(purchaseOrder.total, purchaseOrder.currency_code)}</span></div></div>
      </div>
    </div>`;
    const convertBtn = root.querySelector("#convertBtn");
    if (convertBtn) convertBtn.onclick = async () => {
      try { const { bill } = await API.convertPoToBill(id); Toast.show("Converted to bill " + bill.number); location.hash = `#/bills/${bill.id}`; } catch (err) { toastError(err); }
    };
    const statusBtns = root.querySelectorAll("[data-status]");
    statusBtns.forEach((b) => b.onclick = async () => { try { await API.poStatus(id, b.dataset.status); Toast.show("Status updated."); renderPoDetail(root, id); } catch (err) { toastError(err); } });
    wireLinkProjectControl(root, purchaseOrder, async (projectId) => { await API.linkPoToProject(id, projectId); renderPoDetail(root, id); });
  }
  function poActions(po) {
    let html = "";
    if (po.status === "draft") html += `<button class="btn" data-status="sent">Mark Sent</button>`;
    if (["draft", "sent"].includes(po.status)) html += ` <button class="btn btn-primary" id="convertBtn">Convert to Bill</button>`;
    return html;
  }

  // ===================== BILLS =====================
  async function renderBillList(root) {
    root.innerHTML = `<div class="content">${pageHeader("Bills", `<a class="btn btn-primary" href="#/bills/new">+ New Bill</a>`)}<div class="card" id="listCard">Loading…</div></div>`;
    async function load() {
      const { bills } = await API.bills();
      document.getElementById("listCard").innerHTML = bills.length ? `
        <table class="clickable"><thead><tr><th>Number</th><th>Vendor</th><th>Project</th><th>Date</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th><th class="col-del"></th></tr></thead>
        <tbody>${bills.map((b) => `
          <tr data-nav="#/bills/${b.id}">
            <td>${Util.escapeHtml(b.number)}</td><td>${Util.escapeHtml(b.vendor_name)}</td><td>${b.project_number ? Util.escapeHtml(b.project_number) : "—"}</td><td>${Util.dateStr(b.bill_date)}</td>
            <td class="num">${Util.money(b.total, b.currency_code)}</td><td class="num">${Util.money(b.balance, b.currency_code)}</td><td>${pill(b.status)}</td>
            <td class="col-del"><button type="button" class="row-delete" data-del="${b.id}" title="Delete">&times;</button></td>
          </tr>`).join("")}</tbody></table>
      ` : emptyState("No bills yet.");
      wireRowNav(document.getElementById("listCard"));
      document.getElementById("listCard").querySelectorAll("[data-del]").forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm("Delete this draft bill?")) return;
          try { await API.deleteBill(btn.dataset.del); Toast.show("Bill deleted."); load(); } catch (err) { toastError(err); }
        };
      });
    }
    await load();
  }

  async function renderBillForm(root) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const { vendors, items, projects } = await loadVendorsAndItems();
    const { accounts } = await API.accounts();
    const me = await API.me();
    const expenseAccounts = accounts.filter((a) => a.type === "expense");
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/bills">&larr; Back to Bills</a>
      ${pageHeader("New Bill")}
      <div class="card">
        <div class="grid-3">
          <div class="field"><label>Vendor *</label>${vendorSelect(vendors)}</div>
          <div class="field"><label>Vendor's bill ref</label><input id="f_vendorRef"></div>
          <div class="field"><label>Bill date</label><input type="date" id="f_billDate" value="${Util.todayISO()}"></div>
        </div>
        ${projectPickerHtml(null, "links this cost to a project so it shows as a direct cost there")}
        <div class="grid-3">
          <div class="field"><label>Due date</label><input type="date" id="f_dueDate"></div>
          ${currencyFieldsHtml(me.org?.base_currency)}
        </div>
        <div class="field"><label>Lines <span style="font-weight:400; color:var(--text-muted);">— pick an inventory item to restock it, or an expense account for a plain cost</span></label><div id="lineEditor"></div></div>
        <div class="field"><label>Notes</label><textarea id="f_notes" rows="2"></textarea></div>
        <div class="btn-row"><button class="btn btn-primary" id="saveBtn">Save Bill</button></div>
      </div>
    </div>`;
    const editor = LineItemsEditor(document.getElementById("lineEditor"), { items, includeDiscount: false, expenseAccounts });
    const projectPicker = wireProjectPicker(projects, consumePrefillProjectId());
    document.getElementById("saveBtn").onclick = async () => {
      const vendorId = document.getElementById("f_vendorId").value;
      if (!vendorId) return toastError(new Error("Please select a vendor."));
      try {
        const saved = await API.createBill({
          vendorId, projectId: projectPicker.getProjectId(), vendorRef: document.getElementById("f_vendorRef").value.trim(), billDate: document.getElementById("f_billDate").value,
          dueDate: document.getElementById("f_dueDate").value || null, notes: document.getElementById("f_notes").value.trim(), lines: editor.getLines(),
          ...readCurrencyFields(),
        });
        Toast.show("Bill saved as draft.");
        location.hash = `#/bills/${saved.bill.id}`;
      } catch (err) { toastError(err); }
    };
  }

  async function renderBillDetail(root, id) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const { bill, lines, payments } = await API.bill(id);
    const balance = Number(bill.total) - Number(bill.amount_paid);
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/bills">&larr; Back to Bills</a>
      ${pageHeader(bill.number, billActions(bill, balance))}
      <div class="card">
        <div class="grid-3">
          <div><label>Vendor</label><div>${Util.escapeHtml(bill.vendor_name)}</div></div>
          <div><label>Date</label><div>${Util.dateStr(bill.bill_date)}</div></div>
          <div><label>Balance due</label><div><strong>${Util.money(balance, bill.currency_code)}</strong></div></div>
        </div>
        ${linkProjectControlHtml(bill)}
        <table style="margin-top:14px;"><thead><tr><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price</th><th class="num">VAT</th></tr></thead>
        <tbody>${lines.map((l) => `<tr><td>${Util.escapeHtml(l.description)}</td><td class="num">${l.qty}</td><td>${Util.escapeHtml(l.unit || "—")}</td><td class="num">${Util.money(l.unit_price)}</td><td class="num">${l.vat_rate}%</td></tr>`).join("")}</tbody></table>
        <div class="totals-box"><div class="row"><span>Subtotal</span><span>${Util.money(bill.subtotal)}</span></div><div class="row"><span>VAT</span><span>${Util.money(bill.vat_total)}</span></div><div class="row total"><span>Total</span><span>${Util.money(bill.total, bill.currency_code)}</span></div></div>
      </div>
      ${payments.length ? `<div class="card"><h2>Payments</h2><table><thead><tr><th>Date</th><th class="num">Amount</th><th>Reference</th></tr></thead>
        <tbody>${payments.map((p) => `<tr><td>${Util.dateStr(p.payment_date)}</td><td class="num">${Util.money(p.amount, p.currency_code)}</td><td>${Util.escapeHtml(p.reference || "—")}</td></tr>`).join("")}</tbody></table></div>` : ""}
    </div>`;
    const openBtn = root.querySelector("#openBtn");
    if (openBtn) openBtn.onclick = async () => { try { await API.openBill(id); Toast.show("Bill recorded to the ledger."); renderBillDetail(root, id); } catch (err) { toastError(err); } };
    const payBtn = root.querySelector("#payBtn");
    if (payBtn) payBtn.onclick = () => openBillPaymentModal(bill, balance, () => renderBillDetail(root, id));
    wireLinkProjectControl(root, bill, async (projectId) => { await API.linkBillToProject(id, projectId); renderBillDetail(root, id); });
  }
  function billActions(bill, balance) {
    let html = "";
    if (bill.status === "draft") html += `<button class="btn btn-primary" id="openBtn">Record to Ledger</button>`;
    if (["open", "partially_paid"].includes(bill.status) && balance > 0.009) html += ` <button class="btn btn-primary" id="payBtn">Record Payment</button>`;
    return html;
  }
  function openBillPaymentModal(bill, balance, onSaved) {
    Modal.open(`
      <h3>Record payment — ${Util.escapeHtml(bill.number)}</h3>
      <div class="field"><label>Balance due</label><div>${Util.money(balance, bill.currency_code)}</div></div>
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
            await API.recordBillPayment(bill.id, { amount: Number(modal.querySelector("#f_amount").value), paymentDate: modal.querySelector("#f_date").value, reference: modal.querySelector("#f_reference").value.trim() });
            Toast.show("Payment recorded."); Modal.close(); onSaved && onSaved();
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  return { renderPoList, renderPoForm, renderPoDetail, renderBillList, renderBillForm, renderBillDetail };
})();
