/** Shared cache version — Serwist also manages precache; keep for warm-cache compat */
export const OFFLINE_CACHE_VERSION = "windoor-v26";
export const OFFLINE_SHELL_CACHE = `${OFFLINE_CACHE_VERSION}-shell`;
export const OFFLINE_STATIC_CACHE = `${OFFLINE_CACHE_VERSION}-static`;

/** Primary Serwist service worker URL (build-generated precache) */
export const SERWIST_SW_URL = "/serwist/sw.js";
