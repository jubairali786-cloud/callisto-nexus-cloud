const ItemPages = (() => {
  function itemFormHtml(i) {
    i = i || {};
    return `
      <div class="field"><label>Name *</label><input id="f_name" value="${Util.escapeHtml(i.name || "")}" required></div>
      <div class="field-row">
        <div class="field"><label>SKU</label><input id="f_sku" value="${Util.escapeHtml(i.sku || "")}"></div>
        <div class="field"><label>Unit</label><input id="f_unit" value="${Util.escapeHtml(i.unit || "unit")}"></div>
      </div>
      <div class="field"><label>Type</label>
        <select id="f_itemType">
          <option value="service" ${i.item_type === "service" || !i.item_type ? "selected" : ""}>Service (no inventory)</option>
          <option value="inventory" ${i.item_type === "inventory" ? "selected" : ""}>Inventory (tracked, weighted-avg cost)</option>
        </select>
      </div>
      <div class="field-row">
        <div class="field"><label>Sale price</label><input id="f_salePrice" type="number" step="0.01" value="${i.sale_price || 0}"></div>
        <div class="field"><label>VAT %</label><input id="f_vatRate" type="number" step="0.01" value="${i.vat_rate ?? 5}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Reorder point</label><input id="f_reorderPoint" type="number" step="0.01" value="${i.reorder_point || 0}"></div>
        <div class="field"><label>Reorder qty</label><input id="f_reorderQty" type="number" step="0.01" value="${i.reorder_qty || 0}"></div>
      </div>
      <div class="field"><label>Description</label><textarea id="f_description" rows="2">${Util.escapeHtml(i.description || "")}</textarea></div>
    `;
  }
  function readItemForm(modal) {
    return {
      name: modal.querySelector("#f_name").value.trim(),
      sku: modal.querySelector("#f_sku").value.trim(),
      unit: modal.querySelector("#f_unit").value.trim() || "unit",
      itemType: modal.querySelector("#f_itemType").value,
      trackInventory: modal.querySelector("#f_itemType").value === "inventory",
      salePrice: Number(modal.querySelector("#f_salePrice").value || 0),
      vatRate: Number(modal.querySelector("#f_vatRate").value || 0),
      reorderPoint: Number(modal.querySelector("#f_reorderPoint").value || 0),
      reorderQty: Number(modal.querySelector("#f_reorderQty").value || 0),
      description: modal.querySelector("#f_description").value.trim(),
    };
  }
  function openItemModal(existing, onSaved) {
    Modal.open(`
      <h3>${existing ? "Edit" : "New"} Item / Service</h3>
      <form id="itemForm">${itemFormHtml(existing)}
        <div class="btn-row"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
      </form>
    `, {
      onMount: (modal) => {
        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#itemForm").onsubmit = async (e) => {
          e.preventDefault();
          try {
            const body = readItemForm(modal);
            existing ? await API.updateItem(existing.id, body) : await API.createItem(body);
            Toast.show("Item saved.");
            Modal.close();
            onSaved && onSaved();
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  function openAdjustStockModal(item, onSaved) {
    const isFirstStock = Number(item.qty_on_hand) === 0;
    Modal.open(`
      <h3>Adjust stock — ${Util.escapeHtml(item.name)}</h3>
      <div class="field"><label>Current qty on hand</label><div>${item.qty_on_hand} ${Util.escapeHtml(item.unit)} @ avg cost ${Util.money(item.avg_cost)}</div></div>
      <form id="adjForm">
        <div class="field"><label>Quantity change (+ to add stock, &minus; to remove)</label><input id="f_qtyDelta" type="number" step="0.0001" required></div>
        <div class="field"><label>Unit cost (for stock going in)</label><input id="f_unitCost" type="number" step="0.0001" value="${item.avg_cost}"></div>
        <div class="field"><label><input type="checkbox" id="f_opening" style="width:auto; display:inline-block;" ${isFirstStock ? "checked" : ""}> This is opening stock (seeding the books), not a trading adjustment</label></div>
        <div class="field"><label>Notes</label><input id="f_notes" placeholder="e.g. stock count correction"></div>
        <div class="btn-row"><button type="submit" class="btn btn-primary">Apply</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
      </form>
    `, {
      onMount: (modal) => {
        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#adjForm").onsubmit = async (e) => {
          e.preventDefault();
          try {
            await API.adjustStock(item.id, {
              qtyDelta: Number(modal.querySelector("#f_qtyDelta").value),
              unitCost: Number(modal.querySelector("#f_unitCost").value || item.avg_cost),
              openingBalance: modal.querySelector("#f_opening").checked,
              notes: modal.querySelector("#f_notes").value.trim(),
            });
            Toast.show("Stock adjusted.");
            Modal.close();
            onSaved && onSaved();
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  async function renderList(root) {
    root.innerHTML = `<div class="content">${pageHeader("Items & Services", `<button class="btn btn-primary" id="newBtn">+ New Item</button> <a class="btn" href="#/price-lists">Price Lists</a>`)}<div class="card" id="listCard">Loading…</div></div>`;
    async function load() {
      const { items } = await API.items();
      document.getElementById("listCard").innerHTML = items.length ? `
        <table class="clickable"><thead><tr><th>Name</th><th>SKU</th><th>Type</th><th class="num">Sale price</th><th class="num">Qty on hand</th><th class="num">Avg cost</th><th class="col-del"></th></tr></thead>
        <tbody>${items.map((i) => `
          <tr data-nav="#/items/${i.id}">
            <td>${Util.escapeHtml(i.name)}</td><td>${Util.escapeHtml(i.sku || "—")}</td>
            <td>${i.item_type === "inventory" ? "Inventory" : "Service"}</td>
            <td class="num">${Util.money(i.sale_price)}</td>
            <td class="num">${i.track_inventory ? Number(i.qty_on_hand) : "—"}${i.track_inventory && Number(i.qty_on_hand) <= Number(i.reorder_point) ? ' <span class="pill pill-void">LOW</span>' : ""}</td>
            <td class="num">${i.track_inventory ? Util.money(i.avg_cost) : "—"}</td>
            <td class="col-del"><button type="button" class="row-delete" data-del="${i.id}" title="Delete">&times;</button></td>
          </tr>`).join("")}</tbody></table>
      ` : emptyState("No items or services yet.");
      wireRowNav(document.getElementById("listCard"));
      document.getElementById("listCard").querySelectorAll("[data-del]").forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm("Delete this item? This cannot be undone.")) return;
          try { await API.deleteItem(btn.dataset.del); Toast.show("Item deleted."); load(); } catch (err) { toastError(err); }
        };
      });
    }
    root.querySelector("#newBtn").onclick = () => openItemModal(null, load);
    await load();
  }

  async function renderDetail(root, id) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const { item, movements } = await API.item(id);
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/items">&larr; Back to Items</a>
      ${pageHeader(item.name, `
        ${item.track_inventory ? '<button class="btn" id="adjBtn">Adjust Stock</button>' : ""}
        <button class="btn" id="editBtn">Edit</button>
      `)}
      <div class="card">
        <div class="grid-3">
          <div><label>SKU</label><div>${Util.escapeHtml(item.sku || "—")}</div></div>
          <div><label>Type</label><div>${item.item_type === "inventory" ? "Inventory" : "Service"}</div></div>
          <div><label>Unit</label><div>${Util.escapeHtml(item.unit)}</div></div>
          <div><label>Sale price</label><div>${Util.money(item.sale_price)}</div></div>
          <div><label>VAT rate</label><div>${item.vat_rate}%</div></div>
          ${item.track_inventory ? `<div><label>Qty on hand</label><div>${item.qty_on_hand} @ avg cost ${Util.money(item.avg_cost)}</div></div>` : ""}
        </div>
        ${item.description ? `<div style="margin-top:10px;"><label>Description</label><div>${Util.escapeHtml(item.description)}</div></div>` : ""}
      </div>
      ${item.track_inventory ? `
        <div class="card"><h2>Stock movements</h2>
        ${movements.length ? `
          <table><thead><tr><th>Date</th><th>Type</th><th class="num">Qty &Delta;</th><th class="num">Unit cost</th><th class="num">Resulting qty</th><th class="num">Resulting avg cost</th></tr></thead>
          <tbody>${movements.map((m) => `<tr><td>${Util.dateStr(m.movement_date)}</td><td>${Util.escapeHtml(m.move_type)}</td><td class="num">${Number(m.qty_delta) > 0 ? "+" : ""}${m.qty_delta}</td><td class="num">${Util.money(m.unit_cost)}</td><td class="num">${m.resulting_qty}</td><td class="num">${Util.money(m.resulting_avg_cost)}</td></tr>`).join("")}</tbody></table>
        ` : emptyState("No stock movements yet.")}
        </div>
      ` : ""}
    </div>`;
    root.querySelector("#editBtn").onclick = () => openItemModal(item, () => renderDetail(root, id));
    const adjBtn = root.querySelector("#adjBtn");
    if (adjBtn) adjBtn.onclick = () => openAdjustStockModal(item, () => renderDetail(root, id));
  }

  // ---- Price lists ----
  async function renderPriceLists(root) {
    root.innerHTML = `<div class="content">${pageHeader("Price Lists", `<button class="btn btn-primary" id="newBtn">+ New Price List</button>`)}<div class="card" id="listCard">Loading…</div></div>`;
    async function load() {
      const { priceLists } = await API.priceLists();
      document.getElementById("listCard").innerHTML = priceLists.length ? `
        <table class="clickable"><thead><tr><th>Name</th><th>Currency</th><th>Default</th></tr></thead>
        <tbody>${priceLists.map((p) => `<tr data-nav="#/price-lists/${p.id}"><td>${Util.escapeHtml(p.name)}</td><td>${p.currency_code}</td><td>${p.is_default ? "Yes" : ""}</td></tr>`).join("")}</tbody></table>
      ` : emptyState("No price lists yet.");
      wireRowNav(document.getElementById("listCard"));
    }
    root.querySelector("#newBtn").onclick = () => {
      Modal.open(`
        <h3>New Price List</h3>
        <form id="plForm">
          <div class="field"><label>Name *</label><input id="f_name" required></div>
          <div class="field"><label>Currency *</label><input id="f_currency" value="AED" required></div>
          <div class="btn-row"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
        </form>
      `, {
        onMount: (modal) => {
          modal.querySelector("#cancelBtn").onclick = () => Modal.close();
          modal.querySelector("#plForm").onsubmit = async (e) => {
            e.preventDefault();
            try {
              await API.createPriceList({ name: modal.querySelector("#f_name").value.trim(), currencyCode: modal.querySelector("#f_currency").value.trim() });
              Modal.close(); Toast.show("Price list created."); load();
            } catch (err) { toastError(err); }
          };
        },
      });
    };
    await load();
  }

  async function renderPriceListDetail(root, id) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const [{ priceList, lines }, { items }] = await Promise.all([API.priceList(id), API.items()]);
    function row(item) {
      const existing = lines.find((l) => l.item_id === item.id);
      return `<tr><td>${Util.escapeHtml(item.name)}</td><td class="num">${Util.money(item.sale_price)}</td>
        <td class="num"><input type="number" step="0.01" style="width:110px; display:inline-block;" data-item="${item.id}" value="${existing ? existing.price : item.sale_price}"></td>
        <td><button class="btn btn-sm" data-save="${item.id}">Save</button></td></tr>`;
    }
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/price-lists">&larr; Back to Price Lists</a>
      ${pageHeader(`${priceList.name} (${priceList.currency_code})`)}
      <div class="card">
        <table><thead><tr><th>Item</th><th class="num">Catalog price</th><th class="num">Price list price</th><th></th></tr></thead>
        <tbody>${items.map(row).join("")}</tbody></table>
      </div>
    </div>`;
    root.querySelectorAll("[data-save]").forEach((btn) => {
      btn.onclick = async () => {
        const input = root.querySelector(`input[data-item="${btn.dataset.save}"]`);
        try {
          await API.setPriceListItem(id, { itemId: btn.dataset.save, price: Number(input.value) });
          Toast.show("Price saved.");
        } catch (err) { toastError(err); }
      };
    });
  }

  return { renderList, renderDetail, renderPriceLists, renderPriceListDetail };
})();
