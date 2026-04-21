import type { DeliveryEventType, Env } from "./types";

export async function sendWebhook(
  env: Env,
  event: DeliveryEventType,
  data: unknown
): Promise<void> {
  if (!env.WEBHOOK_URL || data === null || data === undefined) return;

  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (env.WEBHOOK_SECRET) {
    headers["Authorization"] = `Bearer ${env.WEBHOOK_SECRET}`;
  }

  try {
    await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers,
      body,
    });
  } catch (e) {
    console.error(`Webhook failed for event ${event}:`, e);
  }
}