import { initSchema, insertMail, updateDeliveryState, getMail, listMail, upsertTemplate, getTemplate, listTemplates } from "./db";
import { sendEmail } from "./mail";
import { renderTemplate } from "./templates";
import { ValidationError, NotFoundError, TemplateError } from "./errors";
import type { Env, MailRequest, TemplateRequest } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Ensure schema exists on every request (idempotent)
      await initSchema(env.DB);

      // --- Mail endpoints ---
      if (path === "/mail" && request.method === "POST") {
        return await handleCreateMail(request, env);
      }
      if (path === "/mail" && request.method === "GET") {
        return await handleListMail(request, env);
      }
      if (path.match(/^\/mail\/[\w-]+\/retry$/) && request.method === "POST") {
        const id = path.split("/")[2];
        return await handleRetryMail(id, env);
      }
      if (path.match(/^\/mail\/[\w-]+$/) && request.method === "GET") {
        const id = path.split("/")[2];
        return await handleGetMail(id, env);
      }

      // --- Template endpoints ---
      if (path === "/templates" && request.method === "POST") {
        return await handleCreateTemplate(request, env);
      }
      if (path === "/templates" && request.method === "GET") {
        return await handleListTemplates(env);
      }
      if (path.match(/^\/templates\/.+$/) && request.method === "GET") {
        const name = decodeURIComponent(path.split("/").slice(2).join("/"));
        return await handleGetTemplate(name, env);
      }

      // --- Health ---
      if (path === "/" && request.method === "GET") {
        return Response.json({ status: "ok", service: "trigger-email" });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    } catch (e) {
      if (e instanceof ValidationError) {
        return Response.json({ error: e.message }, { status: 400 });
      }
      if (e instanceof NotFoundError) {
        return Response.json({ error: e.message }, { status: 404 });
      }
      if (e instanceof TemplateError) {
        return Response.json({ error: e.message }, { status: 422 });
      }
      console.error("Unhandled error:", e);
      return Response.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureArray(val: string | string[] | undefined): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function generateId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Mail handlers
// ---------------------------------------------------------------------------

async function handleCreateMail(request: Request, env: Env): Promise<Response> {
  const body = await request.json<MailRequest>();

  // Validate required fields
  if (!body.to && !body.cc && !body.bcc) {
    throw new ValidationError("At least one of 'to', 'cc', or 'bcc' is required");
  }
  if (!body.message?.subject) {
    throw new ValidationError("message.subject is required");
  }
  if (!body.message?.text && !body.message?.html && !body.template) {
    throw new ValidationError("At least one of message.text, message.html, or template is required");
  }

  const id = generateId();
  const to = ensureArray(body.to);
  const cc = ensureArray(body.cc);
  const bcc = ensureArray(body.bcc);
  const from = body.from || env.DEFAULT_FROM;
  const replyTo = body.replyTo || null;

  let subject = body.message.subject;
  let textBody = body.message.text || null;
  let htmlBody = body.message.html || null;

  // If a template is specified, render it and merge with message fields
  if (body.template) {
    const rendered = await renderTemplate(env.DB, body.template.name, body.template.data);
    subject = rendered.subject ?? subject;
    textBody = rendered.text ?? textBody;
    htmlBody = rendered.html ?? htmlBody;
  }

  // Persist the mail document
  await insertMail(env.DB, {
    id,
    to,
    cc,
    bcc,
    from,
    replyTo,
    headers: body.headers || null,
    subject,
    textBody,
    htmlBody,
    messageId: body.message.messageId || null,
    templateName: body.template?.name || null,
    templateData: body.template?.data || null,
  });

  // Attempt to send immediately
  await updateDeliveryState(env.DB, id, "PROCESSING");

  const result = await sendEmail(env, {
    from,
    to,
    cc,
    bcc,
    replyTo,
    subject,
    textBody,
    htmlBody,
    messageId: body.message.messageId || null,
    headers: body.headers || null,
  });

  if (!result.success) {
    await updateDeliveryState(env.DB, id, "ERROR", {
      error: result.error ?? "Unknown send error",
      info: JSON.stringify({ accepted: result.accepted, rejected: result.rejected }),
    });
    const doc = await getMail(env.DB, id);
    return Response.json(doc, { status: 202 });
  }

  await updateDeliveryState(env.DB, id, "SUCCESS", {
    info: JSON.stringify({ accepted: result.accepted, rejected: result.rejected }),
  });

  const doc = await getMail(env.DB, id);
  return Response.json(doc, { status: 201 });
}

async function handleGetMail(id: string, env: Env): Promise<Response> {
  const doc = await getMail(env.DB, id);
  if (!doc) throw new NotFoundError("Mail", id);
  return Response.json(doc);
}

async function handleListMail(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const state = url.searchParams.get("state") || undefined;

  const result = await listMail(env.DB, { limit, offset, state });
  return Response.json(result);
}

async function handleRetryMail(id: string, env: Env): Promise<Response> {
  const doc = await getMail(env.DB, id);
  if (!doc) throw new NotFoundError("Mail", id);

  if (doc.delivery.state !== "ERROR" && doc.delivery.state !== "RETRY") {
    throw new ValidationError(`Cannot retry mail in state '${doc.delivery.state}'. Only ERROR or RETRY states can be retried.`);
  }

  // Mark as retrying
  await updateDeliveryState(env.DB, id, "RETRY");

  // Re-attempt send
  await updateDeliveryState(env.DB, id, "PROCESSING");

  const result = await sendEmail(env, {
    from: doc.from,
    to: doc.to,
    cc: doc.cc,
    bcc: doc.bcc,
    replyTo: doc.replyTo,
    subject: doc.subject,
    textBody: doc.textBody,
    htmlBody: doc.htmlBody,
    messageId: doc.messageId,
    headers: doc.headers,
  });

  if (!result.success) {
    await updateDeliveryState(env.DB, id, "ERROR", {
      error: result.error ?? "Unknown send error",
      info: JSON.stringify({ accepted: result.accepted, rejected: result.rejected }),
    });
  } else {
    await updateDeliveryState(env.DB, id, "SUCCESS", {
      info: JSON.stringify({ accepted: result.accepted, rejected: result.rejected }),
    });
  }

  const updated = await getMail(env.DB, id);
  return Response.json(updated);
}

// ---------------------------------------------------------------------------
// Template handlers
// ---------------------------------------------------------------------------

async function handleCreateTemplate(request: Request, env: Env): Promise<Response> {
  const body = await request.json<TemplateRequest>();

  if (!body.name) {
    throw new ValidationError("Template 'name' is required");
  }
  if (!body.subject && !body.text && !body.html) {
    throw new ValidationError("At least one of 'subject', 'text', or 'html' is required");
  }

  await upsertTemplate(env.DB, body);
  const template = await getTemplate(env.DB, body.name);
  return Response.json(template, { status: 201 });
}

async function handleGetTemplate(name: string, env: Env): Promise<Response> {
  const template = await getTemplate(env.DB, name);
  if (!template) throw new NotFoundError("Template", name);
  return Response.json(template);
}

async function handleListTemplates(env: Env): Promise<Response> {
  const templates = await listTemplates(env.DB);
  return Response.json({ results: templates });
}
