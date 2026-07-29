import { getDatabasePool } from "./db.js";

const secretKeyPattern = /(secret|token|password|api[_-]?key|authorization|oauth|cookie|code)/i;

function safeValue(value) {
  if (Array.isArray(value)) return value.map(safeValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      secretKeyPattern.test(key) ? "[redacted]" : safeValue(entryValue)
    ])
  );
}

export function sanitizeAuditMetadata(metadata = {}) {
  return safeValue(metadata) || {};
}

export function auditActorName(actor) {
  if (!actor) return "system";
  if (typeof actor === "string") return actor || "system";
  return actor.displayName || actor.name || actor.username || actor.sub || actor.email || "system";
}

function compactText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function auditSummary({ action, entityType, metadata = {} }) {
  const summary = compactText(metadata.summary);
  if (summary) return summary;

  const label = compactText(metadata.documentNumber || metadata.clientName || metadata.displayName || metadata.message);
  if (label) return label;

  return compactText(`${action} ${entityType}`).trim();
}

export function normalizeAuditSummary(summary, resolvedActor, identities = []) {
  return identities
    .filter((identity) => identity && identity !== resolvedActor)
    .reduce((normalized, identity) => normalized.replaceAll(identity, resolvedActor), summary);
}

export async function recordAuditEvent({
  action,
  actor,
  database,
  entityId = "",
  entityType = "",
  metadata = {}
}) {
  try {
    if (!action) return null;
    const pool = database || getDatabasePool();
    if (!pool) return null;

    const safeMetadata = sanitizeAuditMetadata({
      ...metadata,
      actor: auditActorName(actor),
      summary: auditSummary({ action, entityType, metadata })
    });

    const result = await pool.query(
      `
        insert into audit_events (action, entity_type, entity_id, metadata)
        values ($1, $2, $3, $4)
        returning
          id,
          action,
          entity_type as "entityType",
          entity_id as "entityId",
          metadata,
          created_at as "createdAt"
      `,
      [action, entityType, String(entityId || ""), JSON.stringify(safeMetadata)]
    );

    return result.rows[0];
  } catch (error) {
    console.warn(`Audit event "${action}" was not recorded: ${error.message}`);
    return null;
  }
}

export async function listAuditEvents(filters = {}) {
  const pool = getDatabasePool();
  if (!pool) {
    const error = new Error("DATABASE_URL is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const action = compactText(filters.action);
  const entityType = compactText(filters.entityType);
  const actor = compactText(filters.actor);
  const params = [action || null, entityType || null, actor || null];

  const result = await pool.query(
    `
      select
        event.id,
        event.action,
        event.entity_type as "entityType",
        event.entity_id as "entityId",
        event.metadata,
        actor_user.email as "actorEmail",
        coalesce(nullif(trim(actor_user.display_name), ''), event.metadata->>'actor', 'system') as "resolvedActor",
        event.created_at as "createdAt"
      from audit_events event
      left join app_users actor_user
        on lower(actor_user.email) = lower(event.metadata->>'actor')
        or lower(actor_user.display_name) = lower(event.metadata->>'actor')
      where ($1::text is null or event.action = $1)
        and ($2::text is null or event.entity_type = $2)
        and (
          $3::text is null
          or coalesce(nullif(trim(actor_user.display_name), ''), event.metadata->>'actor', 'system') = $3
        )
      order by event.created_at desc
      limit 300
    `,
    params
  );

  const events = result.rows.map((row) => {
    const storedActor = row.metadata?.actor || "system";
    const resolvedActor = row.resolvedActor || storedActor;
    const storedSummary = row.metadata?.summary || auditSummary({
      action: row.action,
      entityType: row.entityType,
      metadata: row.metadata || {}
    });
    const normalizedSummary = normalizeAuditSummary(storedSummary, resolvedActor, [storedActor, row.actorEmail]);
    return {
      action: row.action,
      actor: resolvedActor,
      createdAt: row.createdAt,
      entityId: row.entityId || "",
      entityType: row.entityType || "",
      id: row.id,
      metadata: row.metadata || {},
      summary: normalizedSummary
    };
  });

  return {
    actions: [...new Set(events.map((event) => event.action).filter(Boolean))].sort(),
    actors: [...new Set(events.map((event) => event.actor).filter(Boolean))].sort(),
    entityTypes: [...new Set(events.map((event) => event.entityType).filter(Boolean))].sort(),
    events
  };
}
