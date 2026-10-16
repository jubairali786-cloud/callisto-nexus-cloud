import { sql } from "../db.js";

export async function hashPassword(plain) {
  return await Bun.password.hash(plain, { algorithm: "bcrypt", cost: 10 });
}
export async function verifyPassword(plain, hash) {
  return await Bun.password.verify(plain, hash);
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export function makeSessionToken() {
  return crypto.randomUUID() + "." + crypto.randomUUID();
}

export async function createSession(userId, orgId) {
  const token = makeSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await sql`insert into sessions (token, user_id, org_id, expires_at) values (${token}, ${userId}, ${orgId}, ${expiresAt})`;
  return { token, expiresAt };
}

export async function destroySession(token) {
  await sql`delete from sessions where token=${token}`;
}

export async function setSessionOrg(token, orgId) {
  await sql`update sessions set org_id=${orgId} where token=${token}`;
}

export function parseCookies(req) {
  const header = req.headers.get("cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function sessionCookieHeader(token, expiresAt) {
  const attrs = [
    `session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  return attrs.join("; ");
}

export function clearSessionCookieHeader() {
  return "session=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

// Resolves the current request to {user, orgId, role} or null. Also enforces session expiry.
export async function getAuthContext(req) {
  const cookies = parseCookies(req);
  const token = cookies.session;
  if (!token) return null;
  const rows = await sql`
    select s.token, s.org_id, s.expires_at, u.id as user_id, u.email, u.name
    from sessions s join users u on u.id = s.user_id
    where s.token = ${token}
  `;
  if (!rows.length) return null;
  const row = rows[0];
  if (new Date(row.expires_at) < new Date()) {
    await destroySession(token);
    return null;
  }
  let role = null;
  if (row.org_id) {
    const mem = await sql`select role from org_members where org_id=${row.org_id} and user_id=${row.user_id}`;
    role = mem[0]?.role || null;
  }
  return {
    token,
    user: { id: row.user_id, email: row.email, name: row.name },
    orgId: row.org_id,
    role,
  };
}

export async function listUserOrgs(userId) {
  return await sql`
    select o.id, o.name, m.role from org_members m
    join orgs o on o.id = m.org_id
    where m.user_id = ${userId} and m.invite_status = 'active'
    order by o.name
  `;
}
