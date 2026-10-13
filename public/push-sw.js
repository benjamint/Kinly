/* Kinly push notifications. Loaded into the generated service worker via
   workbox importScripts (see vite.config.ts). Plain JS: it runs as-is. */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Kinly", body: event.data ? event.data.text() : "" };
  }
  const options = {
    body: data.body || "",
    tag: data.tag,
    renotify: Boolean(data.urgent),
    requireInteraction: Boolean(data.urgent),
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: data.urgent ? [300, 150, 300, 150, 600] : undefined,
    data: { url: data.url || "/family", ack: data.ack || null },
    actions: data.ack ? [{ action: "ack", title: "I'm on it" }] : [],
  };
  event.waitUntil(self.registration.showNotification(data.title || "Kinly", options));
});

async function openDashboard(url) {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = all.find((c) => new URL(c.url).pathname === url);
  if (existing) return existing.focus();
  return self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
  const { url, ack } = event.notification.data || {};
  event.notification.close();

  if (event.action === "ack" && ack) {
    event.waitUntil(
      fetch("/api/push-ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ack),
      })
        .then((res) =>
          self.registration.showNotification(res.ok ? "Thank you" : "Couldn't confirm", {
            body: res.ok
              ? "Everyone else has been told you're on it."
              : "Please open Kinly and press \"I'm on it\" there.",
            tag: event.notification.tag,
            icon: "/icon-192.png",
          }),
        )
        .catch(() => openDashboard(url || "/family")),
    );
    return;
  }
  event.waitUntil(openDashboard(url || "/family"));
});
