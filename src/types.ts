/**
 * Type definitions mirroring the Firebase Firestore Send Email document schema.
 *
 * Usage: POST a MailRequest to /mail. The worker persists it as a MailDocument
 * with delivery status tracking, then sends via the send_email binding.
 */

/** Delivery states matching Firebase's firestore-send-email extension. */
export type DeliveryState =
  | "PENDING"
  | "PROCESSING"
  | "SUCCESS"
  | "ERROR"
  | "RETRY";

/** Delivery status tracking, stored in the D1 mail table. */
export interface DeliveryStatus {
  state: DeliveryState;
  startTime: string | null;
  endTime: string | null;
  error: string | null;
  attempts: number;
  info: DeliveryInfo | null;
}

export interface DeliveryInfo {
  messageId: string | null;
  accepted: string[];
  rejected: string[];
}

/** The request body posted to POST /mail. */
export interface MailRequest {
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  message: {
    subject: string;
    text?: string;
    html?: string;
    messageId?: string;
  };
  template?: {
    name: string;
    data: Record<string, unknown>;
  };
}

/** A persisted mail document with delivery status. */
export interface MailDocument {
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
  delivery: DeliveryStatus;
  createdAt: string;
  updatedAt: string;
}

/** Template stored in D1 for Handlebars rendering. */
export interface EmailTemplate {
  name: string;
  subject: string | null;
  text: string | null;
  html: string | null;
  partial: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Request body for POST /templates. */
export interface TemplateRequest {
  name: string;
  subject?: string;
  text?: string;
  html?: string;
  partial?: boolean;
}

/** Cloudflare Worker environment bindings. */
export interface Env {
  SEND_EMAIL: {
    send(message: EmailMessage): Promise<void>;
  };
  DB: D1Database;
  DEFAULT_FROM: string;
  DEFAULT_REPLY_TO: string;
}
