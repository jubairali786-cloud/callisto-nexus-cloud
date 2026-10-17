// Global search bar, mounted once in the topbar (see app.js layoutShell/boot) and usable
// from anywhere in the app. Hits GET /api/search, which is scoped to the signed-in org
// only — same tenancy boundary as every other endpoint — and never touches the
// owner/admin-only Investment & Partners data.
const GlobalSearch = (() => {
  function mount(container) {
    if (!container || container.dataset.mounted) return;
    container.dataset.mounted = "1";
    container.innerHTML = `
      <div class="global-search">
        <span class="gs-icon">&#128269;</span>
        <input type="text" id="gsInput" placeholder="Search projects, clients, quotations, invoices, LPOs…" autocomplete="off">
        <div class="global-search-results" id="gsResults" hidden></div>
      </div>
    `;
    const input = container.querySelector("#gsInput");
    const results = container.querySelector("#gsResults");

    const run = Util.debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) { results.hidden = true; results.innerHTML = ""; return; }
      try {
        const { groups } = await API.globalSearch(q);
        renderResults(groups, q);
      } catch (e) { /* search failures stay silent — not worth a toast on every keystroke */ }
    }, 250);

    input.addEventListener("input", run);
    input.addEventListener("focus", () => { if (results.innerHTML && input.value.trim().length >= 2) results.hidden = false; });
    document.addEventListener("click", (e) => { if (!container.contains(e.target)) results.hidden = true; });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") { results.hidden = true; input.blur(); } });

    function renderResults(groups, q) {
      if (!groups.length) {
        results.innerHTML = `<div class="gs-empty">No matches for "${Util.escapeHtml(q)}".</div>`;
        results.hidden = false;
        return;
      }
      results.innerHTML = groups.map((g) => `
        <div class="gs-group">
          <div class="gs-group-label">${Util.escapeHtml(g.label)}</div>
          ${g.results.map((r) => `
            <div class="gs-row" data-href="${Util.escapeHtml(r.href)}">
              <div class="gs-row-main">
                <span class="gs-row-title">${Util.escapeHtml(r.title)}</span>
                ${r.status ? pill(r.status) : ""}
              </div>
              <div class="gs-row-sub">${Util.escapeHtml(r.subtitle || "")}</div>
              ${r.amount != null ? `<div class="gs-row-amount">${Util.money(r.amount, r.currency || "")}</div>` : ""}
            </div>
          `).join("")}
        </div>
      `).join("");
      results.hidden = false;
      results.querySelectorAll("[data-href]").forEach((row) => {
        row.onclick = () => { location.hash = row.dataset.href; results.hidden = true; input.value = ""; };
      });
    }
  }
  return { mount };
})();
