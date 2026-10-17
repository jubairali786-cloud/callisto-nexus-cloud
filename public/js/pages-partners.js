// Investment & Partners: partner roster + capital transactions, share transfers (sale
// between partners vs new investment into the company), a consolidated dashboard built
// from the existing Sales/Purchases/Banking/Ledger data (never duplicate manual entry),
// and profit-allocation estimates that are never auto-paid or auto-posted.
const PartnerPages = (() => {
  const TXN_LABELS = {
    contribution: "Capital contribution", loan: "Loan provided (to company)",
    withdrawal: "Capital withdrawal", loan_repayment: "Loan repaid (to partner)",
    distribution: "Profit distribution",
  };
  const TXN_OPTIONS = Object.entries(TXN_LABELS).map(([value, label]) => ({ value, label }));

  function money(n) { return Util.money(n, "AED"); }

  // -------- Excel export: an HTML table served with an .xls extension/MIME type opens
  // directly in Excel (and Google Sheets) with no extra dependency needed in this app. --------
  function exportRowsAsExcel(filename, title, headers, rows) {
    const esc = (s) => Util.escapeHtml(String(s ?? ""));
    const html = `<html><head><meta charset="utf-8"></head><body>
      <h3>${esc(title)}</h3>
      <table border="1">
        <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </body></html>`;
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function printPartnerStatement(partner, transactions, ownershipHistory, org) {
    const rows = transactions.map((t) => `<tr>
      <td>${Util.dateStr(t.txn_date)}</td><td>${Util.escapeHtml(TXN_LABELS[t.txn_type] || t.txn_type)}</td>
      <td class="num">${money(t.amount)}</td><td>${Util.escapeHtml(t.reference || "—")}</td><td>${Util.escapeHtml(t.notes || "—")}</td>
    </tr>`).join("");
    const histRows = ownershipHistory.map((h) => `<tr><td>${Util.dateStr(h.effective_date)}</td><td class="num">${Number(h.ownership_pct)}%</td></tr>`).join("");
    const logo = (org && org.logo_b64) ? `data:image/png;base64,${org.logo_b64}` : `data:image/png;base64,${window.LOGO_B64}`;
    const html = `<div class="doc-page">
      <div class="doc-head">
        <div class="co"><img src="${logo}" alt="logo"><div>
          <div class="co-name">${Util.escapeHtml(org?.name || "Callisto Nexus Technical Services L.L.C.")}</div>
          <div class="co-sub">${Util.escapeHtml(org?.address || "")}</div>
        </div></div>
        <div class="doc-title"><h2>PARTNER STATEMENT</h2>
          <div class="doc-meta">Partner: ${Util.escapeHtml(partner.name)}</div>
          <div class="doc-meta">As of: ${Util.dateStr(Util.todayISO())}</div>
          <div class="doc-meta">Current ownership: <strong>${Number(partner.ownership_pct)}%</strong></div>
        </div>
      </div>
      <div class="doc-totals" style="margin-top:6px;">
        <div class="row"><span>Capital contributed</span><span>${money(partner.capitalContributed)}</span></div>
        <div class="row"><span>Loans provided (outstanding)</span><span>${money(partner.loanOutstanding)}</span></div>
        <div class="row"><span>Capital withdrawn</span><span>${money(partner.withdrawals)}</span></div>
        <div class="row grand"><span>Profit distributions received</span><span>${money(partner.distributionsReceived)}</span></div>
      </div>
      <div class="doc-meta" style="margin-top:16px;"><strong>Ownership history</strong></div>
      <table class="doc-table"><thead><tr><th>Effective date</th><th class="num">Ownership %</th></tr></thead><tbody>${histRows}</tbody></table>
      <div class="doc-meta" style="margin-top:16px;"><strong>Transaction history</strong></div>
      <table class="doc-table"><thead><tr><th>Date</th><th>Type</th><th class="num">Amount</th><th>Reference</th><th>Notes</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No transactions recorded.</td></tr>`}</tbody></table>
      <div class="doc-foot">This statement reflects internal company records only and is not an audited or guaranteed figure.</div>
    </div>`;
    PrintDoc.openPrintWindow(html);
  }

  // -------- Partner list --------
  async function renderList(root) {
    root.innerHTML = `<div class="content">${pageHeader("Partners", `<button class="btn btn-primary" id="newPartnerBtn">+ New Partner</button>`)}<div id="body">Loading…</div></div>`;
    document.getElementById("newPartnerBtn").onclick = () => partnerModal(null, () => renderList(root));
    const body = document.getElementById("body");
    try {
      const { partners, totalActiveOwnership } = await API.partners();
      const warn = Math.abs(totalActiveOwnership - 100) > 0.05
        ? `<div class="card" style="border-color:var(--warn); background:var(--warn-bg); color:var(--warn);">Active partner ownership currently totals <strong>${totalActiveOwnership}%</strong>, not 100%. ${totalActiveOwnership < 100 ? "Add or adjust partners until it reconciles." : ""}</div>` : "";
      body.innerHTML = warn + `<div class="card"><table class="clickable">
        <thead><tr><th>Partner</th><th class="num">Ownership</th><th class="num">Capital contributed</th><th class="num">Loan outstanding</th><th class="num">Withdrawals</th><th class="num">Distributions received</th><th>Status</th></tr></thead>
        <tbody>${partners.length ? partners.map((p) => `
          <tr data-nav="#/partners/${p.id}">
            <td>${Util.escapeHtml(p.name)}</td><td class="num">${Number(p.ownership_pct)}%</td>
            <td class="num">${money(p.capitalContributed)}</td><td class="num">${money(p.loanOutstanding)}</td>
            <td class="num">${money(p.withdrawals)}</td><td class="num">${money(p.distributionsReceived)}</td>
            <td>${pill(p.status)}</td>
          </tr>`).join("") : `<tr><td colspan="7">${emptyState("No partners yet. Add your first partner to get started.")}</td></tr>`}</tbody>
      </table></div>`;
      wireRowNav(body);
    } catch (e) { toastError(e); body.innerHTML = emptyState("Could not load partners."); }
  }

  function partnerModal(partner, onSaved) {
    const isEdit = !!partner;
    Modal.open(`<h3>${isEdit ? "Edit Partner" : "New Partner"}</h3><form id="pForm">
      <div class="field"><label>Name *</label><input id="f_name" required value="${isEdit ? Util.escapeHtml(partner.name) : ""}"></div>
      <div class="field-row">
        <div class="field"><label>Email</label><input id="f_email" value="${isEdit ? Util.escapeHtml(partner.email || "") : ""}"></div>
        <div class="field"><label>Phone</label><input id="f_phone" value="${isEdit ? Util.escapeHtml(partner.phone || "") : ""}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Ownership % *</label><input id="f_ownership" type="number" step="0.001" min="0" max="100" value="${isEdit ? Number(partner.ownership_pct) : ""}"></div>
        <div class="field"><label>Profit-share % <span style="font-weight:400;">(blank = use ownership %)</span></label><input id="f_profitshare" type="number" step="0.001" min="0" max="100" value="${isEdit && partner.profit_share_pct != null ? Number(partner.profit_share_pct) : ""}"></div>
      </div>
      ${isEdit ? `<div class="field"><label>Status</label><select id="f_status"><option value="active" ${partner.status === "active" ? "selected" : ""}>Active</option><option value="inactive" ${partner.status === "inactive" ? "selected" : ""}>Inactive</option></select></div>` : ""}
      <div class="field"><label>Notes</label><textarea id="f_notes">${isEdit ? Util.escapeHtml(partner.notes || "") : ""}</textarea></div>
      <div class="btn-row"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
    </form>`, {
      onMount: (modal) => {
        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#pForm").onsubmit = async (e) => {
          e.preventDefault();
          const body = {
            name: modal.querySelector("#f_name").value.trim(),
            email: modal.querySelector("#f_email").value.trim(),
            phone: modal.querySelector("#f_phone").value.trim(),
            ownershipPct: modal.querySelector("#f_ownership").value,
            profitSharePct: modal.querySelector("#f_profitshare").value,
            notes: modal.querySelector("#f_notes").value.trim(),
          };
          if (isEdit) body.status = modal.querySelector("#f_status").value;
          try {
            if (isEdit) await API.updatePartner(partner.id, body); else await API.createPartner(body);
            Modal.close(); Toast.show(isEdit ? "Partner updated." : "Partner added."); onSaved();
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  function transactionModal(partner, onSaved) {
    Modal.open(`<h3>Record Transaction — ${Util.escapeHtml(partner.name)}</h3><form id="tForm">
      <div class="field"><label>Type *</label>${selectHtml("f_type", TXN_OPTIONS, "contribution")}</div>
      <div class="field-row">
        <div class="field"><label>Amount (AED) *</label><input id="f_amount" type="number" step="0.01" min="0.01" required></div>
        <div class="field"><label>Date</label><input id="f_date" type="date" value="${Util.todayISO()}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Method</label><select id="f_method"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="card">Card</option><option value="other">Other</option></select></div>
        <div class="field"><label>Reference</label><input id="f_reference" placeholder="optional"></div>
      </div>
      <div class="field"><label>Notes</label><textarea id="f_notes" placeholder="optional"></textarea></div>
      <div class="btn-row"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
    </form>`, {
      onMount: (modal) => {
        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#tForm").onsubmit = async (e) => {
          e.preventDefault();
          try {
            await API.recordPartnerTransaction(partner.id, {
              txnType: modal.querySelector("#f_type").value,
              amount: modal.querySelector("#f_amount").value,
              txnDate: modal.querySelector("#f_date").value,
              method: modal.querySelector("#f_method").value,
              reference: modal.querySelector("#f_reference").value.trim(),
              notes: modal.querySelector("#f_notes").value.trim(),
            });
            Modal.close(); Toast.show("Transaction recorded."); onSaved();
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  // -------- Partner detail --------
  async function renderDetail(root, id) {
    root.innerHTML = `<div class="content">${pageHeader("Partner", `<a href="#/partners" class="btn btn-sm">← Back to Partners</a>`)}<div id="body">Loading…</div></div>`;
    const body = document.getElementById("body");
    try {
      const [{ partner, transactions, shareTransfers, ownershipHistory }, me] = await Promise.all([API.partner(id), API.me()]);
      const render = () => {
        body.innerHTML = `
          <div class="detail-header"><h1 style="font-size:18px;">${Util.escapeHtml(partner.name)} ${pill(partner.status)}</h1>
            <div class="btn-row">
              <button class="btn btn-sm" id="editBtn">Edit</button>
              <button class="btn btn-sm btn-primary" id="txnBtn">+ Record Transaction</button>
              <button class="btn btn-sm" id="printBtn">Print statement</button>
              <button class="btn btn-sm" id="xlsBtn">Export to Excel</button>
            </div>
          </div>
          <div class="grid-4" style="margin-bottom:16px;">
            <div class="stat-box"><div class="label">Ownership</div><div class="value">${Number(partner.ownership_pct)}%</div></div>
            <div class="stat-box"><div class="label">Capital contributed</div><div class="value">${money(partner.capitalContributed)}</div></div>
            <div class="stat-box"><div class="label">Loan outstanding</div><div class="value">${money(partner.loanOutstanding)}</div></div>
            <div class="stat-box"><div class="label">Distributions received</div><div class="value">${money(partner.distributionsReceived)}</div></div>
          </div>
          ${partner.profit_share_pct != null ? `<div class="card">Agreed profit-sharing ratio: <strong>${Number(partner.profit_share_pct)}%</strong> (overrides ownership % for profit allocation)</div>` : ""}
          ${partner.notes ? `<div class="card"><strong>Notes:</strong> ${Util.escapeHtml(partner.notes)}</div>` : ""}
          <div class="card"><h2>Ownership history</h2>
            <table><thead><tr><th>Effective date</th><th class="num">Ownership %</th></tr></thead>
            <tbody>${ownershipHistory.map((h) => `<tr><td>${Util.dateStr(h.effective_date)}</td><td class="num">${Number(h.ownership_pct)}%</td></tr>`).join("")}</tbody></table>
          </div>
          <div class="card"><h2>Share transfers</h2>
            ${shareTransfers.length ? `<table><thead><tr><th>Date</th><th>Type</th><th>Counterparty</th><th class="num">%</th><th class="num">Price</th><th>Payment</th></tr></thead>
              <tbody>${shareTransfers.map((s) => `<tr><td>${Util.dateStr(s.effective_date)}</td><td>${s.transfer_type === "share_sale" ? "Share sale" : "New investment"}</td>
                <td>${Util.escapeHtml(s.seller_name && s.seller_partner_id === partner.id ? s.buyer_name : (s.buyer_name || s.seller_name || "—"))}</td>
                <td class="num">${Number(s.pct_transferred)}%</td><td class="num">${s.sale_price != null ? money(s.sale_price) : "—"}</td><td>${pill(s.payment_status)}</td></tr>`).join("")}</tbody></table>`
              : emptyState("No share transfers involving this partner.")}
          </div>
          <div class="card"><h2>Transactions</h2>
            ${transactions.length ? `<table><thead><tr><th>Date</th><th>Type</th><th class="num">Amount</th><th>Reference</th><th>Notes</th><th></th></tr></thead>
              <tbody>${transactions.map((t) => `<tr><td>${Util.dateStr(t.txn_date)}</td><td>${Util.escapeHtml(TXN_LABELS[t.txn_type] || t.txn_type)}</td>
                <td class="num">${money(t.amount)}</td><td>${Util.escapeHtml(t.reference || "—")}</td><td>${Util.escapeHtml(t.notes || "—")}</td>
                <td><button class="btn btn-sm btn-danger" data-del="${t.id}">Delete</button></td></tr>`).join("")}</tbody></table>`
              : emptyState("No transactions recorded yet.")}
          </div>
        `;
        body.querySelector("#editBtn").onclick = () => partnerModal(partner, () => renderDetail(root, id));
        body.querySelector("#txnBtn").onclick = () => transactionModal(partner, () => renderDetail(root, id));
        body.querySelector("#printBtn").onclick = () => printPartnerStatement(partner, transactions, ownershipHistory, me.org);
        body.querySelector("#xlsBtn").onclick = () => exportRowsAsExcel(`${partner.name.replace(/\s+/g, "_")}_statement`, `Partner statement — ${partner.name}`,
          ["Date", "Type", "Amount (AED)", "Reference", "Notes"],
          transactions.map((t) => [Util.dateStr(t.txn_date), TXN_LABELS[t.txn_type] || t.txn_type, Number(t.amount), t.reference || "", t.notes || ""]));
        body.querySelectorAll("[data-del]").forEach((btn) => btn.onclick = async () => {
          if (!confirm("Delete this transaction? This reverses its accounting entry.")) return;
          try { await API.deletePartnerTransaction(btn.dataset.del); Toast.show("Transaction removed."); renderDetail(root, id); } catch (err) { toastError(err); }
        });
      };
      render();
    } catch (e) { toastError(e); body.innerHTML = emptyState("Could not load partner."); }
  }

  // -------- Share transfers --------
  async function renderShareTransfers(root) {
    root.innerHTML = `<div class="content">${pageHeader("Share Transfers", `<button class="btn btn-primary" id="newBtn">+ New Share Transfer</button>`)}<div id="body">Loading…</div></div>`;
    const body = document.getElementById("body");
    async function load() {
      try {
        const [{ shareTransfers }, { partners }] = await Promise.all([API.shareTransfers(), API.partners()]);
        body.innerHTML = `<div class="card"><table>
          <thead><tr><th>Date</th><th>Type</th><th>Seller</th><th>Buyer</th><th class="num">%</th><th class="num">Price</th><th>Payment</th><th>Notes</th></tr></thead>
          <tbody>${shareTransfers.length ? shareTransfers.map((s) => `<tr>
            <td>${Util.dateStr(s.effective_date)}</td><td>${s.transfer_type === "share_sale" ? "Share sale" : "New investment"}</td>
            <td>${Util.escapeHtml(s.seller_name || "— (company)")}</td><td>${Util.escapeHtml(s.buyer_name)}</td>
            <td class="num">${Number(s.pct_transferred)}%</td><td class="num">${s.sale_price != null ? money(s.sale_price) : "—"}</td>
            <td>${pill(s.payment_status)}</td><td>${Util.escapeHtml(s.notes || "—")}</td></tr>`).join("") : `<tr><td colspan="8">${emptyState("No share transfers recorded.")}</td></tr>`}</tbody>
        </table></div>`;
        document.getElementById("newBtn").onclick = () => shareTransferModal(partners, load);
      } catch (e) { toastError(e); body.innerHTML = emptyState("Could not load share transfers."); }
    }
    document.getElementById("newBtn").onclick = async () => { const { partners } = await API.partners(); shareTransferModal(partners, load); };
    await load();
  }

  function shareTransferModal(allPartners, onSaved) {
    const activePartners = allPartners.filter((p) => p.status === "active");
    const partnerOptions = activePartners.map((p) => ({ value: p.id, label: `${p.name} (${Number(p.ownership_pct)}%)` }));
    const buyerOptions = partnerOptions.concat([{ value: "__new__", label: "+ New partner joining" }]);

    Modal.open(`<h3>New Share Transfer</h3><form id="stForm">
      <div class="field"><label>Type *</label>${selectHtml("f_type", [
        { value: "share_sale", label: "Sale of an existing partner's shares (money is personal, doesn't touch company capital)" },
        { value: "new_investment", label: "New investment into the company (money goes into the company)" },
      ], "share_sale")}</div>
      <div class="field" id="sellerField"><label>Selling partner *</label>${selectHtml("f_seller", partnerOptions, "", "— select —")}</div>
      <div class="field"><label>Buyer *</label>${selectHtml("f_buyer", buyerOptions, "", "— select —")}</div>
      <div class="field" id="newNameField" style="display:none;"><label>New partner's name *</label><input id="f_newName"></div>
      <div class="field-row">
        <div class="field"><label>Percentage transferred *</label><input id="f_pct" type="number" step="0.001" min="0.001" max="100"></div>
        <div class="field"><label>Sale / investment price (AED)</label><input id="f_price" type="number" step="0.01" min="0"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Effective date</label><input id="f_date" type="date" value="${Util.todayISO()}"></div>
        <div class="field" id="statusField"><label>Payment status</label><select id="f_status"><option value="unpaid">Unpaid</option><option value="partially_paid">Partially paid</option><option value="paid">Paid</option></select></div>
      </div>
      <div id="newInvestmentFields" style="display:none;">
        <div class="field">
          <label>Confirmed ownership after this investment (must total 100% — not auto-calculated, enter the agreed figures)</label>
          <div id="ownershipTable"></div>
          <div id="ownershipTotalMsg" style="font-size:12px; margin-top:6px; color:var(--text-muted);"></div>
        </div>
      </div>
      <div class="field"><label>Notes</label><textarea id="f_notes" placeholder="optional"></textarea></div>
      <div class="btn-row"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
    </form>`, {
      onMount: (modal) => {
        const typeSel = modal.querySelector("#f_type");
        const buyerSel = modal.querySelector("#f_buyer");
        const sellerField = modal.querySelector("#sellerField");
        const newNameField = modal.querySelector("#newNameField");
        const newInvFields = modal.querySelector("#newInvestmentFields");
        const statusField = modal.querySelector("#statusField");
        const ownTableEl = modal.querySelector("#ownershipTable");
        const ownTotalMsg = modal.querySelector("#ownershipTotalMsg");

        function renderOwnershipTable() {
          const isNewBuyer = buyerSel.value === "__new__";
          const newName = modal.querySelector("#f_newName").value.trim() || "New partner";
          const list = activePartners.map((p) => ({ id: p.id, name: p.name, pct: Number(p.ownership_pct) }));
          if (isNewBuyer) list.push({ id: "__new__", name: newName, pct: 0 });
          ownTableEl.innerHTML = list.map((p) => `
            <div class="field-row" style="align-items:center;">
              <div style="flex:2; font-size:13.5px;">${Util.escapeHtml(p.name)}</div>
              <div class="field" style="flex:1; margin-bottom:0;"><input data-own="${p.id}" type="number" step="0.001" min="0" max="100" value="${p.pct}"></div>
            </div>`).join("");
          wireOwnershipInputs();
        }
        function wireOwnershipInputs() {
          const inputs = ownTableEl.querySelectorAll("[data-own]");
          function updateTotal() {
            const total = Array.from(inputs).reduce((s, i) => s + (Number(i.value) || 0), 0);
            const t = Math.round(total * 1000) / 1000;
            ownTotalMsg.textContent = `Total: ${t}%` + (Math.abs(t - 100) > 0.05 ? " — must equal 100% to save" : " ✓");
            ownTotalMsg.style.color = Math.abs(t - 100) > 0.05 ? "var(--bad)" : "var(--good)";
          }
          inputs.forEach((i) => i.oninput = updateTotal);
          updateTotal();
        }
        function syncMode() {
          const isNewInvestment = typeSel.value === "new_investment";
          sellerField.style.display = isNewInvestment ? "none" : "";
          newInvFields.style.display = isNewInvestment ? "" : "none";
          statusField.style.display = isNewInvestment ? "none" : "";
          if (isNewInvestment) renderOwnershipTable();
        }
        typeSel.onchange = syncMode;
        buyerSel.onchange = () => {
          newNameField.style.display = buyerSel.value === "__new__" ? "" : "none";
          if (typeSel.value === "new_investment") renderOwnershipTable();
        };
        modal.querySelector("#f_newName").oninput = () => { if (typeSel.value === "new_investment") renderOwnershipTable(); };
        syncMode();

        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#stForm").onsubmit = async (e) => {
          e.preventDefault();
          const type = typeSel.value;
          const isNewBuyer = buyerSel.value === "__new__";
          const body = {
            transferType: type,
            pctTransferred: modal.querySelector("#f_pct").value,
            salePrice: modal.querySelector("#f_price").value || null,
            effectiveDate: modal.querySelector("#f_date").value,
            notes: modal.querySelector("#f_notes").value.trim(),
          };
          if (isNewBuyer) body.newPartnerName = modal.querySelector("#f_newName").value.trim();
          else body.buyerPartnerId = buyerSel.value;
          if (type === "share_sale") {
            body.sellerPartnerId = modal.querySelector("#f_seller").value;
            body.paymentStatus = modal.querySelector("#f_status").value;
          } else {
            body.newOwnership = Array.from(ownTableEl.querySelectorAll("[data-own]")).map((i) => ({
              partnerId: i.dataset.own === "__new__" ? null : i.dataset.own, ownershipPct: i.value,
            }));
            // A brand-new buyer's row can't carry a real partnerId until the server creates
            // them inline, so for a new_investment the buyer must already exist — simplest
            // and matches the common case (an existing partner investing more).
            if (isNewBuyer) { toastError(new Error("For a new investment, please add the new partner first (New Partner button), then record their investment here.")); return; }
          }
          try {
            await API.createShareTransfer(body);
            Modal.close(); Toast.show("Share transfer recorded."); onSaved();
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  // -------- Consolidated dashboard --------
  async function renderDashboard(root) {
    root.innerHTML = `<div class="content">${pageHeader("Investment & Partners Dashboard")}<div id="body">Loading…</div></div>`;
    const body = document.getElementById("body");
    const from0 = `${new Date().getFullYear()}-01-01`, to0 = Util.todayISO();

    async function go(from, to) {
      try {
        const d = await API.partnersDashboard(from, to);
        body.innerHTML = `
          <div class="card"><div class="field-row">
            <div class="field"><label>From</label><input type="date" id="rngFrom" value="${from}"></div>
            <div class="field"><label>To</label><input type="date" id="rngTo" value="${to}"></div>
            <div class="field" style="align-self:flex-end;"><button class="btn" id="rngGo">Update</button></div>
            <div class="field" style="align-self:flex-end;"><button class="btn" id="xlsBtn">Export to Excel</button></div>
          </div></div>
          ${d.warnings.length ? `<div class="card" style="border-color:var(--warn); background:var(--warn-bg); color:var(--warn);">${d.warnings.map((w) => `<div>${Util.escapeHtml(w)}</div>`).join("")}</div>` : ""}
          <div class="grid-4" style="margin-bottom:16px;">
            <div class="stat-box"><div class="label">Sales Revenue</div><div class="value">${money(d.salesRevenue)}</div></div>
            <div class="stat-box"><div class="label">Total Purchases</div><div class="value">${money(d.totalPurchases)}</div></div>
            <div class="stat-box"><div class="label">Gross Profit</div><div class="value ${d.grossProfit >= 0 ? "good" : "bad"}">${money(d.grossProfit)}</div></div>
            <div class="stat-box"><div class="label">Net Profit</div><div class="value ${d.netProfit >= 0 ? "good" : "bad"}">${money(d.netProfit)}</div></div>
          </div>
          <div class="grid-4" style="margin-bottom:16px;">
            <div class="stat-box"><div class="label">Customer Payments Received</div><div class="value">${money(d.customerPaymentsReceived)}</div></div>
            <div class="stat-box"><div class="label">Outstanding Receivables</div><div class="value">${money(d.outstandingReceivables)}</div></div>
            <div class="stat-box"><div class="label">Outstanding Payables</div><div class="value">${money(d.outstandingPayables)}</div></div>
            <div class="stat-box"><div class="label">Cash & Bank Balance</div><div class="value">${money(d.cashAndBankBalance)}</div></div>
          </div>
          <div class="grid-4" style="margin-bottom:16px;">
            <div class="stat-box"><div class="label">COGS</div><div class="value">${money(d.cogs)}</div></div>
            <div class="stat-box"><div class="label">Operating Expenses</div><div class="value">${money(d.operatingExpenses)}</div></div>
            <div class="stat-box"><div class="label">Net Profit (all-time)</div><div class="value">${money(d.netProfitAllTime)}</div></div>
            <div class="stat-box"><div class="label">Undistributed Profit</div><div class="value ${d.undistributedProfit >= 0 ? "good" : "bad"}">${money(d.undistributedProfit)}</div></div>
          </div>
          <div class="card"><h2>Partners — ownership & capital (all-time)</h2>
            <table><thead><tr><th>Partner</th><th class="num">Ownership</th><th class="num">Capital contributed</th><th class="num">Loan outstanding</th><th class="num">Withdrawals</th><th class="num">Distributions received</th><th>Status</th></tr></thead>
            <tbody>${d.partners.map((p) => `<tr data-nav="#/partners/${p.id}">
              <td>${Util.escapeHtml(p.name)}</td><td class="num">${p.ownershipPct}%</td><td class="num">${money(p.capitalContributed)}</td>
              <td class="num">${money(p.loanOutstanding)}</td><td class="num">${money(p.withdrawals)}</td><td class="num">${money(p.distributionsReceived)}</td>
              <td>${pill(p.status)}</td></tr>`).join("") || `<tr><td colspan="7">${emptyState("No partners yet.")}</td></tr>`}</tbody>
            ${d.partners.length ? `<tfoot><tr style="font-weight:800;"><td>Total (active)</td><td class="num">${d.totalActiveOwnership}%</td><td colspan="5"></td></tr></tfoot>` : ""}
            </table>
          </div>
          <div class="card">
            <h2>Profit distribution — estimate</h2>
            <div class="field-row">
              <div class="field"><label>Method</label><select id="allocMethod"><option value="ownership">By ownership %</option><option value="profit_share_ratio">By agreed profit-share ratio</option></select></div>
              <div class="field" style="align-self:flex-end;"><button class="btn" id="previewBtn">Preview</button></div>
              <div class="field" style="align-self:flex-end;"><button class="btn btn-primary" id="saveAllocBtn" disabled>Save as estimate</button></div>
            </div>
            <div id="allocPreview"></div>
            <h2 style="margin-top:18px;">Saved allocations</h2>
            <div id="allocList">Loading…</div>
          </div>
        `;
        wireRowNav(body);
        body.querySelector("#rngGo").onclick = () => go(body.querySelector("#rngFrom").value, body.querySelector("#rngTo").value);
        body.querySelector("#xlsBtn").onclick = () => exportRowsAsExcel("partners_dashboard", `Investment & Partners Dashboard (${from} to ${to})`,
          ["Metric", "Value (AED)"],
          [["Sales Revenue", d.salesRevenue], ["Total Purchases", d.totalPurchases], ["Gross Profit", d.grossProfit], ["Net Profit", d.netProfit],
           ["Customer Payments Received", d.customerPaymentsReceived], ["Outstanding Receivables", d.outstandingReceivables], ["Outstanding Payables", d.outstandingPayables],
           ["Cash & Bank Balance", d.cashAndBankBalance], ["COGS", d.cogs], ["Operating Expenses", d.operatingExpenses],
           ["Net Profit (all-time)", d.netProfitAllTime], ["Undistributed Profit", d.undistributedProfit]]
            .concat(d.partners.map((p) => [`Partner: ${p.name} — ownership`, `${p.ownershipPct}%`]))
            .concat(d.partners.map((p) => [`Partner: ${p.name} — capital contributed`, p.capitalContributed])));

        let lastPreview = null;
        body.querySelector("#previewBtn").onclick = async () => {
          try {
            const method = body.querySelector("#allocMethod").value;
            const prev = await API.previewProfitAllocation({ from, to, method });
            lastPreview = prev;
            body.querySelector("#allocPreview").innerHTML = `
              <table style="margin-top:10px;"><thead><tr><th>Partner</th><th class="num">% used</th><th class="num">Estimated amount</th></tr></thead>
              <tbody>${prev.lines.map((l) => `<tr><td>${Util.escapeHtml(l.partnerName)}</td><td class="num">${l.pctUsed}%</td><td class="num">${money(l.amount)}</td></tr>`).join("") || `<tr><td colspan="3">No active partners.</td></tr>`}</tbody>
              <tfoot><tr style="font-weight:800;"><td>Net profit for period</td><td></td><td class="num">${money(prev.netProfit)}</td></tr></tfoot></table>
              <div style="font-size:12px; color:var(--text-muted); margin-top:6px;">This is an estimate only — nothing is paid or posted until you record an actual Distribution transaction on a partner's page.</div>
            `;
            body.querySelector("#saveAllocBtn").disabled = false;
          } catch (err) { toastError(err); }
        };
        body.querySelector("#saveAllocBtn").onclick = async () => {
          if (!lastPreview) return;
          try {
            await API.createProfitAllocation({ from, to, method: body.querySelector("#allocMethod").value });
            Toast.show("Saved as a draft estimate.");
            await loadAllocations();
          } catch (err) { toastError(err); }
        };
        async function loadAllocations() {
          const listEl = body.querySelector("#allocList");
          try {
            const { allocations } = await API.profitAllocations();
            listEl.innerHTML = allocations.length ? `<table><thead><tr><th>Period</th><th>Method</th><th class="num">Net profit</th><th>Status</th><th></th></tr></thead>
              <tbody>${allocations.map((a) => `<tr>
                <td>${Util.dateStr(a.from_date)} – ${Util.dateStr(a.to_date)}</td>
                <td>${a.allocation_method === "ownership" ? "By ownership %" : "By profit-share ratio"}</td>
                <td class="num">${money(a.net_profit)}</td><td>${pill(a.status)}</td>
                <td>${a.status === "draft" ? `<button class="btn btn-sm" data-approve="${a.id}">Approve</button> <button class="btn btn-sm btn-danger" data-del="${a.id}">Delete</button>` : ""}</td>
              </tr>`).join("")}</tbody></table>` : emptyState("No saved allocations yet.");
            listEl.querySelectorAll("[data-approve]").forEach((b) => b.onclick = async () => { try { await API.approveProfitAllocation(b.dataset.approve); Toast.show("Allocation approved."); loadAllocations(); } catch (err) { toastError(err); } });
            listEl.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { if (!confirm("Delete this draft allocation?")) return; try { await API.deleteProfitAllocation(b.dataset.del); loadAllocations(); } catch (err) { toastError(err); } });
          } catch (err) { toastError(err); listEl.innerHTML = emptyState("Could not load allocations."); }
        }
        loadAllocations();
      } catch (e) { toastError(e); body.innerHTML = emptyState("Could not load the dashboard."); }
    }
    await go(from0, to0);
  }

  return { renderList, renderDetail, renderShareTransfers, renderDashboard };
})();
