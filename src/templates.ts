import Handlebars from "handlebars";
import { getTemplate, getPartials } from "./db";
import { TemplateError } from "./errors";

export interface RenderedTemplate {
  subject: string | null;
  text: string | null;
  html: string | null;
}

/**
 * Render a Handlebars template from D1 with the given data.
 * Loads all registered partials and compiles the template fields.
 */
export async function renderTemplate(
  db: D1Database,
  templateName: string,
  data: Record<string, unknown>
): Promise<RenderedTemplate> {
  // Load the template
  const template = await getTemplate(db, templateName);
  if (!template) {
    throw new TemplateError(`Template not found: ${templateName}`);
  }

  // Create a fresh Handlebars instance to avoid cross-request pollution
  const hbs = Handlebars.create();

  // Load and register all partials from D1
  const partials = await getPartials(db);
  for (const partial of partials) {
    // Register partials for each content type separately
    if (partial.html) {
      hbs.registerPartial(partial.name + "_html", partial.html);
    }
    if (partial.text) {
      hbs.registerPartial(partial.name + "_text", partial.text);
    }
    if (partial.subject) {
      hbs.registerPartial(partial.name + "_subject", partial.subject);
    }
    // Also register a default partial using the most specific content type
    // This matches Firebase behavior where {{> footer }} picks the right partial
    // based on context. Since we can't do context-aware rendering simply,
    // we register the html partial as default (falls back to text then subject).
    const defaultContent = partial.html ?? partial.text ?? partial.subject;
    if (defaultContent) {
      hbs.registerPartial(partial.name, defaultContent);
    }
  }

  // Helper for other templates to reference partials by name with content-type suffix
  // e.g. in a template: {{> footer_html}} or just {{> footer}}
  const rendered: RenderedTemplate = {
    subject: null,
    text: null,
    html: null,
  };

  if (template.subject) {
    try {
      rendered.subject = hbs.compile(template.subject)(data);
    } catch (e) {
      throw new TemplateError(`Failed to render template subject: ${(e as Error).message}`);
    }
  }

  if (template.text) {
    try {
      // For text templates, override the default partial to use the text variant
      for (const partial of partials) {
        if (partial.text) {
          hbs.registerPartial(partial.name, partial.text);
        }
      }
      rendered.text = hbs.compile(template.text)(data);
    } catch (e) {
      throw new TemplateError(`Failed to render template text: ${(e as Error).message}`);
    }
  }

  if (template.html) {
    try {
      // For html templates, override the default partial to use the html variant
      for (const partial of partials) {
        if (partial.html) {
          hbs.registerPartial(partial.name, partial.html);
        } else if (partial.text) {
          hbs.registerPartial(partial.name, partial.text);
        }
      }
      rendered.html = hbs.compile(template.html)(data);
    } catch (e) {
      throw new TemplateError(`Failed to render template html: ${(e as Error).message}`);
    }
  }

  return rendered;
}
