import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";
import type { Env } from "./types";

export interface SendOptions {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string | null;
  subject: string;
  textBody: string | null;
  htmlBody: string | null;
  messageId: string | null;
  headers: Record<string, string> | null;
}

export interface SendResult {
  success: boolean;
  accepted: string[];
  rejected: string[];
  error: string | null;
}

/**
 * Build a MIME message and send it via the Cloudflare send_email binding.
 */
export async function sendEmail(env: Env, opts: SendOptions): Promise<SendResult> {
  if (opts.to.length === 0 && opts.cc.length === 0 && opts.bcc.length === 0) {
    throw new Error("No recipients specified");
  }

  const msg = createMimeMessage();

  // Set sender
  msg.setSender({ addr: opts.from });

  // Set recipients using mimetext's setTo/setCc/setBcc methods
  if (opts.to.length > 0) {
    msg.setTo(opts.to);
  }
  if (opts.cc.length > 0) {
    msg.setCc(opts.cc);
  }
  if (opts.bcc.length > 0) {
    msg.setBcc(opts.bcc);
  }

  // Set subject
  msg.setSubject(opts.subject);

  // Add reply-to header
  if (opts.replyTo) {
    msg.setHeader("Reply-To", opts.replyTo);
  }

  // Add message-id header
  if (opts.messageId) {
    msg.setHeader("Message-ID", opts.messageId);
  }

  // Add custom headers
  if (opts.headers) {
    for (const [key, value] of Object.entries(opts.headers)) {
      msg.setHeader(key, value);
    }
  }

  // Add body content
  if (opts.htmlBody && opts.textBody) {
    // Multipart: both HTML and plain text
    msg.addMessage({ contentType: "text/html", data: opts.htmlBody });
    msg.addMessage({ contentType: "text/plain", data: opts.textBody });
  } else if (opts.htmlBody) {
    msg.addMessage({ contentType: "text/html", data: opts.htmlBody });
  } else if (opts.textBody) {
    msg.addMessage({ contentType: "text/plain", data: opts.textBody });
  } else {
    throw new Error("No email body provided (need text or html)");
  }

  // Build and send the email message
  const allRecipients = [...opts.to, ...opts.cc, ...opts.bcc];
  const emailMessage = new EmailMessage(opts.from, allRecipients.join(","), msg.asRaw());

  try {
    await env.SEND_EMAIL.send(emailMessage);
    return {
      success: true,
      accepted: allRecipients,
      rejected: [],
      error: null,
    };
  } catch (e) {
    return {
      success: false,
      accepted: [],
      rejected: allRecipients,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
