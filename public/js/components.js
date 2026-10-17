const Toast = (() => {
  function show(message, isError) {
    const wrap = document.getElementById("toastWrap");
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " bad" : "");
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }
  return { show };
})();

// Catches a thrown API error, shows it as a toast, and re-throws so callers can
// still bail out of whatever flow (e.g. stop a form submit) if they need to.
function toastError(e) { Toast.show(e.message || String(e), true); }

const Modal = (() => {
  let backdrop = null;
  function open(innerHtml, { onMount } = {}) {
    close();
    backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal">${innerHtml}</div>`;
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.body.appendChild(backdrop);
    if (onMount) onMount(backdrop.querySelector(".modal"));
    return backdrop.querySelector(".modal");
  }
  function close() {
    if (backdrop) { backdrop.remove(); backdrop = null; }
  }
  return { open, close };
})();

function pill(status) {
  const label = String(status || "").replace(/_/g, " ");
  return `<span class="pill pill-${status}">${Util.escapeHtml(label)}</span>`;
}

function iconBtn(label, action, id, extraClass) {
  return `<button type="button" class="btn btn-sm ${extraClass || ""}" data-action="${action}" data-id="${id}">${label}</button>`;
}

// Renders a <select> of options [{value,label}] with an optional selected value.
function selectHtml(id, options, selected, placeholder) {
  const opts = [placeholder ? `<option value="">${Util.escapeHtml(placeholder)}</option>` : ""]
    .concat(options.map((o) => `<option value="${o.value}" ${String(o.value) === String(selected) ? "selected" : ""}>${Util.escapeHtml(o.label)}</option>`))
    .join("");
  return `<select id="${id}">${opts}</select>`;
}

// ---------------------------------------------------------------------------
// Generic line-items editor, used by Quotes/Invoices/Credit Notes (with discount
// + optional item catalog linking) and Purchase Orders/Bills (no discount column).
// ---------------------------------------------------------------------------
function LineItemsEditor(container, opts) {
  const state = { lines: (opts.lines || []).map((l) => ({ ...l, _key: Util.uid() })), items: opts.items || [], includeDiscount: opts.includeDiscount !== false, includeItemPicker: opts.includeItemPicker !== false, expenseAccounts: opts.expenseAccounts || null };
  if (!state.lines.length) addLine();

  function addLine() {
    state.lines.push({ _key: Util.uid(), itemId: "", description: "", qty: 1, unit: "", unitPrice: 0, discountPct: 0, vatRate: 5, expenseAccountId: "" });
    render();
  }
  function removeLine(key) {
    state.lines = state.lines.filter((l) => l._key !== key);
    if (!state.lines.length) addLine(); else render();
  }
  function onItemPicked(key, itemId) {
    const line = state.lines.find((l) => l._key === key);
    const item = state.items.find((i) => i.id === itemId);
    if (item) {
      line.itemId = itemId;
      line.description = line.description || item.name;
      line.unit = line.unit || item.unit || "";
      line.unitPrice = Number(item.sale_price || 0);
      line.vatRate = Number(item.vat_rate ?? 5);
    } else {
      line.itemId = "";
    }
    render();
  }
  function totals() {
    let subtotal = 0, vatTotal = 0;
    for (const l of state.lines) {
      const base = Number(l.qty || 0) * Number(l.unitPrice || 0) * (1 - Number(l.discountPct || 0) / 100);
      subtotal += base;
      vatTotal += base * (Number(l.vatRate || 0) / 100);
    }
    return { subtotal: round2(subtotal), vatTotal: round2(vatTotal), total: round2(subtotal + vatTotal) };
  }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function render() {
    const itemOptions = state.items.map((i) => ({ value: i.id, label: i.sku ? `${i.name} (${i.sku})` : i.name }));
    const acctOptions = (state.expenseAccounts || []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
    const rows = state.lines.map((l) => `
      <tr data-key="${l._key}">
        ${state.includeItemPicker ? `<td style="min-width:170px;">${selectHtml("ip_" + l._key, itemOptions, l.itemId, "— free text —")}</td>` : ""}
        ${state.expenseAccounts ? `<td style="min-width:170px;">${selectHtml("ea_" + l._key, acctOptions, l.expenseAccountId, "— inventory item —")}</td>` : ""}
        <td style="min-width:180px;"><input type="text" data-f="description" placeholder="Description" value="${Util.escapeHtml(l.description)}"></td>
        <td style="width:70px;"><input type="number" step="0.01" data-f="qty" value="${l.qty}"></td>
        <td style="width:80px;"><input type="text" data-f="unit" placeholder="pcs" value="${Util.escapeHtml(l.unit || "")}"></td>
        <td style="width:100px;"><input type="number" step="0.01" data-f="unitPrice" value="${l.unitPrice}"></td>
        ${state.includeDiscount ? `<td style="width:80px;"><input type="number" step="0.01" data-f="discountPct" value="${l.discountPct}"></td>` : ""}
        <td style="width:70px;"><input type="number" step="0.01" data-f="vatRate" value="${l.vatRate}"></td>
        <td class="num" style="width:100px;">${Util.money(lineTotal(l))}</td>
        <td style="width:34px;"><button type="button" class="row-delete" data-remove="${l._key}" title="Remove line">&times;</button></td>
      </tr>
    `).join("");
    container.innerHTML = `
      <div class="table-wrap">
      <table class="line-items-table">
        <thead><tr>
          ${state.includeItemPicker ? "<th>Catalog item</th>" : ""}
          ${state.expenseAccounts ? "<th>Expense account</th>" : ""}
          <th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price</th>
          ${state.includeDiscount ? '<th class="num">Disc %</th>' : ""}
          <th class="num">VAT %</th><th class="num">Line total</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
      <button type="button" class="btn btn-sm" id="addLineBtn" style="margin-top:8px;">+ Add line</button>
      <div class="totals-box" id="totalsBoxInner"></div>
    `;
    renderTotals();
    container.querySelector("#addLineBtn").onclick = addLine;
    container.querySelectorAll("[data-remove]").forEach((btn) => btn.onclick = () => removeLine(btn.dataset.remove));
    container.querySelectorAll("tr[data-key]").forEach((tr) => {
      const key = tr.dataset.key;
      tr.querySelectorAll("input[data-f]").forEach((inp) => {
        inp.oninput = () => {
          const line = state.lines.find((l) => l._key === key);
          line[inp.dataset.f] = inp.value;
          renderTotals();
          const cell = tr.querySelector("td.num");
          if (cell) cell.textContent = Util.money(lineTotal(line));
        };
      });
      const ip = tr.querySelector(`#ip_${key}`);
      if (ip) ip.onchange = () => onItemPicked(key, ip.value);
      const ea = tr.querySelector(`#ea_${key}`);
      if (ea) ea.onchange = () => { state.lines.find((l) => l._key === key).expenseAccountId = ea.value; };
    });
  }
  function lineTotal(l) {
    const base = Number(l.qty || 0) * Number(l.unitPrice || 0) * (1 - Number(l.discountPct || 0) / 100);
    return round2(base + base * (Number(l.vatRate || 0) / 100));
  }
  function renderTotals() {
    const t = totals();
    container.querySelector("#totalsBoxInner").innerHTML = `
      <div class="row"><span>Subtotal</span><span>${Util.money(t.subtotal)}</span></div>
      <div class="row"><span>VAT</span><span>${Util.money(t.vatTotal)}</span></div>
      <div class="row total"><span>Total</span><span>${Util.money(t.total)}</span></div>
    `;
  }

  render();
  return {
    getLines: () => state.lines.map((l) => ({
      itemId: l.itemId || null, description: l.description, qty: Number(l.qty) || 0, unit: (l.unit || "").trim() || null,
      unitPrice: Number(l.unitPrice) || 0, discountPct: Number(l.discountPct) || 0, vatRate: Number(l.vatRate) || 0,
      expenseAccountId: l.expenseAccountId || null,
    })),
    getTotals: totals,
  };
}

// Currency + FX-rate fields shared by quotes/invoices/POs/bills. Leaving "FX rate" blank lets
// the server resolve the most recent manually-entered rate (Settings → Exchange rates), or 1
// when the document currency matches the org's base currency.
function currencyFieldsHtml(baseCurrency, existingCurrency, existingFxRate) {
  return `
    <div class="field"><label>Currency</label><input id="f_currencyCode" value="${Util.escapeHtml(existingCurrency || baseCurrency || "AED")}" style="text-transform:uppercase;"></div>
    <div class="field"><label>FX rate to ${Util.escapeHtml(baseCurrency || "base")} <span style="font-weight:400;">(blank = auto)</span></label><input id="f_fxRate" type="number" step="0.000001" value="${existingFxRate && Number(existingFxRate) !== 1 ? existingFxRate : ""}"></div>
  `;
}
function readCurrencyFields() {
  const currencyCode = document.getElementById("f_currencyCode")?.value.trim().toUpperCase() || undefined;
  const fxRateRaw = document.getElementById("f_fxRate")?.value;
  const fxRate = fxRateRaw ? Number(fxRateRaw) : undefined;
  return { currencyCode, fxRate };
}

// Simple reusable "list page" shell: title, primary action button, filter tabs, table.
function pageHeader(title, actions) {
  return `<div class="detail-header"><h1>${Util.escapeHtml(title)}</h1><div class="btn-row">${actions || ""}</div></div>`;
}
function emptyState(text) { return `<div class="empty-state">${Util.escapeHtml(text)}</div>`; }
