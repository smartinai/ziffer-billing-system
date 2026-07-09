import crypto from "node:crypto";
import { promisify } from "node:util";
import { query } from "./db.js";

const scryptAsync = promisify(crypto.scrypt);
const passwordHashPrefix = "scrypt";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function publicUser(row) {
  if (!row) return null;
  return {
    displayName: row.display_name || row.displayName || "",
    email: row.email || "",
    id: row.id || "",
    name: row.display_name || row.displayName || row.email || "",
    roles: row.roles || []
  };
}

export async function hashPassword(password) {
  if (!password || String(password).length < 10) {
    throw new Error("Password must be at least 10 characters.");
  }

  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = (await scryptAsync(String(password), salt, 64)).toString("base64url");
  return `${passwordHashPrefix}:${salt}:${hash}`;
}

export async function verifyPassword(password, storedHash) {
  const [scheme, salt, expected] = String(storedHash || "").split(":");
  if (scheme !== passwordHashPrefix || !salt || !expected) return false;

  const actual = (await scryptAsync(String(password || ""), salt, 64)).toString("base64url");
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const result = await query(
    `
      select
        app_users.id,
        app_users.email,
        app_users.display_name,
        app_users.password_hash,
        coalesce(array_agg(app_roles.name order by app_roles.name) filter (where app_roles.name is not null), '{}') as roles
      from app_users
      left join app_user_roles on app_user_roles.user_id = app_users.id
      left join app_roles on app_roles.id = app_user_roles.role_id
      where lower(app_users.email) = $1
        and app_users.status = 'active'
      group by app_users.id
      limit 1
    `,
    [normalizedEmail]
  );

  return result.rows[0] || null;
}

export async function authenticateUser(email, password) {
  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) return null;
  return publicUser(user);
}

export async function updateOwnAccount(userId, input = {}) {
  const displayName = String(input.displayName || "").trim();
  const currentPassword = String(input.currentPassword || "");
  const newPassword = String(input.newPassword || "");

  if (!displayName) {
    const error = new Error("Name is required.");
    error.statusCode = 400;
    throw error;
  }

  const currentUserResult = await query(
    "select id, email, display_name, password_hash from app_users where id = $1 and status = 'active'",
    [userId]
  );
  const currentUser = currentUserResult.rows[0];
  if (!currentUser) {
    const error = new Error("User not found.");
    error.statusCode = 404;
    throw error;
  }

  let passwordHash = currentUser.password_hash;
  if (newPassword) {
    if (!(await verifyPassword(currentPassword, currentUser.password_hash))) {
      const error = new Error("Current password is not correct.");
      error.statusCode = 400;
      throw error;
    }
    passwordHash = await hashPassword(newPassword);
  }

  const result = await query(
    `
      update app_users
      set display_name = $2,
          password_hash = $3,
          updated_at = now()
      where id = $1
      returning id, email, display_name
    `,
    [userId, displayName, passwordHash]
  );

  const rolesResult = await query(
    `
      select app_roles.name
      from app_user_roles
      join app_roles on app_roles.id = app_user_roles.role_id
      where app_user_roles.user_id = $1
      order by app_roles.name
    `,
    [userId]
  );

  return publicUser({
    ...result.rows[0],
    roles: rolesResult.rows.map((row) => row.name)
  });
}

export function toPublicUser(user) {
  return publicUser(user);
}
