const App = (() => {
  let currentUser = null, currentOrg = null, currentOrgs = [], currentRole = null;

  const NAV = [
    { section: "" , items: [{ r: "dashboard", label: "Dashboard", ic: "&#8962;" }] },
    { section: "Projects", items: [{ r: "projects", label: "Projects", ic: "&#128193;" }] },
    { section: "Sales", items: [
      { r: "quotes", label: "Quotes", ic: "&#128196;" },
      { r: "invoices", label: "Invoices", ic: "&#128179;" },
      { r: "credit-notes", label: "Credit Notes", ic: "&#8617;" },
      { r: "clients", label: "Clients", ic: "&#128100;" },
    ]},
    { section: "Purchases", items: [
      { r: "purchase-orders", label: "Purchase Orders", ic: "&#128230;" },
      { r: "bills", label: "Bills", ic: "&#129534;" },
      { r: "vendors", label: "Vendors", ic: "&#127970;" },
    ]},
    { section: "Inventory", items: [
      { r: "items", label: "Items & Services", ic: "&#128230;" },
      { r: "price-lists", label: "Price Lists", ic: "&#127991;" },
    ]},
    // Owner/admin only — staff never see partner capital, ownership, or share-transfer
    // data. Enforced here (hides the section) AND in dispatch() (blocks direct hash
    // navigation) AND on the API itself (server/routes/partners.js), which is the
    // boundary that actually matters.
    { section: "Investment & Partners", roles: ["owner", "admin"], items: [
      { r: "partners-dashboard", label: "Dashboard", ic: "&#128202;" },
      { r: "partners", label: "Partners", ic: "&#129309;" },
      { r: "share-transfers", label: "Share Transfers", ic: "&#128257;" },
    ]},
    { section: "", items: [
      { r: "banking", label: "Banking", ic: "&#127974;" },
      { r: "reports", label: "Reports", ic: "&#128202;" },
      { r: "settings", label: "Settings", ic: "&#9881;" },
    ]},
  ];

  function parseHash() {
    const raw = (location.hash || "#/dashboard").slice(1); // drop '#'
    const [pathPart, queryPart] = raw.split("?");
    const parts = pathPart.split("/").filter(Boolean);
    const query = {};
    if (queryPart) for (const pair of queryPart.split("&")) { const [k, v] = pair.split("="); query[decodeURIComponent(k)] = decodeURIComponent(v || ""); }
    return { parts, query };
  }

  function renderSidebar() {
    const { parts } = parseHash();
    const activeRoute = parts[0] || "dashboard";
    const logoSrc = currentOrg?.logo_b64 ? `data:image/png;base64,${currentOrg.logo_b64}` : `data:image/png;base64,${window.LOGO_B64}`;
    const nav = document.getElementById("sidebarNav");
    if (!nav) return;
    document.getElementById("sidebarLogo").src = logoSrc;
    document.getElementById("sidebarOrgName").textContent = currentOrg?.name || "Callisto Nexus";
    const visibleGroups = NAV.filter((group) => !group.roles || group.roles.includes(currentRole));
    nav.innerHTML = visibleGroups.map((group) => `
      ${group.section ? `<div class="sidebar-section">${group.section}</div>` : ""}
      ${group.items.map((it) => `<a href="#/${it.r}" class="${activeRoute === it.r ? "active" : ""}"><span class="ic">${it.ic}</span><span class="label">${it.label}</span></a>`).join("")}
    `).join("");
  }

  function layoutShell() {
    return `
      <div class="sidebar">
        <div class="sidebar-brand">
          <img id="sidebarLogo" src="" alt="logo">
          <div><div class="name" id="sidebarOrgName">Callisto Nexus</div><div class="sub">Cloud Accounting</div></div>
        </div>
        <div class="sidebar-nav" id="sidebarNav"></div>
        <div class="sidebar-foot">
          <div id="orgSwitcher"></div>
          <a href="#" id="logoutLink" style="color:#cfdcf2;">Log out</a>
        </div>
      </div>
      <div class="main">
        <div class="topbar">
          <div id="topbarTitle"></div>
          <div class="topbar-right">
            <div id="globalSearchMount"></div>
            <div class="org-switch" id="userBadge"></div>
          </div>
        </div>
        <div id="pageRoot"></div>
      </div>
    `;
  }

  async function dispatch() {
    const root = document.getElementById("pageRoot");
    if (!root) return;
    const { parts, query } = parseHash();
    const [section, a, b] = parts;
    renderSidebar();
    try {
      if (!section || section === "dashboard") return DashboardPage.render(root);
      if (section === "quotes") {
        if (a === "new") return SalesPages.renderQuoteForm(root);
        if (a && b === "edit") return SalesPages.renderQuoteForm(root, a);
        if (a) return SalesPages.renderQuoteDetail(root, a);
        return SalesPages.renderQuoteList(root);
      }
      if (section === "invoices") {
        if (a === "new") return SalesPages.renderInvoiceForm(root);
        if (a && b === "edit") return SalesPages.renderInvoiceForm(root, a);
        if (a) return SalesPages.renderInvoiceDetail(root, a);
        return SalesPages.renderInvoiceList(root);
      }
      if (section === "credit-notes") {
        if (a === "new") return SalesPages.renderCreditNoteForm(root, query);
        if (a) return SalesPages.renderCreditNoteDetail(root, a);
        return SalesPages.renderCreditNoteList(root);
      }
      if (section === "purchase-orders") {
        if (a === "new") return PurchasePages.renderPoForm(root);
        if (a) return PurchasePages.renderPoDetail(root, a);
        return PurchasePages.renderPoList(root);
      }
      if (section === "bills") {
        if (a === "new") return PurchasePages.renderBillForm(root);
        if (a) return PurchasePages.renderBillDetail(root, a);
        return PurchasePages.renderBillList(root);
      }
      if (section === "clients") {
        if (a) return ContactPages.renderDetail(root, "client", a);
        return ContactPages.renderList(root, "client");
      }
      if (section === "vendors") {
        if (a) return ContactPages.renderDetail(root, "vendor", a);
        return ContactPages.renderList(root, "vendor");
      }
      if (section === "items") {
        if (a) return ItemPages.renderDetail(root, a);
        return ItemPages.renderList(root);
      }
      if (section === "price-lists") {
        if (a) return ItemPages.renderPriceListDetail(root, a);
        return ItemPages.renderPriceLists(root);
      }
      if (section === "banking") {
        if (a) return BankingPages.renderDetail(root, a);
        return BankingPages.renderList(root);
      }
      if (section === "reports") return ReportPages.render(root, a);
      if (section === "projects") {
        if (a === "new") return ProjectPages.renderForm(root);
        if (a && b === "edit") return ProjectPages.renderForm(root, a);
        if (a) return ProjectPages.renderDetail(root, a, b);
        return ProjectPages.renderList(root);
      }
      if (["partners-dashboard", "partners", "share-transfers"].includes(section)) {
        if (!["owner", "admin"].includes(currentRole)) {
          root.innerHTML = `<div class="content">${emptyState("Investment & Partners is only available to owners and admins.")}</div>`;
          return;
        }
        if (section === "partners-dashboard") return PartnerPages.renderDashboard(root);
        if (section === "partners") {
          if (a) return PartnerPages.renderDetail(root, a);
          return PartnerPages.renderList(root);
        }
        if (section === "share-transfers") return PartnerPages.renderShareTransfers(root);
      }
      if (section === "settings") return SettingsPages.render(root);
      root.innerHTML = `<div class="content">${emptyState("Page not found.")}</div>`;
    } catch (err) {
      console.error(err);
      toastError(err);
    }
  }

  async function boot() {
    const app = document.getElementById("app");
    let me;
    try { me = await API.me(); } catch (e) { me = null; }

    if (!me) {
      const { parts } = parseHash();
      if (parts[0] === "signup") AuthPages.renderSignup(app);
      else AuthPages.renderLogin(app);
      if (!location.hash.startsWith("#/login") && !location.hash.startsWith("#/signup")) {
        // keep whatever hash the user had for after login, but show login now
      }
      // Re-render the login/signup form when the user switches between them via
      // the "Create an account" / "Log in" links, since those are plain hash
      // links and nothing was listening for hashchange yet at this point.
      window.onhashchange = boot;
      return;
    }
    currentUser = me.user; currentOrg = me.org; currentOrgs = me.orgs || []; currentRole = me.role;
    if (!currentOrg) { app.innerHTML = `<div class="auth-wrap"><div class="auth-box">No organization found for this account.</div></div>`; return; }

    app.innerHTML = layoutShell();
    renderOrgSwitcher();
    GlobalSearch.mount(document.getElementById("globalSearchMount"));
    document.getElementById("userBadge").textContent = `${currentUser.name} · ${currentOrg.name}`;
    document.getElementById("logoutLink").onclick = async (e) => {
      e.preventDefault();
      await API.logout();
      location.hash = "#/login";
      app.innerHTML = "";
      boot();
    };
    if (["login", "signup"].includes(parseHash().parts[0])) location.hash = "#/dashboard";
    window.onhashchange = dispatch;
    dispatch();
  }

  function renderOrgSwitcher() {
    const el = document.getElementById("orgSwitcher");
    if (!el) return;
    if (currentOrgs.length <= 1) { el.innerHTML = ""; return; }
    el.innerHTML = selectHtml("orgSwitchSelect", currentOrgs.map((o) => ({ value: o.id, label: o.name })), currentOrg.id);
    el.style.marginBottom = "8px";
    document.getElementById("orgSwitchSelect").onchange = async (e) => {
      try { await API.switchOrg(e.target.value); location.hash = "#/dashboard"; boot(); } catch (err) { toastError(err); }
    };
  }

  return { boot, dispatch, renderSidebar: () => API.me().then((me) => { currentOrg = me.org; currentRole = me.role; renderSidebar(); }) };
})();

App.boot();
