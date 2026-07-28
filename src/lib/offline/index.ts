export type {
  OutboxEntry,
  OutboxOpType,
  OutboxStatus,
  OutboxInvoicePayload,
  SnapshotBundle,
  SyncOutboxEntry,
  SyncEntityType,
} from "@/lib/offline/types";
export {
  getOfflineDb,
  getMeta,
  setMeta,
  requestPersistentStorage,
  getStorageEstimate,
  clearLocalBusinessData,
  listActiveEntities,
  getEntity,
  putEntity,
} from "@/lib/offline/db";
export {
  isBrowserOnline,
  isLikelyNetworkError,
  subscribeConnectivity,
} from "@/lib/offline/network";
export {
  enqueueOutbox,
  enqueueSyncOp,
  listOutbox,
  listSyncOutbox,
  countPendingOutbox,
  cancelOutboxEntry,
  retryOutboxEntry,
  outboxStatusLabel,
  makeTempNumber,
} from "@/lib/offline/outbox";
export {
  notifyIdMapUpdated,
  subscribeIdMapUpdated,
  ID_MAP_UPDATED_EVENT,
  type IdMapUpdatedDetail,
} from "@/lib/offline/id-map-events";
export {
  getSnapshot,
  pullSnapshot,
  rebuildCompatSnapshot,
  applyOptimisticInvoiceToSnapshot,
  revertOptimisticInvoiceFromSnapshot,
  applyOptimisticPartyPaymentToSnapshot,
  applyOptimisticExpenseToSnapshot,
  dashboardFromSnapshot,
  tierPricingFromSnapshot,
} from "@/lib/offline/snapshot";
export {
  syncOutbox,
  retryAndSync,
  bootstrapLocalData,
  needsBootstrapRefresh,
  getInstalledDataPackVersion,
  type SyncResult,
  type BootstrapProgress,
} from "@/lib/offline/sync";
export { DATA_PACK_VERSION } from "@/lib/offline/pack-version";
export { listExpensesLocal } from "@/lib/offline/expenses-local";
export {
  createInvoiceOnlineOrQueue,
  applyPartyPaymentOnlineOrQueue,
  createExpenseOnlineOrQueue,
  updateExpenseOnlineOrQueue,
  deleteExpenseOnlineOrQueue,
  createExpenseAccountOnlineOrQueue,
} from "@/lib/offline/mutations";
export {
  resolveAuthUser,
  saveCachedProfile,
  loadCachedProfile,
  clearCachedProfile,
  enrollOfflineCredential,
  verifyOfflineLogin,
  getOfflineSession,
  clearOfflineSession,
  setOfflineSession,
  signOutLocalKeepingEnrollment,
  listEnrolledOfflineUsers,
  removeOfflineUserFromDevice,
  revokeOfflineCredentialByUserId,
} from "@/lib/offline/auth-session";
export {
  isOfflinePackReady,
} from "@/lib/offline/warm-cache";
export {
  OFFLINE_CACHE_VERSION,
  OFFLINE_SHELL_CACHE,
  OFFLINE_STATIC_CACHE,
  SERWIST_SW_URL,
} from "@/lib/offline/cache-names";
export {
  withTimeout,
  readLocalThenNetwork,
  probeOnline,
  isEffectivelyOnline,
  isLikelyOnline,
  getCachedOnline,
  setConnectivityCache,
  TimeoutError,
} from "@/lib/offline/local-first";
export {
  scheduleBackgroundSync,
  setBackgroundSyncRunner,
} from "@/lib/offline/background-sync";
export {
  tickHlc,
  compareHlc,
  calibrateFromServer,
  isClockSkewUnsafe,
  getClockOffsetMs,
} from "@/lib/offline/hlc";
export {
  getOrCreateDeviceId,
  getDeviceState,
  updateDeviceState,
} from "@/lib/offline/device";
export * from "@/lib/offline/repositories";
export { downloadLocalBackup, buildLocalBackup } from "@/lib/offline/local-backup";
