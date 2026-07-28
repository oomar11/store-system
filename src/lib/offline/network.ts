/** Network helpers for offline mode */

export function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function isLikelyNetworkError(err: unknown): boolean {
  if (!isBrowserOnline()) return true;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|timeout|offline|ERR_INTERNET|ECONNREFUSED|ENOTFOUND|FetchError|TypeError/i.test(
    message
  );
}

export type ConnectivityListener = (online: boolean) => void;

export function subscribeConnectivity(listener: ConnectivityListener): () => void {
  if (typeof window === "undefined") return () => {};
  const onOnline = () => listener(true);
  const onOffline = () => listener(false);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}
