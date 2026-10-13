import { useCallback, useEffect, useState } from "react";
import { useHousehold } from "../lib/household-context";

type Status = "checking" | "unsupported" | "needs-install" | "denied" | "off" | "on";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () => matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;

/** Turns on push alerts on this phone for the chosen family member. */
export function AlertsCard({ me }: { me: string }) {
  const { config, post, household } = useHousehold();
  const [status, setStatus] = useState<Status>("checking");
  const [subscribedAs, setSubscribedAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const current = useCallback(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setStatus(isIos() && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") return setStatus("denied");
    current()
      .then((sub) => setStatus(sub ? "on" : "off"))
      .catch(() => setStatus("off"));
  }, [current]);

  // If the phone is on but "I am" changes, re-register under the new name.
  useEffect(() => {
    if (status !== "on" || !subscribedAs || subscribedAs === me) return;
    void current().then((sub) => {
      if (sub) return post("push", { action: "subscribe", subscription: sub.toJSON(), familyName: me }).then(() => setSubscribedAs(me));
    });
  }, [me, status, subscribedAs, current, post]);

  if (!config.pushPublicKey) return null;
  const elder = household?.elder.name ?? "your family member";

  const turnOn = async () => {
    setBusy(true);
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.pushPublicKey!) }));
      await post("push", { action: "subscribe", subscription: sub.toJSON(), familyName: me });
      setSubscribedAs(me);
      setStatus("on");
      await post("push", { action: "test", subscription: sub.toJSON(), familyName: me });
      setNote("Done. You should see a test notification now.");
    } catch (e) {
      setNote(
        `Couldn't turn on alerts on this phone (${(e as Error).message}). ` +
          "Check that notifications are allowed for this site and, on Android, that you're using Chrome.",
      );
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setNote(null);
    const sub = await current();
    if (!sub) return setStatus("off");
    try {
      await post("push", { action: "test", subscription: sub.toJSON(), familyName: me });
      setNote("Test sent.");
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  const turnOff = async () => {
    const sub = await current();
    if (sub) {
      await post("push", { action: "unsubscribe", subscription: sub.toJSON() }).catch(() => {});
      await sub.unsubscribe();
    }
    setStatus("off");
    setNote(null);
  };

  return (
    <section className="card" aria-labelledby="alerts-on-h">
      <h2 id="alerts-on-h">Alerts on this phone</h2>
      {status === "checking" && <p className="muted">Checking…</p>}
      {status === "unsupported" && (
        <p className="muted">This browser can't receive alerts. On Android, use Chrome.</p>
      )}
      {status === "needs-install" && (
        <p className="muted">
          On iPhone: tap Share → <strong>Add to Home Screen</strong>, open Kinly from there, then come back to this
          page.
        </p>
      )}
      {status === "denied" && (
        <p className="muted">
          Notifications are blocked for this site. Allow them in the browser's site settings, then reload.
        </p>
      )}
      {status === "off" && (
        <>
          <p>Get a notification on this phone when {elder} asks for help, misses a medicine, or sends you a message.</p>
          <button className="btn btn--primary" onClick={turnOn} disabled={busy}>
            {busy ? "Turning on…" : `Turn on alerts for ${me}`}
          </button>
        </>
      )}
      {status === "on" && (
        <>
          <p>
            Alerts are on for <strong>{me}</strong> on this phone. Press <strong>I'm on it</strong> on an alert to let
            everyone know you're handling it.
          </p>
          <div className="form__actions">
            <button className="btn" onClick={test}>
              Send a test
            </button>
            <button className="btn" onClick={turnOff}>
              Turn off
            </button>
          </div>
        </>
      )}
      {note && <p role="status">{note}</p>}
    </section>
  );
}
