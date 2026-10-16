const SettingsPages = (() => {
  async function render(root) {
    root.innerHTML = `<div class="content">${pageHeader("Settings")}<div id="setBody">Loading…</div></div>`;
    const body = document.getElementById("setBody");
    const [me, { members }, { exchangeRates }] = await Promise.all([API.me(), API.orgMembers(), API.exchangeRates()]);
    const org = me.org || {};
    body.innerHTML = `
      <div class="card">
        <h2>Organization</h2>
        <form id="orgForm">
          <div class="field"><label>Company name</label><input id="f_name" value="${Util.escapeHtml(org.name || "")}"></div>
          <div class="field-row">
            <div class="field"><label>TRN</label><input id="f_trn" value="${Util.escapeHtml(org.trn || "")}"></div>
            <div class="field"><label>Base currency</label><input id="f_baseCurrency" value="${Util.escapeHtml(org.base_currency || "AED")}"></div>
          </div>
          <div class="field"><label>Address</label><textarea id="f_address" rows="2">${Util.escapeHtml(org.address || "")}</textarea></div>
          <div class="field-row">
            <div class="field"><label>Email</label><input id="f_email" value="${Util.escapeHtml(org.email || "")}"></div>
            <div class="field"><label>Phone</label><input id="f_phone" value="${Util.escapeHtml(org.phone || "")}"></div>
          </div>
          <div class="field"><label>Logo (optional — overrides the default Callisto Nexus logo on printed documents)</label><input type="file" id="f_logo" accept="image/png,image/jpeg"></div>
          <button type="submit" class="btn btn-primary">Save Organization Settings</button>
        </form>
      </div>
      <div class="card">
        <h2>Staff members</h2>
        <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>${members.map((m) => `<tr><td>${Util.escapeHtml(m.name || "—")}</td><td>${Util.escapeHtml(m.email || m.invite_email || "—")}</td><td>${m.role}</td><td>${m.invite_status}</td></tr>`).join("")}</tbody></table>
        <form id="inviteForm" class="field-row" style="margin-top:14px; align-items:flex-end;">
          <div class="field" style="flex:2;"><label>Invite by email</label><input id="f_inviteEmail" type="email" required placeholder="colleague@company.com"></div>
          <div class="field"><label>Role</label><select id="f_inviteRole"><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
          <div class="field"><button type="submit" class="btn">Invite</button></div>
        </form>
      </div>
      <div class="card">
        <h2>Exchange rates (manual — 1 unit of currency = this many ${Util.escapeHtml(org.base_currency || "AED")})</h2>
        <table><thead><tr><th>Currency</th><th class="num">Rate to base</th><th>As of</th></tr></thead>
        <tbody>${exchangeRates.map((r) => `<tr><td>${r.currency_code}</td><td class="num">${r.rate_to_base}</td><td>${Util.dateStr(r.as_of)}</td></tr>`).join("") || `<tr><td colspan="3">${emptyState("No exchange rates set — foreign-currency documents default to rate 1.")}</td></tr>`}</tbody></table>
        <form id="fxForm" class="field-row" style="margin-top:14px; align-items:flex-end;">
          <div class="field"><label>Currency code</label><input id="f_fxCurrency" placeholder="USD" maxlength="3" style="width:90px;"></div>
          <div class="field"><label>Rate to base</label><input id="f_fxRate" type="number" step="0.000001"></div>
          <div class="field"><button type="submit" class="btn">Add Rate</button></div>
        </form>
      </div>
    `;
    body.querySelector("#orgForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        let logoB64 = null;
        const fileInput = body.querySelector("#f_logo");
        if (fileInput.files[0]) logoB64 = await fileToBase64(fileInput.files[0]);
        await API.saveOrgSettings({
          name: body.querySelector("#f_name").value.trim(), trn: body.querySelector("#f_trn").value.trim(),
          baseCurrency: body.querySelector("#f_baseCurrency").value.trim() || "AED", address: body.querySelector("#f_address").value.trim(),
          email: body.querySelector("#f_email").value.trim(), phone: body.querySelector("#f_phone").value.trim(), logoB64,
        });
        Toast.show("Organization settings saved.");
        App.renderSidebar();
      } catch (err) { toastError(err); }
    };
    body.querySelector("#inviteForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        const res = await API.invite({ email: body.querySelector("#f_inviteEmail").value.trim(), role: body.querySelector("#f_inviteRole").value });
        Toast.show(res.note || "Invited."); render(root);
      } catch (err) { toastError(err); }
    };
    body.querySelector("#fxForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await API.addExchangeRate({ currencyCode: body.querySelector("#f_fxCurrency").value.trim().toUpperCase(), rateToBase: Number(body.querySelector("#f_fxRate").value) });
        Toast.show("Exchange rate added."); render(root);
      } catch (err) { toastError(err); }
    };
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  return { render };
})();
