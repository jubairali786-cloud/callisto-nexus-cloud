// Minimal path-param router: register("GET", "/api/clients/:id", handler)
export class Router {
  constructor() {
    this.routes = []; // {method, parts, handler}
  }
  add(method, pattern, handler) {
    const parts = pattern.split("/").filter(Boolean);
    this.routes.push({ method, parts, handler });
    return this;
  }
  get(p, h) { return this.add("GET", p, h); }
  post(p, h) { return this.add("POST", p, h); }
  put(p, h) { return this.add("PUT", p, h); }
  del(p, h) { return this.add("DELETE", p, h); }

  match(method, pathname) {
    const pathParts = pathname.split("/").filter(Boolean);
    // Collect every route that matches this path, then prefer the one with the fewest
    // ":param" segments — so a literal route like "/api/items/reorder-report" wins over
    // the more general "/api/items/:id" even if :id happens to be registered first.
    let best = null, bestParamCount = Infinity;
    for (const r of this.routes) {
      if (r.method !== method) continue;
      if (r.parts.length !== pathParts.length) continue;
      const params = {};
      let ok = true, paramCount = 0;
      for (let i = 0; i < r.parts.length; i++) {
        const rp = r.parts[i], pp = pathParts[i];
        if (rp.startsWith(":")) { params[rp.slice(1)] = decodeURIComponent(pp); paramCount++; }
        else if (rp !== pp) { ok = false; break; }
      }
      if (ok && paramCount < bestParamCount) {
        best = { handler: r.handler, params };
        bestParamCount = paramCount;
      }
    }
    return best;
  }
}
