import { createECDH, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import type { Household } from "../src/shared/types.js";

// Web push alerts to family phones. No third-party service or account is
// needed: the browser's own push service delivers them, and the VAPID keys
// that identify this app are derived from KINLY_TOOL_SECRET, so there is
// nothing extra to configure.

export interface PushRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Family member this phone belongs to. */
  familyName: string;
  createdAt: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Same tag replaces an earlier notification (e.g. "Esi is on it" replaces the alert). */
  tag: string;
  url: string;
  /** Present on alerts that can be acknowledged from the notification. */
  ack?: { householdId: string; alertId: string; by: string; token: string };
  urgent?: boolean;
}

export type PushResult = "ok" | "gone" | "error";
export type PushSender = (sub: PushRecord, payload: PushPayload) => Promise<PushResult>;

const b64url = (buf: Buffer) => buf.toString("base64url");

/** Deterministic P-256 VAPID keys from a secret (or explicit keys from the environment). */
export function vapidKeys(secret: string): { publicKey: string; privateKey: string } {
  for (let i = 0; i < 16; i++) {
    const priv = Buffer.from(hkdfSync("sha256", secret, "kinly-vapid", `p256-${i}`, 32));
    try {
      const ecdh = createECDH("prime256v1");
      ecdh.setPrivateKey(priv); // throws in the (astronomically rare) out-of-range case
      return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(priv) };
    } catch {
      /* try the next counter */
    }
  }
  throw new Error("Could not derive VAPID keys.");
}

/** Lets a notification's "I'm on it" button acknowledge one alert without the PIN. */
export function ackToken(secret: string, householdId: string, alertId: string, by: string): string {
  return createHmac("sha256", secret).update(`ack:${householdId}:${alertId}:${by}`).digest("base64url");
}

export function verifyAckToken(secret: string, householdId: string, alertId: string, by: string, token: string) {
  const want = Buffer.from(ackToken(secret, householdId, alertId, by));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function webPushSender(keys: { publicKey: string; privateKey: string }, subject: string): PushSender {
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload),
        {
          TTL: 6 * 60 * 60,
          urgency: payload.urgent ? "high" : "normal",
          vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
        },
      );
      return "ok";
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return "gone"; // phone unsubscribed or uninstalled
      console.error("push failed", status, (e as Error).message);
      return "error";
    }
  };
}

interface Outgoing {
  to: PushRecord[];
  payload: (sub: PushRecord) => PushPayload;
}

/** Works out which notifications a change to the household should send. */
export function notificationsFor(before: Household, after: Household, secret: string): Outgoing[] {
  const subs = after.push ?? [];
  if (!subs.length) return [];
  const elder = after.elder.name;
  const out: Outgoing[] = [];
  const beforeAlerts = new Map(before.alerts.map((a) => [a.id, a]));

  for (const alert of after.alerts) {
    const prev = beforeAlerts.get(alert.id);
    if (!prev) {
      const missed = alert.source === "missed";
      out.push({
        to: subs,
        payload: (sub) => ({
          title: missed ? `${elder} missed a medicine` : `${elder} needs help`,
          body: alert.reason,
          tag: `alert-${alert.id}`,
          url: "/family",
          urgent: true,
          ack: {
            householdId: after.id,
            alertId: alert.id,
            by: sub.familyName,
            token: ackToken(secret, after.id, alert.id, sub.familyName),
          },
        }),
      });
    } else if (!prev.acknowledgedAt && alert.acknowledgedAt) {
      // Tell everyone else, so two people don't both drop everything.
      const by = alert.acknowledgedBy ?? "Someone";
      out.push({
        to: subs.filter((s) => s.familyName !== alert.acknowledgedBy),
        payload: () => ({
          title: `${by} is on it`,
          body: alert.reason,
          tag: `alert-${alert.id}`,
          url: "/family",
        }),
      });
    }
  }

  const seen = new Set(before.messages.map((m) => m.id));
  for (const m of after.messages) {
    if (seen.has(m.id) || m.direction !== "elder") continue;
    const addressed = subs.filter((s) => s.familyName.toLowerCase() === m.familyName.toLowerCase());
    out.push({
      to: addressed.length ? addressed : subs,
      payload: () => ({
        title: `Message from ${elder}`,
        body: m.text,
        tag: `message-${m.id}`,
        url: "/family",
      }),
    });
  }
  return out;
}

/** Sends the notifications; returns endpoints that no longer exist so they can be removed. */
export async function sendAll(outgoing: Outgoing[], send: PushSender): Promise<string[]> {
  const jobs = outgoing.flatMap((o) => o.to.map((sub) => send(sub, o.payload(sub)).then((r) => ({ r, sub }))));
  const results = await Promise.all(jobs);
  return results.filter((x) => x.r === "gone").map((x) => x.sub.endpoint);
}
