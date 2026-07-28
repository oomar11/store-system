/** Broadcast when local→remote id mappings are written after sync */

export const ID_MAP_UPDATED_EVENT = "windoor-id-map-updated";

export type IdMapUpdatedDetail = {
  localId: string;
  remoteId: string;
  remoteNumber: string;
  kind: string;
};

export function notifyIdMapUpdated(detail: IdMapUpdatedDetail): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(ID_MAP_UPDATED_EVENT, { detail })
    );
  } catch {
    /* ignore */
  }
}

export function subscribeIdMapUpdated(
  listener: (detail: IdMapUpdatedDetail) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<IdMapUpdatedDetail>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(ID_MAP_UPDATED_EVENT, handler);
  return () => window.removeEventListener(ID_MAP_UPDATED_EVENT, handler);
}
