const DashboardPage = (() => {
  async function render(root) {
    root.innerHTML = `<div class="content">${pageHeader("Dashboard")}<div id="dashBody">Loading…</div></div>`;
    try {
      const [invoices, bills, pl, reorder] = await Promise.all([
        API.invoices(), API.bills(), API.profitAndLoss(`${new Date().getFullYear()}-01-01`, Util.todayISO()), API.reorderReport(),
      ]);
      const arOutstanding = invoices.invoices.filter((i) => ["issued", "partially_paid"].includes(i.status)).reduce((s, i) => s + Number(i.balance), 0);
      const apOutstanding = bills.bills.filter((b) => ["open", "partially_paid"].includes(b.status)).reduce((s, b) => s + Number(b.balance), 0);
      const recentInvoices = invoices.invoices.slice(0, 6);

      document.getElementById("dashBody").innerHTML = `
        <div class="grid-4" style="margin-bottom:20px;">
          <div class="stat-box"><div class="label">AR Outstanding</div><div class="value">${Util.money(arOutstanding, "AED")}</div></div>
          <div class="stat-box"><div class="label">AP Outstanding</div><div class="value">${Util.money(apOutstanding, "AED")}</div></div>
          <div class="stat-box"><div class="label">YTD Revenue</div><div class="value">${Util.money(pl.totalIncome, "AED")}</div></div>
          <div class="stat-box"><div class="label">YTD Net Profit</div><div class="value ${pl.netProfit >= 0 ? "good" : "bad"}">${Util.money(pl.netProfit, "AED")}</div></div>
        </div>
        ${reorder.items.length ? `
          <div class="card">
            <h2>Items at or below reorder point</h2>
            <table><thead><tr><th>Item</th><th class="num">On hand</th><th class="num">Reorder point</th><th class="num">Suggested reorder qty</th></tr></thead>
            <tbody>${reorder.items.map((i) => `<tr><td>${Util.escapeHtml(i.name)}</td><td class="num">${i.qty_on_hand}</td><td class="num">${i.reorder_point}</td><td class="num">${i.reorder_qty}</td></tr>`).join("")}</tbody></table>
          </div>` : ""}
        <div class="card">
          <h2>Recent invoices</h2>
          ${recentInvoices.length ? `
            <table class="clickable"><thead><tr><th>Number</th><th>Client</th><th>Date</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th></tr></thead>
            <tbody>${recentInvoices.map((i) => `
              <tr data-nav="#/invoices/${i.id}">
                <td>${Util.escapeHtml(i.number)}</td><td>${Util.escapeHtml(i.client_name)}</td><td>${Util.dateStr(i.invoice_date)}</td>
                <td class="num">${Util.money(i.total, i.currency_code)}</td><td class="num">${Util.money(i.balance, i.currency_code)}</td>
                <td>${pill(i.status)}</td>
              </tr>`).join("")}</tbody></table>
          ` : emptyState("No invoices yet.")}
        </div>
      `;
      wireRowNav(document.getElementById("dashBody"));
    } catch (err) { toastError(err); document.getElementById("dashBody").innerHTML = emptyState("Could not load dashboard."); }
  }
  return { render };
})();

function wireRowNav(container) {
  container.querySelectorAll("tr[data-nav]").forEach((tr) => {
    tr.onclick = () => { location.hash = tr.dataset.nav; };
  });
}
