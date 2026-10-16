const BankingPages = (() => {
  async function renderList(root) {
    root.innerHTML = `<div class="content">${pageHeader("Banking", `<button class="btn btn-primary" id="newBtn">+ New Bank Account</button>`)}<div class="card" id="listCard">Loading…</div></div>`;
    async function load() {
      const { bankAccounts } = await API.bankAccounts();
      document.getElementById("listCard").innerHTML = bankAccounts.length ? `
        <table class="clickable"><thead><tr><th>Name</th><th>Currency</th><th class="num">Opening balance</th></tr></thead>
        <tbody>${bankAccounts.map((b) => `<tr data-nav="#/banking/${b.id}"><td>${Util.escapeHtml(b.name)}</td><td>${b.currency_code}</td><td class="num">${Util.money(b.opening_balance)}</td></tr>`).join("")}</tbody></table>
      ` : emptyState("No bank accounts yet.");
      wireRowNav(document.getElementById("listCard"));
    }
    root.querySelector("#newBtn").onclick = () => {
      Modal.open(`
        <h3>New Bank Account</h3>
        <form id="baForm">
          <div class="field"><label>Name *</label><input id="f_name" placeholder="e.g. ADCB Current Account" required></div>
          <div class="field"><label>Currency</label><input id="f_currency" value="AED"></div>
          <div class="field"><label>Opening balance</label><input id="f_opening" type="number" step="0.01" value="0"></div>
          <div class="btn-row"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
        </form>
      `, {
        onMount: (modal) => {
          modal.querySelector("#cancelBtn").onclick = () => Modal.close();
          modal.querySelector("#baForm").onsubmit = async (e) => {
            e.preventDefault();
            try {
              await API.createBankAccount({ name: modal.querySelector("#f_name").value.trim(), currencyCode: modal.querySelector("#f_currency").value.trim(), openingBalance: Number(modal.querySelector("#f_opening").value || 0) });
              Modal.close(); Toast.show("Bank account created."); load();
            } catch (err) { toastError(err); }
          };
        },
      });
    };
    await load();
  }

  async function renderDetail(root, id) {
    root.innerHTML = `<div class="content">Loading…</div>`;
    const [{ bankAccounts }, { transactions }] = await Promise.all([API.bankAccounts(), API.bankTransactions(id)]);
    const account = bankAccounts.find((b) => b.id === id);
    root.innerHTML = `<div class="content">
      <a class="back-link" href="#/banking">&larr; Back to Banking</a>
      ${pageHeader(account.name, `<button class="btn" id="importBtn">Import CSV</button>`)}
      <div class="card">
        <table><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>${transactions.length ? transactions.map((t) => `
          <tr>
            <td>${Util.dateStr(t.txn_date)}</td><td>${Util.escapeHtml(t.description || "—")}</td>
            <td class="num" style="color:${Number(t.amount) < 0 ? "var(--bad)" : "var(--good)"};">${Util.money(t.amount)}</td>
            <td>${pill(t.status)}</td>
            <td>${t.status === "unmatched" ? `<button class="btn btn-sm" data-match="${t.id}" data-amt="${t.amount}" data-desc="${Util.escapeHtml(t.description || "")}">Match</button> <button class="btn btn-sm" data-ignore="${t.id}">Ignore</button>` : ""}</td>
          </tr>`).join("") : `<tr><td colspan="5">${emptyState("No transactions imported yet.")}</td></tr>`}</tbody></table>
      </div>
    </div>`;
    root.querySelector("#importBtn").onclick = () => openImportModal(id, () => renderDetail(root, id));
    root.querySelectorAll("[data-match]").forEach((btn) => btn.onclick = () => openMatchModal(id, btn.dataset.match, Number(btn.dataset.amt), btn.dataset.desc, () => renderDetail(root, id)));
    root.querySelectorAll("[data-ignore]").forEach((btn) => btn.onclick = async () => { try { await API.ignoreBankTransaction(btn.dataset.ignore); Toast.show("Marked ignored."); renderDetail(root, id); } catch (err) { toastError(err); } });
  }

  function openImportModal(bankAccountId, onSaved) {
    Modal.open(`
      <h3>Import bank statement (CSV)</h3>
      <p style="font-size:12.5px; color:var(--text-muted); margin-top:-4px;">Paste CSV rows as <code>date,description,amount</code> — one per line. Money in is positive, money out is negative.</p>
      <form id="impForm">
        <div class="field"><textarea id="f_csv" rows="8" placeholder="2026-10-01,Office rent,-5000&#10;2026-10-02,Client payment,12000"></textarea></div>
        <div class="btn-row"><button type="submit" class="btn btn-primary">Import</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
      </form>
    `, {
      onMount: (modal) => {
        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#impForm").onsubmit = async (e) => {
          e.preventDefault();
          const text = modal.querySelector("#f_csv").value.trim();
          const rows = text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
            const [date, description, amount] = line.split(",");
            return { date: (date || "").trim(), description: (description || "").trim(), amount: Number((amount || "0").trim()) };
          });
          try {
            const res = await API.importBankTransactions(bankAccountId, rows);
            Toast.show(`Imported ${res.imported} transactions.`);
            Modal.close(); onSaved && onSaved();
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  async function openMatchModal(bankAccountId, txnId, amount, desc, onSaved) {
    const [{ candidates }, { accounts }] = await Promise.all([API.unreconciledCandidates(bankAccountId), API.accounts()]);
    Modal.open(`
      <h3>Match transaction</h3>
      <div class="field"><label>Transaction</label><div>${Util.dateStr(new Date())} · ${Util.escapeHtml(desc)} · ${Util.money(amount)}</div></div>
      <form id="matchForm">
        ${candidates.length ? `<div class="field"><label>Match to an existing journal entry</label>${selectHtml("f_journalId", candidates.map((c) => ({ value: c.id, label: `${Util.dateStr(c.entry_date)} — ${c.memo || "(no memo)"}` })), "", "— or post a new one below —")}</div>` : ""}
        <div class="field"><label>Or post a new entry against account</label>${selectHtml("f_counterAccountId", accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })), "", "Select account…")}</div>
        <div class="btn-row"><button type="submit" class="btn btn-primary">Match</button><button type="button" class="btn" id="cancelBtn">Cancel</button></div>
      </form>
    `, {
      onMount: (modal) => {
        modal.querySelector("#cancelBtn").onclick = () => Modal.close();
        modal.querySelector("#matchForm").onsubmit = async (e) => {
          e.preventDefault();
          const journalId = modal.querySelector("#f_journalId")?.value;
          const counterAccountId = modal.querySelector("#f_counterAccountId").value;
          if (!journalId && !counterAccountId) return toastError(new Error("Pick an existing entry or an account to post against."));
          try {
            await API.matchBankTransaction(txnId, { journalEntryId: journalId || null, counterAccountId: journalId ? null : counterAccountId });
            Toast.show("Matched."); Modal.close(); onSaved && onSaved();
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  return { renderList, renderDetail };
})();
