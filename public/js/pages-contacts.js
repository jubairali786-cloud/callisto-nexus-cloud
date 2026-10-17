const ContactPages = (() => {
  function contactFormHtml(c) {
    c = c || {};
    return `
      <div class="field-row">
        <div class="field"><label>Name *</label><input id="f_name" value="${Util.escapeHtml(c.name || "")}" required></div>
        <div class="field"><label>Company Name</label><input id="f_companyName" value="${Util.escapeHtml(c.company_name || "")}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Email</label><input id="f_email" type="email" value="${Util.escapeHtml(c.email || "")}"></div>
        <div class="field"><label>Phone</label><input id="f_phone" value="${Util.escapeHtml(c.phone || "")}"></div>
        <div class="field"><label>Tel Number <span style="font-weight:400; color:var(--text-muted);">(landline)</span></label><input id="f_tel" value="${Util.escapeHtml(c.tel || "")}"></div>
      </div>
      <div class="field"><label>Address</label><textarea id="f_address" rows="2">${Util.escapeHtml(c.address || "")}</textarea></div>
      <div class="field-row">
        <div class="field"><label>TRN</label><input id="f_trn" value="${Util.escapeHtml(c.trn || "")}"></div>
        <div class="field"><label>Default currency</label><input id="f_defaultCurrency" placeholder="AED" value="${Util.escapeHtml(c.default_currency || "")}"></div>
      </div>
      <div class="field"><label>Notes</label><textarea id="f_notes" rows="2">${Util.escapeHtml(c.notes || "")}</textarea></div>
    `;
  }
  function readContactForm(modal) {
    return {
      name: modal.querySelector("#f_name").value.trim(),
      companyName: modal.querySelector("#f_companyName").value.trim(),
      email: modal.querySelector("#f_email").value.trim(),
      phone: modal.querySelector("#f_phone").value.trim(),
      tel: modal.querySelector("#f_tel").value.trim(),
      address: modal.querySelector("#f_address").value.trim(),
      trn: modal.querySelector("#f_trn").value.trim(),
      defaultCurrency: modal.querySelector("#f_defaultCurrency").value.trim(),
      notes: modal.querySelector("#f_notes").value.trim(),
    };
  }

  function openContactModal(kind, existing, onSaved) {
    const label = kind === "client" ? "Client" : "Vendor";
    Modal.open(`
      <h3>${existing ? "Edit" : "New"} ${label}</h3>
      <form id="contactForm">${contactFormHtml(existing)}
        <div class="btn-row"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
      </form>
    `, {
      onMount: (modal) => {
        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#contactForm").onsubmit = async (e) => {
          e.preventDefault();
          try {
            const body = readContactForm(modal);
            if (existing) {
              kind === "client" ? await API.updateClient(existing.id, body) : await API.updateVendor(existing.id, body);
            } else {
              kind === "client" ? await API.createClient(body) : await API.createVendor(body);
            }
            Toast.show(`${label} saved.`);
            Modal.close();
            onSaved && onSaved();
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  async function renderList(root, kind) {
    const label = kind === "client" ? "Clients" : "Vendors";
    root.innerHTML = `<div class="content">${pageHeader(label, `<button class="btn btn-primary" id="newBtn">+ New ${kind === "client" ? "Client" : "Vendor"}</button>`)}<div class="card" id="listCard">Loading…</div></div>`;
    async function load() {
      const data = kind === "client" ? await API.clients() : await API.vendors();
      const rows = kind === "client" ? data.clients : data.vendors;
      document.getElementById("listCard").innerHTML = rows.length ? `
        <table class="clickable"><thead><tr><th>Name</th><th>Company Name</th><th>Email</th><th>Phone</th><th>TRN</th><th class="col-del"></th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr data-nav="#/${kind === "client" ? "clients" : "vendors"}/${r.id}">
            <td>${Util.escapeHtml(r.name)}</td><td>${Util.escapeHtml(r.company_name || "—")}</td><td>${Util.escapeHtml(r.email || "—")}</td><td>${Util.escapeHtml(r.phone || "—")}</td><td>${Util.escapeHtml(r.trn || "—")}</td>
            <td class="col-del"><button type="button" class="row-delete" data-del="${r.id}" title="Delete">&times;</button></td>
          </tr>`).join("")}</tbody></table>
      ` : emptyState(`No ${label.toLowerCase()} yet.`);
      wireRowNav(document.getElementById("listCard"));
      document.getElementById("listCard").querySelectorAll("[data-del]").forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete this ${kind}? This cannot be undone.`)) return;
          try {
            kind === "client" ? await API.deleteClient(btn.dataset.del) : await API.deleteVendor(btn.dataset.del);
            Toast.show(`${label.slice(0, -1)} deleted.`);
            load();
          } catch (err) { toastError(err); }
        };
      });
    }
    root.querySelector("#newBtn").onclick = () => openContactModal(kind, null, load);
    await load();
  }

  async function renderDetail(root, kind, id) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const data = kind === "client" ? await API.client(id) : await API.vendor(id);
    const c = kind === "client" ? data.client : data.vendor;
    const backHref = kind === "client" ? "#/clients" : "#/vendors";
    let relatedHtml = "";
    if (kind === "client") {
      const inv = await API.invoices();
      const mine = inv.invoices.filter((i) => i.client_name === c.name);
      relatedHtml = mine.length ? `
        <div class="card"><h2>Invoices</h2>
        <table class="clickable"><thead><tr><th>Number</th><th>Date</th><th class="num">Total</th><th>Status</th></tr></thead>
        <tbody>${mine.map((i) => `<tr data-nav="#/invoices/${i.id}"><td>${Util.escapeHtml(i.number)}</td><td>${Util.dateStr(i.invoice_date)}</td><td class="num">${Util.money(i.total, i.currency_code)}</td><td>${pill(i.status)}</td></tr>`).join("")}</tbody></table>
        </div>` : "";
    } else {
      const bills = await API.bills();
      const mine = bills.bills.filter((b) => b.vendor_name === c.name);
      relatedHtml = mine.length ? `
        <div class="card"><h2>Bills</h2>
        <table class="clickable"><thead><tr><th>Number</th><th>Date</th><th class="num">Total</th><th>Status</th></tr></thead>
        <tbody>${mine.map((b) => `<tr data-nav="#/bills/${b.id}"><td>${Util.escapeHtml(b.number)}</td><td>${Util.dateStr(b.bill_date)}</td><td class="num">${Util.money(b.total, b.currency_code)}</td><td>${pill(b.status)}</td></tr>`).join("")}</tbody></table>
        </div>` : "";
    }
    root.innerHTML = `<div class="content">
      <a class="back-link" href="${backHref}">&larr; Back to ${kind === "client" ? "Clients" : "Vendors"}</a>
      ${pageHeader(c.name, `<button class="btn" id="editBtn">Edit</button>`)}
      <div class="card">
        <div class="grid-2">
          <div><label>Company Name</label><div>${Util.escapeHtml(c.company_name || "—")}</div></div>
          <div><label>Email</label><div>${Util.escapeHtml(c.email || "—")}</div></div>
          <div><label>Phone</label><div>${Util.escapeHtml(c.phone || "—")}</div></div>
          <div><label>Tel Number</label><div>${Util.escapeHtml(c.tel || "—")}</div></div>
          <div><label>TRN</label><div>${Util.escapeHtml(c.trn || "—")}</div></div>
          <div><label>Default currency</label><div>${Util.escapeHtml(c.default_currency || "—")}</div></div>
        </div>
        ${c.address ? `<div style="margin-top:10px;"><label>Address</label><div>${Util.escapeHtml(c.address)}</div></div>` : ""}
        ${c.notes ? `<div style="margin-top:10px;"><label>Notes</label><div>${Util.escapeHtml(c.notes)}</div></div>` : ""}
      </div>
      ${relatedHtml}
    </div>`;
    wireRowNav(root);
    root.querySelector("#editBtn").onclick = () => openContactModal(kind, c, () => renderDetail(root, kind, id));
  }

  return { renderList, renderDetail };
})();
