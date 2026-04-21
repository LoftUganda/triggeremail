import type { MailDocument, DeliveryState, DeliveryStatus, EmailTemplate, TemplateRequest } from "./types";

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS mail (
    id TEXT PRIMARY KEY,
    to_recipients TEXT NOT NULL,
    cc TEXT,
    bcc TEXT,
    from_addr TEXT NOT NULL,
    reply_to TEXT,
    headers TEXT,
    subject TEXT NOT NULL,
    text_body TEXT,
    html_body TEXT,
    message_id TEXT,
    template_name TEXT,
    template_data TEXT,
    attachments TEXT,
    delivery_state TEXT NOT NULL DEFAULT 'PENDING',
    delivery_error TEXT,
    delivery_attempts INTEGER NOT NULL DEFAULT 0,
    delivery_start_time TEXT,
    delivery_end_time TEXT,
    delivery_info TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS templates (
    name TEXT PRIMARY KEY,
    subject TEXT,
    text TEXT,
    html TEXT,
    partial INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

/** Ensure the D1 schema exists. Idempotent. */
export async function initSchema(db: D1Database): Promise<void> {
  for (const sql of SCHEMA_SQL) {
    await db.prepare(sql).run();
  }
}

// --- Mail operations ---

interface MailRow {
  id: string;
  to_recipients: string;
  cc: string | null;
  bcc: string | null;
  from_addr: string;
  reply_to: string | null;
  headers: string | null;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  message_id: string | null;
  template_name: string | null;
  template_data: string | null;
  attachments: string | null;
  delivery_state: string;
  delivery_error: string | null;
  delivery_attempts: number;
  delivery_start_time: string | null;
  delivery_end_time: string | null;
  delivery_info: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDoc(row: MailRow): MailDocument {
  return {
    id: row.id,
    to: JSON.parse(row.to_recipients),
    cc: row.cc ? JSON.parse(row.cc) : [],
    bcc: row.bcc ? JSON.parse(row.bcc) : [],
    from: row.from_addr,
    replyTo: row.reply_to,
    headers: row.headers ? JSON.parse(row.headers) : null,
    subject: row.subject,
    textBody: row.text_body,
    htmlBody: row.html_body,
    messageId: row.message_id,
    templateName: row.template_name,
    templateData: row.template_data ? JSON.parse(row.template_data) : null,
    attachments: row.attachments ? JSON.parse(row.attachments) : null,
    delivery: {
      state: row.delivery_state as DeliveryState,
      startTime: row.delivery_start_time,
      endTime: row.delivery_end_time,
      error: row.delivery_error,
      attempts: row.delivery_attempts,
      info: row.delivery_info ? JSON.parse(row.delivery_info) : null,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertMail(
  db: D1Database,
  doc: {
    id: string;
    to: string[];
    cc: string[];
    bcc: string[];
    from: string;
    replyTo: string | null;
    headers: Record<string, string> | null;
    subject: string;
    textBody: string | null;
    htmlBody: string | null;
    messageId: string | null;
    templateName: string | null;
    templateData: Record<string, unknown> | null;
    attachments: import("./types").Attachment[] | null;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mail (id, to_recipients, cc, bcc, from_addr, reply_to, headers,
         subject, text_body, html_body, message_id, template_name, template_data, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      doc.id,
      JSON.stringify(doc.to),
      doc.cc.length ? JSON.stringify(doc.cc) : null,
      doc.bcc.length ? JSON.stringify(doc.bcc) : null,
      doc.from,
      doc.replyTo,
      doc.headers ? JSON.stringify(doc.headers) : null,
      doc.subject,
      doc.textBody,
      doc.htmlBody,
      doc.messageId,
      doc.templateName,
      doc.templateData ? JSON.stringify(doc.templateData) : null,
      doc.attachments ? JSON.stringify(doc.attachments) : null
    )
    .run();
}

export async function updateDeliveryState(
  db: D1Database,
  id: string,
  state: DeliveryState,
  extra: { error?: string; info?: string } = {}
): Promise<void> {
  const now = new Date().toISOString();
  const isStart = state === "PROCESSING";
  const isEnd = state === "SUCCESS" || state === "ERROR";

  await db
    .prepare(
      `UPDATE mail SET
         delivery_state = ?,
         delivery_error = ?,
         delivery_attempts = delivery_attempts + ?,
         delivery_start_time = COALESCE(delivery_start_time, ?),
         delivery_end_time = ?,
         delivery_info = ?,
         updated_at = ?
       WHERE id = ?`
    )
    .bind(
      state,
      extra.error ?? null,
      isStart ? 1 : 0,
      isStart ? now : null,
      isEnd ? now : null,
      extra.info ?? null,
      now,
      id
    )
    .run();
}

export async function getMail(db: D1Database, id: string): Promise<MailDocument | null> {
  const row = await db.prepare("SELECT * FROM mail WHERE id = ?").bind(id).first<MailRow>();
  return row ? rowToDoc(row) : null;
}

export async function listMail(
  db: D1Database,
  options: { limit?: number; offset?: number; state?: string } = {}
): Promise<{ results: MailDocument[]; total: number }> {
  const limit = Math.min(options.limit ?? 50, 100);
  const offset = options.offset ?? 0;

  let countSql = "SELECT COUNT(*) as total FROM mail";
  let listSql = "SELECT * FROM mail";
  const binds: unknown[] = [];

  if (options.state) {
    countSql += " WHERE delivery_state = ?";
    listSql += " WHERE delivery_state = ?";
    binds.push(options.state);
  }

  listSql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  const countBinds = [...binds];
  binds.push(limit, offset);

  const countRow = await db
    .prepare(countSql)
    .bind(...countBinds)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;

  const { results } = await db
    .prepare(listSql)
    .bind(...binds)
    .all<MailRow>();

  return {
    results: results.map(rowToDoc),
    total,
  };
}

// --- Template operations ---

interface TemplateRow {
  name: string;
  subject: string | null;
  text: string | null;
  html: string | null;
  partial: number;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(row: TemplateRow): EmailTemplate {
  return {
    name: row.name,
    subject: row.subject,
    text: row.text,
    html: row.html,
    partial: row.partial === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertTemplate(db: D1Database, req: TemplateRequest): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO templates (name, subject, text, html, partial, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         subject = excluded.subject,
         text = excluded.text,
         html = excluded.html,
         partial = excluded.partial,
         updated_at = excluded.updated_at`
    )
    .bind(
      req.name,
      req.subject ?? null,
      req.text ?? null,
      req.html ?? null,
      req.partial ? 1 : 0,
      now,
      now
    )
    .run();
}

export async function getTemplate(db: D1Database, name: string): Promise<EmailTemplate | null> {
  const row = await db.prepare("SELECT * FROM templates WHERE name = ?").bind(name).first<TemplateRow>();
  return row ? rowToTemplate(row) : null;
}

export async function listTemplates(db: D1Database): Promise<EmailTemplate[]> {
  const { results } = await db.prepare("SELECT * FROM templates ORDER BY name").all<TemplateRow>();
  return results.map(rowToTemplate);
}

export async function getPartials(db: D1Database): Promise<EmailTemplate[]> {
  const { results } = await db
    .prepare("SELECT * FROM templates WHERE partial = 1 ORDER BY name")
    .all<TemplateRow>();
  return results.map(rowToTemplate);
}
