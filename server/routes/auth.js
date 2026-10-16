import { sql } from "../db.js";
import { hashPassword, verifyPassword, createSession, destroySession, sessionCookieHeader, clearSessionCookieHeader, setSessionOrg, listUserOrgs } from "../lib/auth.js";
import { json, err } from "../lib/helpers.js";
import { ensureSystemAccounts } from "../lib/ledger.js";
import { Router } from "../lib/router.js";

export const router = new Router();

// Sign up: if this email was already invited to an existing org, claim that
// invite and join it instead of creating a brand-new, separate org. Otherwise,
// create a brand-new org (owner), seeding its chart of accounts.
router.post("/api/auth/signup", async (req) => {
  const body = await req.json().catch(() => ({}));
  const { email, password, name, orgName } = body;
  if (!email || !password || !name) return err("email, password and name are required");
  const existing = await sql`select 1 from users where email=${email.toLowerCase()}`;
  if (existing.length) return err("An account with that email already exists");

  const passwordHash = await hashPassword(password);
  const [user] = await sql`insert into users (email, password_hash, name) values (${email.toLowerCase()}, ${passwordHash}, ${name}) returning id`;

  const pendingInvites = await sql`
    select id, org_id from org_members where invite_email=${email.toLowerCase()} and invite_status='pending'
  `;

  let primaryOrgId;
  if (pendingInvites.length) {
    // Claim every pending invite for this email (normally just one) by attaching
    // this new user to each invited org, instead of spinning up a new company.
    for (const invite of pendingInvites) {
      await sql`update org_members set user_id=${user.id}, invite_status='active' where id=${invite.id}`;
    }
    primaryOrgId = pendingInvites[0].org_id;
  } else {
    const [org] = await sql`insert into orgs (name) values (${orgName || "Callisto Nexus Technical Services L.L.C."}) returning id`;
    await sql`insert into org_members (org_id, user_id, role) values (${org.id}, ${user.id}, 'owner')`;
    await ensureSystemAccounts(org.id);
    primaryOrgId = org.id;
  }

  const { token, expiresAt } = await createSession(user.id, primaryOrgId);
  return new Response(JSON.stringify({ ok: true, orgId: primaryOrgId }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": sessionCookieHeader(token, expiresAt) },
  });
});

router.post("/api/auth/login", async (req) => {
  const body = await req.json().catch(() => ({}));
  const { email, password } = body;
  if (!email || !password) return err("email and password are required");
  const rows = await sql`select id, password_hash, name from users where email=${email.toLowerCase()}`;
  if (!rows.length) return err("Invalid email or password", 401);
  const ok = await verifyPassword(password, rows[0].password_hash);
  if (!ok) return err("Invalid email or password", 401);
  const userId = rows[0].id;
  const orgs = await listUserOrgs(userId);
  const defaultOrgId = orgs[0]?.id || null;
  const { token, expiresAt } = await createSession(userId, defaultOrgId);
  return new Response(JSON.stringify({ ok: true, orgs }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": sessionCookieHeader(token, expiresAt) },
  });
});

router.post("/api/auth/logout", async (req, ctx) => {
  if (ctx?.token) await destroySession(ctx.token);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": clearSessionCookieHeader() },
  });
});

router.get("/api/auth/me", async (req, ctx) => {
  if (!ctx) return err("Not authenticated", 401);
  const orgs = await listUserOrgs(ctx.user.id);
  let org = null;
  if (ctx.orgId) {
    const rows = await sql`select id, name, trn, base_currency, address, email, phone, logo_b64 from orgs where id=${ctx.orgId}`;
    org = rows[0] || null;
  }
  return json({ user: ctx.user, orgId: ctx.orgId, role: ctx.role, orgs, org });
});

router.post("/api/auth/switch-org", async (req, ctx) => {
  if (!ctx) return err("Not authenticated", 401);
  const { orgId } = await req.json().catch(() => ({}));
  const member = await sql`select role from org_members where org_id=${orgId} and user_id=${ctx.user.id}`;
  if (!member.length) return err("You are not a member of that organization", 403);
  await setSessionOrg(ctx.token, orgId);
  return json({ ok: true });
});

// Invite a staff member to the current org (owner/admin only). Creates a placeholder
// org_members row keyed by email; on signup/login with that email it's claimed.
router.post("/api/auth/invite", async (req, ctx) => {
  if (!ctx || !ctx.orgId) return err("Not authenticated", 401);
  if (!["owner", "admin"].includes(ctx.role)) return err("Only owners/admins can invite staff", 403);
  const { email, role } = await req.json().catch(() => ({}));
  if (!email) return err("email is required");
  const existingUser = await sql`select id from users where email=${email.toLowerCase()}`;
  if (existingUser.length) {
    await sql`
      insert into org_members (org_id, user_id, role, invite_status) values (${ctx.orgId}, ${existingUser[0].id}, ${role || "staff"}, 'active')
      on conflict (org_id, user_id) do update set role=excluded.role, invite_status='active'
    `;
  } else {
    // Avoid creating a second pending row if this email was already invited and hasn't
    // signed up yet — update the existing placeholder's role instead.
    const existingInvite = await sql`
      select id from org_members where org_id=${ctx.orgId} and invite_email=${email.toLowerCase()} and invite_status='pending'
    `;
    if (existingInvite.length) {
      await sql`update org_members set role=${role || "staff"} where id=${existingInvite[0].id}`;
    } else {
      await sql`
        insert into org_members (org_id, user_id, role, invite_email, invite_status) values (${ctx.orgId}, null, ${role || "staff"}, ${email.toLowerCase()}, 'pending')
      `;
    }
  }
  return json({ ok: true, note: "Staff member added. They should sign up using that same email to gain access." });
});

router.get("/api/org/members", async (req, ctx) => {
  if (!ctx || !ctx.orgId) return err("Not authenticated", 401);
  const rows = await sql`
    select m.id, m.role, m.invite_status, m.invite_email, u.email, u.name
    from org_members m left join users u on u.id = m.user_id
    where m.org_id = ${ctx.orgId} order by m.created_at
  `;
  return json({ members: rows });
});

// Remove a staff member or cancel a pending invite (owner/admin only). Blocks removing
// yourself and blocks removing the last remaining owner, so an org can never be left
// without anyone able to manage it.
router.del("/api/org/members/:id", async (req, ctx, params) => {
  if (!ctx || !ctx.orgId) return err("Not authenticated", 401);
  if (!["owner", "admin"].includes(ctx.role)) return err("Only owners/admins can remove staff", 403);
  const rows = await sql`select id, role, user_id from org_members where id=${params.id} and org_id=${ctx.orgId}`;
  if (!rows.length) return err("Member not found", 404);
  if (rows[0].user_id && rows[0].user_id === ctx.user.id) return err("You can't remove yourself", 400);
  if (rows[0].role === "owner") {
    const ownerCount = await sql`select count(*)::int as c from org_members where org_id=${ctx.orgId} and role='owner'`;
    if (ownerCount[0].c <= 1) return err("Can't remove the last owner of the organization", 400);
  }
  await sql`delete from org_members where id=${params.id} and org_id=${ctx.orgId}`;
  return json({ ok: true });
});

// Permanently delete the current organization (owner only). Every business table
// has org_id with ON DELETE CASCADE, so this one delete cleans up everything that
// belonged to the org (members, accounts, invoices, clients, etc. — all of it).
// Because the caller's own session is scoped to this org, and sessions.org_id also
// cascades, the delete removes the very session row authenticating this request —
// so we immediately issue a fresh session (switched to another org the user still
// belongs to, if any) and hand back a new cookie, the same way login does.
router.del("/api/org", async (req, ctx) => {
  if (!ctx || !ctx.orgId) return err("Not authenticated", 401);
  if (ctx.role !== "owner") return err("Only the owner can delete an organization", 403);
  const orgIdToDelete = ctx.orgId;
  const userId = ctx.user.id;
  await sql`delete from orgs where id=${orgIdToDelete}`;
  const orgs = await listUserOrgs(userId);
  const nextOrgId = orgs[0]?.id || null;
  const { token, expiresAt } = await createSession(userId, nextOrgId);
  return new Response(JSON.stringify({ ok: true, orgId: nextOrgId }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": sessionCookieHeader(token, expiresAt) },
  });
});

router.put("/api/org/settings", async (req, ctx) => {
  if (!ctx || !ctx.orgId) return err("Not authenticated", 401);
  if (!["owner", "admin"].includes(ctx.role)) return err("Only owners/admins can edit org settings", 403);
  const b = await req.json().catch(() => ({}));
  await sql`
    update orgs set name=${b.name}, trn=${b.trn || null}, base_currency=${b.baseCurrency || "AED"},
      address=${b.address || null}, email=${b.email || null}, phone=${b.phone || null},
      logo_b64 = coalesce(${b.logoB64 || null}, logo_b64)
    where id=${ctx.orgId}
  `;
  return json({ ok: true });
});
