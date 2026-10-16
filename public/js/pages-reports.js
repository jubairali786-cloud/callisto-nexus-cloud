const ReportPages = (() => {
  const TABS = [
    ["pl", "Profit & Loss"], ["bs", "Balance Sheet"], ["tb", "Trial Balance"],
    ["vat", "VAT Summary"], ["stock", "Stock Valuation"], ["ar", "AR Aging"], ["ap", "AP Aging"],
    ["accounts", "Chart of Accounts"],
  ];

  async function render(root, tab) {
    tab = tab || "pl";
    root.innerHTML = `<div class="content">
      ${pageHeader("Reports")}
      <div class="filter-tabs">${TABS.map(([k, label]) => `<button data-tab="${k}" class="${k === tab ? "active" : ""}">${label}</button>`).join("")}</div>
      <div id="reportBody">Loading…</div>
    </div>`;
    root.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { location.hash = `#/reports/${b.dataset.tab}`; });
    const body = document.getElementById("reportBody");
    try {
      if (tab === "pl") await renderPl(body);
      else if (tab === "bs") await renderBs(body);
      else if (tab === "tb") await renderTb(body);
      else if (tab === "vat") await renderVat(body);
      else if (tab === "stock") await renderStock(body);
      else if (tab === "ar") await renderAr(body);
      else if (tab === "ap") await renderAp(body);
      else if (tab === "accounts") await renderAccounts(body);
    } catch (err) { toastError(err); body.innerHTML = emptyState("Could not load report."); }
  }

  function dateRangeBar(from, to, onChange) {
    return `<div class="card"><div class="field-row">
      <div class="field"><label>From</label><input type="date" id="rngFrom" value="${from}"></div>
      <div class="field"><label>To</label><input type="date" id="rngTo" value="${to}"></div>
      <div class="field" style="align-self:flex-end;"><button class="btn" id="rngGo">Update</button></div>
    </div></div>`;
  }

  async function renderPl(body) {
    const from = `${new Date().getFullYear()}-01-01`, to = Util.todayISO();
    async function go(f, t) {
      const d = await API.profitAndLoss(f, t);
      body.innerHTML = dateRangeBar(f, t) + `
        <div class="card">
          <h2>Income</h2>
          <table><tbody>${d.income.map((r) => `<tr><td>${r.code} · ${Util.escapeHtml(r.name)}</td><td class="num">${Util.money(r.net_credit)}</td></tr>`).join("") || `<tr><td>${emptyState("No income recorded.")}</td></tr>`}</tbody></table>
          <div class="totals-box"><div class="row total"><span>Total income</span><span>${Util.money(d.totalIncome)}</span></div></div>
        </div>
        <div class="card">
          <h2>Expenses</h2>
          <table><tbody>${d.expense.map((r) => `<tr><td>${r.code} · ${Util.escapeHtml(r.name)}</td><td class="num">${Util.money(r.net_debit)}</td></tr>`).join("") || `<tr><td>${emptyState("No expenses recorded.")}</td></tr>`}</tbody></table>
          <div class="totals-box"><div class="row total"><span>Total expenses</span><span>${Util.money(d.totalExpense)}</span></div></div>
        </div>
        <div class="stat-box"><div class="label">Net Profit</div><div class="value ${d.netProfit >= 0 ? "good" : "bad"}">${Util.money(d.netProfit, "AED")}</div></div>
      `;
      wireRange(body, go);
    }
    await go(from, to);
  }
  async function renderBs(body) {
    async function go(asOf) {
      const d = await API.balanceSheet(asOf);
      body.innerHTML = `<div class="card"><div class="field" style="max-width:220px;"><label>As of</label><input type="date" id="asOfInput" value="${asOf}"></div></div>
        <div class="grid-2">
          <div class="card"><h2>Assets</h2><table><tbody>${d.assets.map((r) => `<tr><td>${r.code} · ${Util.escapeHtml(r.name)}</td><td class="num">${Util.money(r.net_debit)}</td></tr>`).join("") || `<tr><td>${emptyState("—")}</td></tr>`}</tbody></table>
            <div class="totals-box"><div class="row total"><span>Total Assets</span><span>${Util.money(d.totalAssets)}</span></div></div></div>
          <div class="card"><h2>Liabilities & Equity</h2>
            <table><tbody>${d.liabilities.map((r) => `<tr><td>${r.code} · ${Util.escapeHtml(r.name)}</td><td class="num">${Util.money(r.net_credit)}</td></tr>`).join("")}
            <tr><td colspan="2"><strong>Equity</strong></td></tr>
            ${d.equity.map((r) => `<tr><td>${r.code} · ${Util.escapeHtml(r.name)}</td><td class="num">${Util.money(r.net_credit)}</td></tr>`).join("")}
            <tr><td>Retained earnings (current period)</td><td class="num">${Util.money(d.netProfitToDate)}</td></tr>
            </tbody></table>
            <div class="totals-box"><div class="row"><span>Total Liabilities</span><span>${Util.money(d.totalLiabilities)}</span></div><div class="row total"><span>Total Equity</span><span>${Util.money(d.totalEquity)}</span></div></div>
          </div>
        </div>
        <div class="stat-box"><div class="label">Books balanced?</div><div class="value ${d.balanced ? "good" : "bad"}">${d.balanced ? "Yes ✓" : "No — check your entries"}</div></div>
      `;
      body.querySelector("#asOfInput").onchange = (e) => go(e.target.value);
    }
    await go(Util.todayISO());
  }
  async function renderTb(body) {
    async function go(asOf) {
      const d = await API.trialBalance(asOf);
      body.innerHTML = `<div class="card"><div class="field" style="max-width:220px;"><label>As of</label><input type="date" id="asOfInput" value="${asOf}"></div></div>
        <div class="card"><table><thead><tr><th>Code</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${d.accounts.map((a) => `<tr><td>${a.code}</td><td>${Util.escapeHtml(a.name)}</td><td class="num">${Util.money(a.total_debit)}</td><td class="num">${Util.money(a.total_credit)}</td></tr>`).join("")}</tbody>
        <tfoot><tr style="font-weight:800;"><td colspan="2">Total</td><td class="num">${Util.money(d.totalDebit)}</td><td class="num">${Util.money(d.totalCredit)}</td></tr></tfoot></table></div>
      `;
      body.querySelector("#asOfInput").onchange = (e) => go(e.target.value);
    }
    await go(Util.todayISO());
  }
  async function renderVat(body) {
    const from = `${new Date().getFullYear()}-01-01`, to = Util.todayISO();
    async function go(f, t) {
      const d = await API.vatSummary(f, t);
      body.innerHTML = dateRangeBar(f, t) + `
        <div class="grid-2">
          <div class="stat-box"><div class="label">Output VAT (on sales)</div><div class="value">${Util.money(d.outputVat, "AED")}</div></div>
          <div class="stat-box"><div class="label">Input VAT (on purchases)</div><div class="value">${Util.money(d.inputVat, "AED")}</div></div>
          <div class="stat-box"><div class="label">Taxable sales</div><div class="value">${Util.money(d.taxableSales, "AED")}</div></div>
          <div class="stat-box"><div class="label">Taxable purchases</div><div class="value">${Util.money(d.taxablePurchases, "AED")}</div></div>
        </div>
        <div class="stat-box" style="margin-top:16px;"><div class="label">Net VAT payable to FTA</div><div class="value ${d.netVatPayable >= 0 ? "" : "good"}">${Util.money(d.netVatPayable, "AED")}</div></div>
      `;
      wireRange(body, go);
    }
    await go(from, to);
  }
  async function renderStock(body) {
    const d = await API.stockValuation();
    body.innerHTML = `<div class="card"><table><thead><tr><th>Item</th><th>SKU</th><th class="num">Qty on hand</th><th class="num">Avg cost</th><th class="num">Stock value</th></tr></thead>
      <tbody>${d.items.map((i) => `<tr><td>${Util.escapeHtml(i.name)}</td><td>${Util.escapeHtml(i.sku || "—")}</td><td class="num">${i.qty_on_hand}</td><td class="num">${Util.money(i.avg_cost)}</td><td class="num">${Util.money(i.stock_value)}</td></tr>`).join("") || `<tr><td colspan="5">${emptyState("No inventory items.")}</td></tr>`}</tbody>
      <tfoot><tr style="font-weight:800;"><td colspan="4">Total stock value</td><td class="num">${Util.money(d.totalValue)}</td></tr></tfoot></table></div>`;
  }
  async function renderAr(body) {
    const d = await API.arAging();
    body.innerHTML = agingBuckets(d.buckets) + `<div class="card"><table><thead><tr><th>Invoice</th><th>Client</th><th>Due</th><th class="num">Balance</th><th class="num">Days overdue</th></tr></thead>
      <tbody>${d.invoices.map((i) => `<tr><td>${Util.escapeHtml(i.number)}</td><td>${Util.escapeHtml(i.client_name)}</td><td>${Util.dateStr(i.due_date)}</td><td class="num">${Util.money(i.balance)}</td><td class="num">${i.days_overdue}</td></tr>`).join("") || `<tr><td colspan="5">${emptyState("Nothing overdue.")}</td></tr>`}</tbody></table></div>`;
  }
  async function renderAp(body) {
    const d = await API.apAging();
    body.innerHTML = agingBuckets(d.buckets) + `<div class="card"><table><thead><tr><th>Bill</th><th>Vendor</th><th>Due</th><th class="num">Balance</th><th class="num">Days overdue</th></tr></thead>
      <tbody>${d.bills.map((b) => `<tr><td>${Util.escapeHtml(b.number)}</td><td>${Util.escapeHtml(b.vendor_name)}</td><td>${Util.dateStr(b.due_date)}</td><td class="num">${Util.money(b.balance)}</td><td class="num">${b.days_overdue}</td></tr>`).join("") || `<tr><td colspan="5">${emptyState("Nothing overdue.")}</td></tr>`}</tbody></table></div>`;
  }
  function agingBuckets(b) {
    return `<div class="grid-4" style="margin-bottom:16px;">
      ${["current", "1-30", "31-60", "61-90", "90+"].map((k) => `<div class="stat-box"><div class="label">${k}</div><div class="value">${Util.money(b[k])}</div></div>`).join("")}
    </div>`;
  }
  async function renderAccounts(body) {
    const { accounts } = await API.accounts();
    body.innerHTML = `<div class="card">
      <div class="btn-row" style="margin-bottom:12px;"><button class="btn btn-primary" id="newAcctBtn">+ New Account</button></div>
      <table><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Subtype</th><th></th></tr></thead>
      <tbody>${accounts.map((a) => `<tr><td>${a.code}</td><td>${Util.escapeHtml(a.name)}</td><td>${a.type}</td><td>${a.subtype || "—"}</td>
        <td>${a.is_system ? "" : `<button class="btn btn-sm btn-danger" data-del="${a.id}">Delete</button>`}</td></tr>`).join("")}</tbody></table>
    </div>`;
    body.querySelector("#newAcctBtn").onclick = () => {
      Modal.open(`<h3>New Account</h3><form id="acctForm">
        <div class="field"><label>Code *</label><input id="f_code" required></div>
        <div class="field"><label>Name *</label><input id="f_name" required></div>
        <div class="field"><label>Type *</label><select id="f_type"><option value="asset">Asset</option><option value="liability">Liability</option><option value="equity">Equity</option><option value="income">Income</option><option value="expense">Expense</option></select></div>
        <div class="field"><label>Subtype</label><input id="f_subtype" placeholder="optional"></div>
        <div class="btn-row"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
      </form>`, {
        onMount: (modal) => {
          modal.querySelector("#cancelBtn").onclick = () => Modal.close();
          modal.querySelector("#acctForm").onsubmit = async (e) => {
            e.preventDefault();
            try {
              await API.createAccount({ code: modal.querySelector("#f_code").value.trim(), name: modal.querySelector("#f_name").value.trim(), type: modal.querySelector("#f_type").value, subtype: modal.querySelector("#f_subtype").value.trim() });
              Modal.close(); Toast.show("Account created."); renderAccounts(body);
            } catch (err) { toastError(err); }
          };
        },
      });
    };
    body.querySelectorAll("[data-del]").forEach((btn) => btn.onclick = async () => {
      if (!confirm("Delete this account?")) return;
      try { await API.deleteAccount(btn.dataset.del); renderAccounts(body); } catch (err) { toastError(err); }
    });
  }
  function wireRange(body, go) {
    body.querySelector("#rngGo").onclick = () => go(body.querySelector("#rngFrom").value, body.querySelector("#rngTo").value);
  }

  return { render };
})();
