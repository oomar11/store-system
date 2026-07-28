import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  getMeta,
  getOfflineDb,
  setMeta,
  type OfflineCredentialRow,
  type OfflineSessionRow,
} from "@/lib/offline/db";
import { isBrowserOnline, isLikelyNetworkError } from "@/lib/offline/network";
import type { Profile } from "@/types";

const PROFILE_META_KEY = "cached_profile";
const PBKDF2_ITERATIONS = 210_000;
const OFFLINE_SESSION_HOURS = 24 * 14; // 14 days
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function usernameFromProfile(profile: Profile): string {
  const email = profile.email || "";
  if (email.endsWith("@store.local")) {
    return email.slice(0, -"@store.local".length).toLowerCase();
  }
  return email.split("@")[0]?.toLowerCase() || profile.id;
}

function b64FromBuf(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function bufFromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    let diff = a.length ^ b.length;
    for (let i = 0; i < a.length; i++) diff |= a[i]! ^ (b[i % b.length] || 0);
    return diff === 0 && false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function deriveVerifier(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

export async function saveCachedProfile(profile: Profile): Promise<void> {
  try {
    await setMeta(PROFILE_META_KEY, JSON.stringify(profile));
    await setMeta("cached_profile_user_id", profile.id);
  } catch {
    /* IndexedDB unavailable */
  }
}

export async function loadCachedProfile(
  userId?: string | null
): Promise<Profile | null> {
  try {
    const raw = await getMeta(PROFILE_META_KEY);
    if (!raw) return null;
    const profile = JSON.parse(raw) as Profile;
    if (userId && profile.id !== userId) return null;
    return profile;
  } catch {
    return null;
  }
}

export async function clearCachedProfile(): Promise<void> {
  try {
    await setMeta(PROFILE_META_KEY, "");
    await setMeta("cached_profile_user_id", "");
  } catch {
    /* ignore */
  }
}

/**
 * After successful online login: store PBKDF2 verifier (never the password).
 */
export async function enrollOfflineCredential(
  username: string,
  password: string,
  profile: Profile
): Promise<void> {
  if (typeof window === "undefined" || !crypto?.subtle) return;
  const uname = normalizeUsername(username);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = await deriveVerifier(password, salt, PBKDF2_ITERATIONS);
  const now = new Date().toISOString();
  const row: OfflineCredentialRow = {
    username: uname,
    user_id: profile.id,
    salt_b64: b64FromBuf(salt.buffer.slice(0) as ArrayBuffer),
    verifier_b64: b64FromBuf(verifier.buffer.slice(0) as ArrayBuffer),
    iterations: PBKDF2_ITERATIONS,
    profile_json: JSON.stringify(profile),
    enrolled_at: now,
    last_online_at: now,
    fail_count: 0,
    locked_until: null,
    revoked: false,
  };
  const db = getOfflineDb();
  // Replace any previous row for same user_id under different username
  const byUser = await db.offline_credentials
    .where("user_id")
    .equals(profile.id)
    .toArray();
  for (const old of byUser) {
    if (old.username !== uname) await db.offline_credentials.delete(old.username);
  }
  await db.offline_credentials.put(row);
  await putEntityProfile(profile);
}

async function putEntityProfile(profile: Profile): Promise<void> {
  try {
    const { putEntity } = await import("@/lib/offline/db");
    await putEntity("profiles", profile as unknown as Record<string, unknown>);
  } catch {
    /* ignore */
  }
}

export async function refreshOfflineEnrollmentOnline(
  profile: Profile,
  password?: string
): Promise<void> {
  const db = getOfflineDb();
  const uname = usernameFromProfile(profile);
  const existing = await db.offline_credentials.get(uname);
  if (!existing && !password) return;
  if (password) {
    await enrollOfflineCredential(uname, password, profile);
    return;
  }
  if (existing) {
    await db.offline_credentials.put({
      ...existing,
      profile_json: JSON.stringify(profile),
      last_online_at: new Date().toISOString(),
      revoked: profile.is_active === false,
      fail_count: 0,
      locked_until: null,
    });
    await putEntityProfile(profile);
  }
}

export async function listEnrolledOfflineUsers(): Promise<
  Array<{ username: string; full_name: string; user_id: string }>
> {
  const db = getOfflineDb();
  const rows = await db.offline_credentials
    .filter((r) => !r.revoked)
    .toArray();
  return rows.map((r) => {
    let full_name = r.username;
    try {
      full_name = (JSON.parse(r.profile_json) as Profile).full_name || r.username;
    } catch {
      /* ignore */
    }
    return { username: r.username, full_name, user_id: r.user_id };
  });
}

export async function revokeOfflineCredentialByUserId(
  userId: string
): Promise<void> {
  const db = getOfflineDb();
  const rows = await db.offline_credentials.where("user_id").equals(userId).toArray();
  for (const row of rows) {
    await db.offline_credentials.put({ ...row, revoked: true });
  }
  const session = await db.offline_session.get("active");
  if (session?.user_id === userId) {
    await clearOfflineSession();
  }
}

export async function removeOfflineUserFromDevice(
  username: string
): Promise<void> {
  const uname = normalizeUsername(username);
  const db = getOfflineDb();
  const row = await db.offline_credentials.get(uname);
  await db.offline_credentials.delete(uname);
  const session = await db.offline_session.get("active");
  if (session && (session.username === uname || session.user_id === row?.user_id)) {
    await clearOfflineSession();
  }
}

export async function setOfflineSession(
  profile: Profile,
  username: string,
  mode: "online" | "offline"
): Promise<void> {
  const now = Date.now();
  const row: OfflineSessionRow = {
    id: "active",
    user_id: profile.id,
    username: normalizeUsername(username),
    profile_json: JSON.stringify(profile),
    created_at: new Date(now).toISOString(),
    expires_at: new Date(
      now + OFFLINE_SESSION_HOURS * 60 * 60 * 1000
    ).toISOString(),
    mode,
  };
  await getOfflineDb().offline_session.put(row);
  await saveCachedProfile(profile);
  const { setMemoryProfile } = await import("@/lib/offline/session-memory");
  setMemoryProfile(profile);
}

export async function getOfflineSession(): Promise<{
  profile: Profile;
  username: string;
  mode: "online" | "offline";
  expires_at: string;
} | null> {
  try {
    const row = await getOfflineDb().offline_session.get("active");
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await clearOfflineSession();
      return null;
    }
    const profile = JSON.parse(row.profile_json) as Profile;
    if (profile.is_active === false) {
      await clearOfflineSession();
      return null;
    }
    return {
      profile,
      username: row.username,
      mode: row.mode,
      expires_at: row.expires_at,
    };
  } catch {
    return null;
  }
}

/** Clears active session only — keeps enrolled offline credentials. */
export async function clearOfflineSession(): Promise<void> {
  try {
    await getOfflineDb().offline_session.delete("active");
  } catch {
    /* ignore */
  }
  await clearCachedProfile();
  try {
    const { clearSessionMemory } = await import("@/lib/offline/session-memory");
    clearSessionMemory();
  } catch {
    /* ignore */
  }
}

export type OfflineLoginResult =
  | { ok: true; profile: Profile; username: string }
  | { ok: false; error: string; lockedUntil?: string };

export async function verifyOfflineLogin(
  username: string,
  password: string
): Promise<OfflineLoginResult> {
  if (typeof window === "undefined" || !crypto?.subtle) {
    return { ok: false, error: "الدخول أوفلاين غير متاح على هذا الجهاز" };
  }
  const uname = normalizeUsername(username);
  const db = getOfflineDb();
  const row = await db.offline_credentials.get(uname);
  if (!row || row.revoked) {
    return {
      ok: false,
      error:
        "هذا المستخدم غير مفعّل على الجهاز — سجّل دخول مرة أونلاين أولاً",
    };
  }

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return {
      ok: false,
      error: "الحساب مقفل مؤقتاً بسبب محاولات فاشلة — حاول لاحقاً",
      lockedUntil: row.locked_until,
    };
  }

  let profile: Profile;
  try {
    profile = JSON.parse(row.profile_json) as Profile;
  } catch {
    return { ok: false, error: "بيانات المستخدم التالفة على الجهاز" };
  }
  if (profile.is_active === false) {
    await db.offline_credentials.put({ ...row, revoked: true });
    return { ok: false, error: "هذا المستخدم معطّل" };
  }

  const salt = bufFromB64(row.salt_b64);
  const expected = bufFromB64(row.verifier_b64);
  const actual = await deriveVerifier(password, salt, row.iterations || PBKDF2_ITERATIONS);
  const match = timingSafeEqual(actual, expected);

  if (!match) {
    const fail_count = (row.fail_count || 0) + 1;
    const locked_until =
      fail_count >= MAX_FAILS
        ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString()
        : null;
    await db.offline_credentials.put({
      ...row,
      fail_count,
      locked_until,
    });
    if (locked_until) {
      return {
        ok: false,
        error: `محاولات كثيرة — الحساب مقفل لمدة ${LOCK_MINUTES} دقيقة`,
        lockedUntil: locked_until,
      };
    }
    return {
      ok: false,
      error: "اسم المستخدم أو كلمة المرور غير صحيحة",
    };
  }

  await db.offline_credentials.put({
    ...row,
    fail_count: 0,
    locked_until: null,
  });
  await setOfflineSession(profile, uname, "offline");
  return { ok: true, profile, username: uname };
}

/**
 * Resolve auth for cold-start offline:
 * prefer Supabase session, then local offline session.
 */
export async function resolveAuthUser(
  supabase: SupabaseClient
): Promise<{ user: User | null; fromCache: boolean; offlineSession?: boolean }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.user) {
    return { user: session.user, fromCache: true };
  }

  const offline = await getOfflineSession();
  if (offline) {
    // Synthetic user shape for layout gates
    const synthetic = {
      id: offline.profile.id,
      email: offline.profile.email,
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: offline.profile.created_at,
    } as User;
    return { user: synthetic, fromCache: true, offlineSession: true };
  }

  if (!isBrowserOnline()) {
    return { user: null, fromCache: true };
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error && isLikelyNetworkError(error)) {
      return { user: null, fromCache: true };
    }
    return { user: user ?? null, fromCache: false };
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      return { user: null, fromCache: true };
    }
    return { user: null, fromCache: false };
  }
}

export async function signOutLocalKeepingEnrollment(
  supabase: SupabaseClient
): Promise<void> {
  await clearOfflineSession();
  try {
    if (isBrowserOnline()) {
      await supabase.auth.signOut();
    } else {
      // Clear local supabase session storage without network
      await supabase.auth.signOut({ scope: "local" });
    }
  } catch {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      /* ignore */
    }
  }
}

export function requiresOnlineReauthForSync(
  hasSupabaseSession: boolean,
  offlineSession: boolean
): boolean {
  return offlineSession && !hasSupabaseSession;
}
