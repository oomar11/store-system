/* Windoor PWA — cache-first shells so offline never hangs on network */
const CACHE_VERSION = "windoor-v26";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Never precache `/` — root used to 307 and Cache/SW + Chrome → ERR_FAILED
const PUBLIC_SHELL = [
  "/app-start.html",
  "/offline.html",
  "/manifest.json",
  "/login",
];

const BOOTSTRAP_HTML = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="theme-color" content="#1473e6"/><title>ويندور</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Segoe UI,Tahoma,sans-serif;background:#1473e6;color:#fff;text-align:center;padding:24px}a,button{border:0;border-radius:10px;background:#fff;color:#1473e6;font-weight:700;padding:12px 18px;text-decoration:none;display:inline-block;margin:6px}</style></head><body><div><h1>ويندور</h1><p>الشاشة دي لسة مش محفوظة أوفلاين.</p><p><a href="/app-start.html">إعادة المحاولة</a></p><p><a href="/pos">نقطة البيع</a> <a href="/dashboard">لوحة التحكم</a></p></div></body></html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        PUBLIC_SHELL.map(async (url) => {
          try {
            const res = await fetch(url, { credentials: "same-origin" });
            if (res.ok) await cache.put(url, res.clone());
          } catch {
            /* ignore */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/icon.png" ||
    url.pathname === "/sw.js" ||
    url.pathname === "/manifest.json" ||
    url.pathname === "/app-start.html" ||
    url.pathname === "/offline.html" ||
    /\.(?:js|css|woff2?|png|jpg|jpeg|gif|webp|ico|svg|html)$/i.test(
      url.pathname
    )
  );
}

function bootstrapResponse() {
  return new Response(BOOTSTRAP_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function matchCached(request) {
  const hit = await caches.match(request, { ignoreSearch: true });
  if (hit) return hit;
  if (typeof request !== "string") {
    const url = new URL(request.url);
    return caches.match(url.pathname, { ignoreSearch: true });
  }
  return null;
}

async function putShell(pathname, response) {
  if (!response || !response.ok || response.type === "opaque") return;
  const ct = response.headers.get("content-type") || "";
  if (!ct.includes("text/html") && !pathname.endsWith(".json")) return;
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(pathname, response.clone());
}

async function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Navigation fetch that always follows redirects (avoids opaque-redirect ERR_FAILED). */
function navigationNetworkRequest(request) {
  const url = new URL(request.url);
  return new Request(url.href, {
    method: "GET",
    headers: request.headers,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "follow",
    signal: undefined,
  });
}

async function recoveryShell() {
  for (const path of ["/app-start.html", "/offline.html", "/dashboard", "/m"]) {
    const shell = await caches.match(path, { ignoreSearch: true });
    if (shell) return shell;
  }
  return bootstrapResponse();
}

/**
 * Cache-first navigations: never block on a dead network.
 * If a shell is cached, return it immediately and refresh in background.
 */
async function navigationHandler(request) {
  const url = new URL(request.url);

  // Let the browser handle `/` itself — safest against redirect/SW ERR_FAILED
  if (url.pathname === "/" || url.pathname === "") {
    try {
      const response = await fetchWithTimeout(
        navigationNetworkRequest(request),
        2500
      );
      if (response && response.ok && response.type !== "opaqueredirect") {
        return response;
      }
    } catch {
      /* fall through to recovery */
    }
    return recoveryShell();
  }

  const cached =
    (await matchCached(request)) ||
    (await caches.match(url.pathname, { ignoreSearch: true }));

  const browserOffline = self.navigator.onLine === false;
  const netReq = navigationNetworkRequest(request);

  if (cached) {
    if (!browserOffline) {
      // Stale-while-revalidate with short timeout — never blocks UI
      void (async () => {
        try {
          const response = await fetchWithTimeout(netReq, 2000);
          if (response && response.ok && response.type !== "opaqueredirect") {
            const finalPath = new URL(response.url).pathname;
            await putShell(url.pathname, response.clone());
            if (finalPath !== url.pathname) {
              await putShell(finalPath, response.clone());
            }
          }
        } catch {
          /* ignore */
        }
      })();
    }
    return cached;
  }

  if (browserOffline) {
    return recoveryShell();
  }

  try {
    const response = await fetchWithTimeout(netReq, 2500);
    if (
      !response ||
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    ) {
      return recoveryShell();
    }
    if (response.ok) {
      const finalPath = new URL(response.url).pathname;
      await putShell(url.pathname, response.clone());
      if (finalPath !== url.pathname) {
        await putShell(finalPath, response.clone());
      }
    }
    return response;
  } catch {
    return recoveryShell();
  }
}

async function staticHandler(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const byPath = await caches.match(new URL(request.url).pathname, {
    ignoreSearch: true,
  });
  if (byPath) return byPath;

  if (self.navigator.onLine === false) {
    const url = new URL(request.url);
    if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
      return new Response("", {
        status: 503,
        statusText: "Offline asset missing",
        headers: {
          "Content-Type": url.pathname.endsWith(".js")
            ? "application/javascript"
            : "text/css",
          "Cache-Control": "no-store",
        },
      });
    }
    return new Response("", { status: 503 });
  }

  try {
    const response = await fetchWithTimeout(request, 3000);
    if (response && response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request, response.clone());
      await cache.put(new URL(request.url).pathname, response.clone());
    }
    return response;
  } catch {
    const fallback = await caches.match(request, { ignoreSearch: true });
    if (fallback) return fallback;
    const url = new URL(request.url);
    if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
      return new Response("", {
        status: 503,
        statusText: "Offline asset missing",
        headers: {
          "Content-Type": url.pathname.endsWith(".js")
            ? "application/javascript"
            : "text/css",
          "Cache-Control": "no-store",
        },
      });
    }
    return new Response("", { status: 503 });
  }
}

async function networkFirst(request) {
  if (self.navigator.onLine === false) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return new Response("{}", {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const response = await fetchWithTimeout(request, 2500);
    if (response && response.ok && response.type !== "opaque") {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return new Response("{}", {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    // Health probe must fail fast offline so the app doesn't hang
    const timeoutMs = url.pathname.startsWith("/api/health") ? 2500 : 2000;
    event.respondWith(
      (async () => {
        if (self.navigator.onLine === false) {
          return new Response(JSON.stringify({ offline: true }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          return await fetchWithTimeout(request, timeoutMs);
        } catch {
          return new Response(JSON.stringify({ offline: true }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
      })()
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staticHandler(request));
    return;
  }

  if (
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html")
  ) {
    event.respondWith(navigationHandler(request));
    return;
  }

  // Next.js RSC / soft-nav — fail fast offline (hard-nav handler in app takes over)
  const accept = request.headers.get("accept") || "";
  if (
    accept.includes("text/x-component") ||
    request.headers.get("RSC") === "1" ||
    request.headers.get("Next-Router-Prefetch") === "1"
  ) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (self.navigator.onLine === false) {
          if (cached) return cached;
          return new Response(null, { status: 503 });
        }
        try {
          const response = await fetchWithTimeout(request, 1200);
          if (response && response.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            await cache.put(request, response.clone());
          }
          return response;
        } catch {
          if (cached) return cached;
          return new Response(null, { status: 503 });
        }
      })()
    );
    return;
  }

  event.respondWith(networkFirst(request));
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (data.type === "CACHE_URLS" && Array.isArray(data.urls)) {
    event.waitUntil(
      (async () => {
        const shell = await caches.open(SHELL_CACHE);
        const staticCache = await caches.open(STATIC_CACHE);
        await Promise.all(
          data.urls.map(async (raw) => {
            try {
              const u = new URL(raw, self.location.origin);
              if (u.origin !== self.location.origin) return;
              const target = isStaticAsset(u) ? staticCache : shell;
              const res = await fetch(u.href, {
                credentials: "same-origin",
                redirect: "follow",
              });
              if (res.status === 200) {
                await target.put(u.pathname, res.clone());
                await target.put(u.href, res.clone());
              }
            } catch {
              /* ignore */
            }
          })
        );
      })()
    );
  }
});
