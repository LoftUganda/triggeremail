import { describe, it, expect, vi, beforeEach } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type { MailRequest, DeliveryState } from "./types";

vi.mock("cloudflare:email", () => ({
  EmailMessage: class EmailMessage {
    constructor(from: string, to: string, raw: string) {}
  },
}));

describe("types", () => {
  it("MailRequest supports attachments", () => {
    const req = {
      to: "to@example.com",
      message: {
        subject: "Test",
        attachments: [
          { filename: "report.pdf", content: "base64data", contentType: "application/pdf" },
        ],
      },
    } as MailRequest;
    expect(req.message.attachments).toHaveLength(1);
    expect(req.message.attachments![0].filename).toBe("report.pdf");
  });

  it("DeliveryState has all Firebase states", () => {
    const states: DeliveryState[] = ["PENDING", "PROCESSING", "SUCCESS", "ERROR", "RETRY"];
    expect(states).toContain("SUCCESS");
    expect(states).toContain("ERROR");
  });
});

describe("sendEmail", () => {
  it("returns error when send fails", async () => {
    const { sendEmail } = await import("./mail");

    const env = {
      SEND_EMAIL: {
        send: vi.fn().mockRejectedValue(new Error("SMTP error")),
      },
    };

    const result = await sendEmail(env as any, {
      from: "from@example.com",
      to: ["to@example.com"],
      cc: [],
      bcc: [],
      replyTo: null,
      subject: "Test",
      textBody: "Hello",
      htmlBody: null,
      messageId: null,
      headers: null,
      attachments: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("SMTP error");
  });

  it("returns success when send succeeds", async () => {
    const { sendEmail } = await import("./mail");

    const env = {
      SEND_EMAIL: {
        send: vi.fn().mockResolvedValue(undefined),
      },
    };

    const result = await sendEmail(env as any, {
      from: "from@example.com",
      to: ["to@example.com"],
      cc: [],
      bcc: [],
      replyTo: null,
      subject: "Test",
      textBody: "Hello",
      htmlBody: null,
      messageId: null,
      headers: null,
      attachments: null,
    });

    expect(result.success).toBe(true);
    expect(result.accepted).toEqual(["to@example.com"]);
    expect(result.rejected).toEqual([]);
  });

  it("handles cc and bcc recipients", async () => {
    const { sendEmail } = await import("./mail");

    const env = {
      SEND_EMAIL: {
        send: vi.fn().mockResolvedValue(undefined),
      },
    };

    const result = await sendEmail(env as any, {
      from: "from@example.com",
      to: ["primary@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      replyTo: null,
      subject: "Test",
      textBody: "Hello",
      htmlBody: null,
      messageId: null,
      headers: null,
      attachments: null,
    });

    expect(result.accepted).toContain("primary@example.com");
    expect(result.accepted).toContain("cc@example.com");
    expect(result.accepted).toContain("bcc@example.com");
  });
});

describe("renderTemplate", () => {
  it("throws TemplateError when template not found", async () => {
    const { renderTemplate } = await import("./templates");

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        bind: vi.fn().mockReturnThis(),
      }),
    } as unknown as D1Database;

    await expect(renderTemplate(mockDb, "nonexistent", {})).rejects.toThrow("Template not found: nonexistent");
  });
});

describe("webhook", () => {
  it("skips when WEBHOOK_URL is not set", async () => {
    const { sendWebhook } = await import("./webhook");

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const env = {} as any;
    await sendWebhook(env, "onError", { id: "123" });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends POST with correct headers when WEBHOOK_SECRET is set", async () => {
    const { sendWebhook } = await import("./webhook");

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const env = {
      WEBHOOK_URL: "https://example.com/hook",
      WEBHOOK_SECRET: "secret-token",
    } as any;

    await sendWebhook(env, "onSuccess", { id: "mail-123", state: "SUCCESS" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret-token",
        },
      })
    );
  });

  it("sends event name and data in body", async () => {
    const { sendWebhook } = await import("./webhook");

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const env = {
      WEBHOOK_URL: "https://example.com/hook",
    } as any;

    const payload = { id: "mail-456", to: ["a@b.com"], subject: "Hello" };
    await sendWebhook(env, "onPending", payload);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.event).toBe("onPending");
    expect(body.data.id).toBe("mail-456");
    expect(body.timestamp).toBeTruthy();
  });

  it("skips when data is null", async () => {
    const { sendWebhook } = await import("./webhook");

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const env = { WEBHOOK_URL: "https://example.com/hook" } as any;
    await sendWebhook(env, "onComplete", null);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("db", () => {
  it("mail table includes attachments column", async () => {
    const { initSchema } = await import("./db");
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as D1Database;

    await initSchema(mockDb);

    const calls = (mockDb.prepare as any).mock.calls;
    const mailCreate = calls.find((c: string[]) => c[0].includes("to_recipients"));
    expect(mailCreate![0]).toContain("attachments TEXT");
  });

  it("templates table includes all required fields", async () => {
    const { initSchema } = await import("./db");
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as D1Database;

    await initSchema(mockDb);

    const calls = (mockDb.prepare as any).mock.calls;
    const templatesCreate = calls.find((c: string[]) => c[0].includes("name TEXT PRIMARY KEY"));
    expect(templatesCreate![0]).toContain("subject TEXT");
    expect(templatesCreate![0]).toContain("text TEXT");
    expect(templatesCreate![0]).toContain("html TEXT");
    expect(templatesCreate![0]).toContain("partial INTEGER");
  });
});