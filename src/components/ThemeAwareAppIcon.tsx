"use client";

import { useEffect } from "react";

// Blue brand icons live under fresh `app-*` filenames: the legacy service
// worker matches `/icons/*` with `ignoreSearch`, so `?v=` busting is ignored
// and the old white icons keep being served from cache.
const ICONS = {
  favicon: "/icons/app-favicon.ico",
  icon192: "/icons/app-192.png",
  icon512: "/icons/app-512.png",
  apple: "/icons/app-apple-180.png",
};

function upsertIconLink(attrs: {
  rel: string;
  href: string;
  sizes?: string;
  type?: string;
  id: string;
}) {
  let link = document.getElementById(attrs.id) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = attrs.id;
    document.head.appendChild(link);
  }
  link.rel = attrs.rel;
  link.href = attrs.href;
  if (attrs.sizes) link.setAttribute("sizes", attrs.sizes);
  if (attrs.type) link.type = attrs.type;
  link.removeAttribute("media");
}

/** Use the blue brand icons (visible on light OS chrome / home screens). */
export function ThemeAwareAppIcon() {
  useEffect(() => {
    // Drop any stale white-icon links rendered by older builds
    document
      .querySelectorAll<HTMLLinkElement>(
        'link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="shortcut icon"]'
      )
      .forEach((link) => {
        if (link.href.includes("-white")) link.remove();
      });

    upsertIconLink({
      id: "windoor-favicon",
      rel: "icon",
      href: ICONS.favicon,
      sizes: "48x48",
      type: "image/x-icon",
    });
    upsertIconLink({
      id: "windoor-icon-192",
      rel: "icon",
      href: ICONS.icon192,
      sizes: "192x192",
      type: "image/png",
    });
    upsertIconLink({
      id: "windoor-icon-512",
      rel: "icon",
      href: ICONS.icon512,
      sizes: "512x512",
      type: "image/png",
    });
    upsertIconLink({
      id: "windoor-shortcut",
      rel: "shortcut icon",
      href: ICONS.favicon,
      type: "image/x-icon",
    });
    upsertIconLink({
      id: "windoor-apple",
      rel: "apple-touch-icon",
      href: ICONS.apple,
      sizes: "180x180",
    });
  }, []);

  return null;
}
