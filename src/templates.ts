import { getTemplate, getPartials } from "./db";
import { TemplateError } from "./errors";

export interface RenderedTemplate {
  subject: string | null;
  text: string | null;
  html: string | null;
}

function simpleInterpolate(source: string, data: Record<string, unknown>): string {
  return source.replace(/\{\{(.+?)\}\}/g, (_, key: string) => {
    const value = key.trim().split(".").reduce((obj: unknown, k: string) => {
      if (obj && typeof obj === "object") {
        return (obj as Record<string, unknown>)[k];
      }
      return undefined;
    }, data);
    return value !== undefined ? String(value) : "";
  });
}

export async function renderTemplate(
  db: D1Database,
  templateName: string,
  data: Record<string, unknown>
): Promise<RenderedTemplate> {
  const template = await getTemplate(db, templateName);
  if (!template) {
    throw new TemplateError(`Template not found: ${templateName}`);
  }

  const rendered: RenderedTemplate = { subject: null, text: null, html: null };

  if (template.subject) {
    try {
      rendered.subject = simpleInterpolate(template.subject, data);
    } catch (e) {
      throw new TemplateError(`Failed to render template subject: ${(e as Error).message}`);
    }
  }

  if (template.text) {
    try {
      rendered.text = simpleInterpolate(template.text, data);
    } catch (e) {
      throw new TemplateError(`Failed to render template text: ${(e as Error).message}`);
    }
  }

  if (template.html) {
    try {
      rendered.html = simpleInterpolate(template.html, data);
    } catch (e) {
      throw new TemplateError(`Failed to render template html: ${(e as Error).message}`);
    }
  }

  return rendered;
}