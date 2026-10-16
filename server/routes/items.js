import { sql } from "../db.js";
import { json, err, round2 } from "../lib/helpers.js";
import { Router } from "../lib/router.js";

export const router = new Router();

function requireOrg(ctx) {
  if (!ctx || !ctx.orgId) return err("Not authenticated", 401);
  return null;
}

// -------- Items --------
router.get("/api/items", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`select * from items where org_id=${ctx.orgId} order by name`;
  return json({ items: rows });
});
router.get("/api/items/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`select * from items where org_id=${ctx.orgId} and id=${params.id}`;
  if (!rows.length) return err("Item not found", 404);
  const movements = await sql`select * from stock_movements where org_id=${ctx.orgId} and item_id=${params.id} order by created_at desc limit 50`;
  return json({ item: rows[0], movements });
});
router.post("/api/items", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.name) return err("name is required");
  const [row] = await sql`
    insert into items (org_id, sku, name, description, unit, item_type, sale_price, vat_rate, track_inventory, reorder_point, reorder_qty)
    values (${ctx.orgId}, ${b.sku || null}, ${b.name}, ${b.description || null}, ${b.unit || "unit"}, ${b.itemType || "service"},
      ${round2(b.salePrice || 0)}, ${b.vatRate ?? 5}, ${!!b.trackInventory}, ${b.reorderPoint || 0}, ${b.reorderQty || 0})
    returning *
  `;
  return json({ item: row }, 201);
});
router.put("/api/items/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [row] = await sql`
    update items set sku=${b.sku || null}, name=${b.name}, description=${b.description || null}, unit=${b.unit || "unit"},
      item_type=${b.itemType || "service"}, sale_price=${round2(b.salePrice || 0)}, vat_rate=${b.vatRate ?? 5},
      track_inventory=${!!b.trackInventory}, reorder_point=${b.reorderPoint || 0}, reorder_qty=${b.reorderQty || 0},
      active=${b.active !== false}
    where org_id=${ctx.orgId} and id=${params.id} returning *
  `;
  if (!row) return err("Item not found", 404);
  return json({ item: row });
});
router.del("/api/items/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  await sql`delete from price_list_items where item_id=${params.id}`;
  await sql`delete from items where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});

// Manual stock adjustment (e.g. stock-take correction, damage write-off). Posts no VAT; adjusts
// inventory GL account vs a "stock adjustment" expense line so the ledger always balances.
router.post("/api/items/:id/adjust-stock", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const qtyDelta = Number(b.qtyDelta);
  if (!qtyDelta) return err("qtyDelta is required and must be non-zero");
  const [item] = await sql`select * from items where org_id=${ctx.orgId} and id=${params.id}`;
  if (!item) return err("Item not found", 404);
  if (!item.track_inventory) return err("This item does not track inventory");

  const { applyStockMovement, postAdjustmentJournal } = await import("../lib/inventory.js");
  const unitCost = qtyDelta > 0 ? Number(b.unitCost ?? item.avg_cost) : Number(item.avg_cost);
  const result = await applyStockMovement({
    orgId: ctx.orgId, itemId: item.id, qtyDelta, unitCost, moveType: "adjustment",
    refType: "manual_adjustment", refId: null, notes: b.notes || null, createdBy: ctx.user.id,
  });
  const isOpeningBalance = !!b.openingBalance;
  await postAdjustmentJournal({
    orgId: ctx.orgId, qtyDelta, costUsed: result.costUsed, entryDate: new Date().toISOString().slice(0, 10),
    memo: isOpeningBalance ? `Opening stock: ${item.name} (${qtyDelta} ${item.unit})` : `Stock adjustment: ${item.name} (${qtyDelta > 0 ? "+" : ""}${qtyDelta} ${item.unit})`,
    createdBy: ctx.user.id, isOpeningBalance,
  });
  return json({ ok: true, item: result.item });
});

router.get("/api/items/reorder-report", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const rows = await sql`
    select * from items where org_id=${ctx.orgId} and track_inventory=true and qty_on_hand <= reorder_point and active=true
    order by name
  `;
  return json({ items: rows });
});

// -------- Price lists --------
router.get("/api/price-lists", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const lists = await sql`select * from price_lists where org_id=${ctx.orgId} order by name`;
  return json({ priceLists: lists });
});
router.get("/api/price-lists/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const [list] = await sql`select * from price_lists where org_id=${ctx.orgId} and id=${params.id}`;
  if (!list) return err("Price list not found", 404);
  const lines = await sql`
    select pli.*, i.name as item_name, i.sku from price_list_items pli
    join items i on i.id = pli.item_id where pli.price_list_id=${params.id} order by i.name
  `;
  return json({ priceList: list, lines });
});
router.post("/api/price-lists", async (req, ctx) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  if (!b.name || !b.currencyCode) return err("name and currencyCode are required");
  const [row] = await sql`
    insert into price_lists (org_id, name, currency_code, is_default) values (${ctx.orgId}, ${b.name}, ${b.currencyCode}, ${!!b.isDefault}) returning *
  `;
  return json({ priceList: row }, 201);
});
router.put("/api/price-lists/:id/items", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  const b = await req.json().catch(() => ({})); // { itemId, price }
  await sql`
    insert into price_list_items (price_list_id, item_id, price) values (${params.id}, ${b.itemId}, ${round2(b.price)})
    on conflict (price_list_id, item_id) do update set price=excluded.price
  `;
  return json({ ok: true });
});
router.del("/api/price-lists/:id", async (req, ctx, params) => {
  const bad = requireOrg(ctx); if (bad) return bad;
  await sql`delete from price_lists where org_id=${ctx.orgId} and id=${params.id}`;
  return json({ ok: true });
});
