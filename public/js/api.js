// Thin REST client. Every call returns the parsed JSON body; on a non-2xx response it throws
// an Error whose .message is the server's {error} text, so callers can just try/catch + toast.
const API = (() => {
  async function req(method, path, body) {
    const opts = { method, headers: {}, credentials: "same-origin" };
    if (body !== undefined) {
      opts.headers["content-type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }
  const get = (p) => req("GET", p);
  const post = (p, b) => req("POST", p, b ?? {});
  const put = (p, b) => req("PUT", p, b ?? {});
  const del = (p) => req("DELETE", p);

  return {
    // auth
    signup: (b) => post("/api/auth/signup", b),
    login: (b) => post("/api/auth/login", b),
    logout: () => post("/api/auth/logout"),
    me: () => get("/api/auth/me"),
    switchOrg: (orgId) => post("/api/auth/switch-org", { orgId }),
    invite: (b) => post("/api/auth/invite", b),
    orgMembers: () => get("/api/org/members"),
    removeMember: (id) => del(`/api/org/members/${id}`),
    saveOrgSettings: (b) => put("/api/org/settings", b),

    // clients / vendors
    clients: () => get("/api/clients"),
    client: (id) => get(`/api/clients/${id}`),
    createClient: (b) => post("/api/clients", b),
    updateClient: (id, b) => put(`/api/clients/${id}`, b),
    deleteClient: (id) => del(`/api/clients/${id}`),
    vendors: () => get("/api/vendors"),
    vendor: (id) => get(`/api/vendors/${id}`),
    createVendor: (b) => post("/api/vendors", b),
    updateVendor: (id, b) => put(`/api/vendors/${id}`, b),
    deleteVendor: (id) => del(`/api/vendors/${id}`),

    // items / price lists
    items: () => get("/api/items"),
    item: (id) => get(`/api/items/${id}`),
    createItem: (b) => post("/api/items", b),
    updateItem: (id, b) => put(`/api/items/${id}`, b),
    deleteItem: (id) => del(`/api/items/${id}`),
    adjustStock: (id, b) => post(`/api/items/${id}/adjust-stock`, b),
    reorderReport: () => get("/api/items/reorder-report"),
    priceLists: () => get("/api/price-lists"),
    priceList: (id) => get(`/api/price-lists/${id}`),
    createPriceList: (b) => post("/api/price-lists", b),
    setPriceListItem: (id, b) => put(`/api/price-lists/${id}/items`, b),
    deletePriceList: (id) => del(`/api/price-lists/${id}`),

    // quotes
    quotes: () => get("/api/quotes"),
    quote: (id) => get(`/api/quotes/${id}`),
    createQuote: (b) => post("/api/quotes", b),
    updateQuote: (id, b) => put(`/api/quotes/${id}`, b),
    quoteStatus: (id, status) => post(`/api/quotes/${id}/status`, { status }),
    deleteQuote: (id) => del(`/api/quotes/${id}`),
    convertQuote: (id) => post(`/api/quotes/${id}/convert`),

    // invoices
    invoices: () => get("/api/invoices"),
    invoice: (id) => get(`/api/invoices/${id}`),
    createInvoice: (b) => post("/api/invoices", b),
    updateInvoice: (id, b) => put(`/api/invoices/${id}`, b),
    issueInvoice: (id) => post(`/api/invoices/${id}/issue`),
    voidInvoice: (id) => post(`/api/invoices/${id}/void`),
    deleteInvoice: (id) => del(`/api/invoices/${id}`),
    recordPayment: (invoiceId, b) => post(`/api/invoices/${invoiceId}/payments`, b),
    deletePayment: (id) => del(`/api/payments/${id}`),
    payments: () => get("/api/payments"),

    // credit notes
    creditNotes: () => get("/api/credit-notes"),
    creditNote: (id) => get(`/api/credit-notes/${id}`),
    createCreditNote: (b) => post("/api/credit-notes", b),
    issueCreditNote: (id) => post(`/api/credit-notes/${id}/issue`),
    deleteCreditNote: (id) => del(`/api/credit-notes/${id}`),

    // purchases
    purchaseOrders: () => get("/api/purchase-orders"),
    purchaseOrder: (id) => get(`/api/purchase-orders/${id}`),
    createPurchaseOrder: (b) => post("/api/purchase-orders", b),
    poStatus: (id, status) => post(`/api/purchase-orders/${id}/status`, { status }),
    deletePurchaseOrder: (id) => del(`/api/purchase-orders/${id}`),
    convertPoToBill: (id) => post(`/api/purchase-orders/${id}/convert-to-bill`),
    bills: () => get("/api/bills"),
    bill: (id) => get(`/api/bills/${id}`),
    createBill: (b) => post("/api/bills", b),
    openBill: (id) => post(`/api/bills/${id}/open`),
    deleteBill: (id) => del(`/api/bills/${id}`),
    recordBillPayment: (billId, b) => post(`/api/bills/${billId}/payments`, b),

    // banking
    bankAccounts: () => get("/api/bank-accounts"),
    createBankAccount: (b) => post("/api/bank-accounts", b),
    bankTransactions: (id) => get(`/api/bank-accounts/${id}/transactions`),
    importBankTransactions: (id, rows) => post(`/api/bank-accounts/${id}/import`, { rows }),
    matchBankTransaction: (id, b) => post(`/api/bank-transactions/${id}/match`, b),
    ignoreBankTransaction: (id) => post(`/api/bank-transactions/${id}/ignore`),
    unreconciledCandidates: (id) => get(`/api/bank-accounts/${id}/unreconciled-candidates`),

    // accounts & reports
    accounts: () => get("/api/accounts"),
    createAccount: (b) => post("/api/accounts", b),
    deleteAccount: (id) => del(`/api/accounts/${id}`),
    trialBalance: (asOf) => get(`/api/reports/trial-balance${asOf ? `?asOf=${asOf}` : ""}`),
    profitAndLoss: (from, to) => get(`/api/reports/profit-and-loss?from=${from}&to=${to}`),
    balanceSheet: (asOf) => get(`/api/reports/balance-sheet${asOf ? `?asOf=${asOf}` : ""}`),
    vatSummary: (from, to) => get(`/api/reports/vat-summary?from=${from}&to=${to}`),
    stockValuation: () => get("/api/reports/stock-valuation"),
    arAging: (asOf) => get(`/api/reports/ar-aging${asOf ? `?asOf=${asOf}` : ""}`),
    apAging: (asOf) => get(`/api/reports/ap-aging${asOf ? `?asOf=${asOf}` : ""}`),
    exchangeRates: () => get("/api/exchange-rates"),
    addExchangeRate: (b) => post("/api/exchange-rates", b),
  };
})();
