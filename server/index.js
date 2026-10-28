import { migrate, sql } from "./db.js";
import { getAuthContext } from "./lib/auth.js";
import { seedServiceCatalogForAllOrgs } from "./lib/catalog-seed.js";
import { Router } from "./lib/router.js";
import { err } from "./lib/helpers.js";

import { router as authRouter } from "./routes/auth.js";
import { router as contactsRouter } from "./routes/contacts.js";
import { router as itemsRouter } from "./routes/items.js";
import { router as quotesRouter } from "./routes/quotes.js";
import { router as invoicesRouter } from "./routes/invoices.js";
import { router as creditNotesRouter } from "./routes/creditnotes.js";
import { router as purchasesRouter } from "./routes/purchases.js";
import { router as bankingRouter } from "./routes/banking.js";
import { router as reportsRouter } from "./routes/reports.js";
import { router as partnersRouter } from "./routes/partners.js";
import { router as projectsRouter } from "./routes/projects.js";
import { router as searchRouter } from "./routes/search.js";

await migrate();
// Idempotent: adds any standard-catalog items a currently-existing org doesn't have yet
// (e.g. right after this feature first deploys). Never overwrites an item an org already
// has under the same code, so a price/description an org has since customized is untouched.
await seedServiceCatalogForAllOrgs(sql);

const routers = [authRouter, contactsRouter, itemsRouter, quotesRouter, invoicesRouter, creditNotesRouter, purchasesRouter, bankingRouter, reportsRouter, partnersRouter, projectsRouter, searchRouter];

const PUBLIC_DIR = new URL("../public/", import.meta.url);
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

Bun.serve({
  port: PORT,
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (pathname.startsWith("/api/")) {
      try {
        for (const router of routers) {
          const match = router.match(req.method, pathname);
          if (match) {
            const ctx = await getAuthContext(req);
            // Public auth endpoints don't require an existing session.
            const isPublic = pathname === "/api/auth/signup" || pathname === "/api/auth/login";
            if (!isPublic && !ctx) return err("Not authenticated", 401);
            return await match.handler(req, ctx, match.params, url);
          }
        }
        return err("Not found", 404);
      } catch (e) {
        console.error("[api error]", pathname, e);
        return err(e.message || "Internal server error", 500);
      }
    }

    // Static frontend
    let filePath = pathname === "/" ? "/index.html" : pathname;
    let file = Bun.file(new URL("." + filePath, PUBLIC_DIR));
    if (!(await file.exists())) {
      file = Bun.file(new URL("./index.html", PUBLIC_DIR)); // SPA fallback (hash routing)
    }
    const ext = filePath.slice(filePath.lastIndexOf("."));
    // No cache headers were being sent at all, which leaves browsers free to cache these
    // files on their own heuristics. Since this app has no build step and ships plain,
    // unversioned filenames (index.html, app.js, styles.css, ...), a stale cached copy of
    // even ONE file after a deploy can mismatch the rest of the app (e.g. an old app.js
    // calling a function with an old signature from a newly-updated page script) and the
    // page silently breaks or renders blank. Force every request to always fetch fresh.
    return new Response(file, { headers: { "content-type": MIME[ext] || "text/html; charset=utf-8", "cache-control": "no-store" } });
  },
});

console.log(`Callisto Nexus Cloud Accounting listening on http://localhost:${PORT}`);
