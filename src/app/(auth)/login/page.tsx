"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  LockKeyhole,
  Monitor,
  Moon,
  Sun,
  UserRound,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { useTheme } from "@/hooks/useTheme";
import { createClient } from "@/lib/supabase";
import type { ThemePreference } from "@/lib/theme";

function loginErrorMessage(message: string, status?: number): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("invalid login credentials") ||
    lower.includes("invalid email or password")
  ) {
    return "اسم المستخدم أو كلمة المرور غير صحيحة";
  }
  if (lower.includes("email not confirmed")) {
    return "الحساب غير مفعّل — تواصل مع مدير المتجر";
  }
  if (lower.includes("too many requests") || status === 429) {
    return "محاولات كثيرة — انتظر دقيقة ثم أعد المحاولة";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "تعذر الاتصال بالخادم — تحقق من الإنترنت وحاول مجدداً";
  }
  return message || "تعذر تسجيل الدخول — تحقق من البيانات وحاول مجدداً";
}

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: "system", label: "تلقائي", icon: Monitor },
  { value: "light", label: "فاتح", icon: Sun },
  { value: "dark", label: "داكن", icon: Moon },
];

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const usernameRef = useRef<HTMLInputElement>(null);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const input = usernameRef.current;
    if (!input || document.activeElement === input) return;
    input.focus();
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const uname = username.trim().toLowerCase();
    const email = `${uname}@store.local`;
    const isCompact =
      typeof window !== "undefined" && window.innerWidth < 1280;

    const {
      enrollOfflineCredential,
      verifyOfflineLogin,
      setOfflineSession,
      listEnrolledOfflineUsers,
    } = await import("@/lib/offline/auth-session");
    const { isBrowserOnline: netOnline, isLikelyNetworkError: netErr } =
      await import("@/lib/offline/network");

    const tryOffline = async (fallbackMsg?: string) => {
      const enrolled = await listEnrolledOfflineUsers();
      if (!enrolled.length) {
        setError(
          fallbackMsg ||
            "لا يوجد مستخدم مفعّل على الجهاز — يلزم دخول أونلاين مرة واحدة أولاً"
        );
        setLoading(false);
        return;
      }
      const result = await verifyOfflineLogin(uname, password);
      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }
      let nextPath = isCompact ? "/m" : "/dashboard";
      if (result.profile.role === "employee") {
        nextPath = isCompact ? "/m/more/shifts?needShift=1" : "/shifts";
      }
      setLoading(false);
      router.push(nextPath);
      router.refresh();
    };

    if (!netOnline()) {
      await tryOffline();
      return;
    }

    try {
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signErr) {
        if (netErr(signErr) || /network|fetch|failed to fetch/i.test(signErr.message)) {
          await tryOffline(loginErrorMessage(signErr.message, signErr.status));
          return;
        }
        // Wrong password online — still allow offline if enrolled (same password check locally)
        // Prefer online error for credential mistakes when online
        setError(loginErrorMessage(signErr.message, signErr.status));
        setLoading(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      let nextPath = isCompact ? "/m" : "/dashboard";
      let profileRole: string | undefined;
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();
        if (profile) {
          profileRole = profile.role;
          if (profile.is_active === false) {
            await supabase.auth.signOut();
            setError("هذا المستخدم معطّل");
            setLoading(false);
            return;
          }
          await enrollOfflineCredential(
            uname,
            password,
            profile as import("@/types").Profile
          );
          await setOfflineSession(
            profile as import("@/types").Profile,
            uname,
            "online"
          );
          if (profile.role === "employee") {
            nextPath = isCompact ? "/m/more/shifts?needShift=1" : "/shifts";
          }
        }
      }

      void profileRole;
      setLoading(false);
      router.push(nextPath);
      router.refresh();
    } catch (err) {
      if (netErr(err)) {
        await tryOffline();
        return;
      }
      setError(
        err instanceof Error
          ? loginErrorMessage(err.message)
          : "تعذر تسجيل الدخول"
      );
      setLoading(false);
    }
  }

  return (
    <main className="app-theme relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--background)] p-4 sm:p-6">
      <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[color-mix(in_srgb,var(--primary)_18%,transparent)] blur-3xl" />
      <div className="absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] blur-3xl" />

      <div className="absolute left-4 top-4 z-20 sm:left-6 sm:top-6">
        <div
          className="flex gap-0.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-sm"
          role="group"
          aria-label="المظهر"
        >
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                title={option.label}
                aria-pressed={active}
                onClick={() => setTheme(option.value)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition ${
                  active
                    ? "bg-[color-mix(in_srgb,var(--primary)_16%,var(--surface))] text-[var(--primary)]"
                    : "text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="relative grid min-h-[650px] w-full max-w-[1080px] overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_color-mix(in_srgb,var(--foreground)_18%,transparent)] lg:grid-cols-[0.9fr_1.1fr]">
        <div className="flex flex-col px-6 py-8 sm:px-12 sm:py-10 lg:px-16">
          <div className="flex items-center gap-3">
            <BrandLogo size={40} className="h-10 w-10" priority />
            <div>
              <p className="text-xl font-bold tracking-tight text-[var(--foreground)]">
                ويندور
              </p>
              <p className="text-[9px] font-semibold tracking-wide text-[var(--muted)]">
                لإدارة المبيعات والمخزون
              </p>
            </div>
          </div>

          <div className="my-auto py-12">
            <div className="mb-9">
              <span className="mb-3 inline-flex rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] px-3 py-1 text-[10px] font-bold text-[var(--primary)]">
                مرحبًا بعودتك
              </span>
              <h1 className="text-[28px] font-bold tracking-tight text-[var(--foreground)]">
                سجّل دخولك إلى حسابك
              </h1>
              <p className="mt-2 text-xs leading-6 text-[var(--muted)]">
                أدخل بياناتك للوصول إلى لوحة التحكم ومتابعة أعمالك.
              </p>
            </div>

            {error && (
              <div className="mb-5 rounded-[10px] border border-[color-mix(in_srgb,var(--danger)_35%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_12%,var(--surface))] px-4 py-3 text-center text-xs font-semibold text-[var(--danger)]">
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label
                  htmlFor="username"
                  className="mb-2 block text-[11px] font-bold text-[var(--foreground)]"
                >
                  اسم المستخدم
                </label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute right-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-[var(--muted-soft)]" />
                  <input
                    ref={usernameRef}
                    id="username"
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                    className="h-12 w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-subtle)] pr-11 pl-4 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--primary)] focus:bg-[var(--surface)] focus:ring-3 focus:ring-[color-mix(in_srgb,var(--primary)_25%,transparent)]"
                    placeholder="admin"
                    dir="ltr"
                    autoComplete="username"
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="text-[11px] font-bold text-[var(--foreground)]"
                  >
                    كلمة المرور
                  </label>
                </div>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute right-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-[var(--muted-soft)]" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    className="h-12 w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-subtle)] pr-11 pl-12 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--primary)] focus:bg-[var(--surface)] focus:ring-3 focus:ring-[color-mix(in_srgb,var(--primary)_25%,transparent)]"
                    placeholder="••••••••"
                    dir="ltr"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--muted-soft)] hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] hover:text-[var(--primary)]"
                    aria-label={
                      showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="h-[17px] w-[17px]" />
                    ) : (
                      <Eye className="h-[17px] w-[17px]" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--primary)] px-4 text-sm font-bold text-white shadow-[0_9px_22px_color-mix(in_srgb,var(--primary)_28%,transparent)] hover:-translate-y-0.5 hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    جاري تسجيل الدخول...
                  </>
                ) : (
                  <>
                    تسجيل الدخول
                    <ArrowLeft className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          </div>

          <p className="text-center text-[9px] text-[var(--muted-soft)]">
            © {new Date().getFullYear()} ويندور — جميع الحقوق محفوظة
          </p>
        </div>

        <div className="relative hidden overflow-hidden bg-[var(--primary)] p-12 text-white lg:flex lg:flex-col lg:justify-center">
          <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.16)_1px,transparent_1px)] [background-size:52px_52px]" />
          <div className="absolute -left-24 -top-20 h-72 w-72 rounded-full border-[55px] border-white/5" />
          <div className="absolute -bottom-28 -right-20 h-80 w-80 rounded-full border-[65px] border-white/5" />

          <div className="relative z-10 mx-auto w-full max-w-md">
            <p className="text-xs font-semibold text-white/75">
              كل أعمالك في مكان واحد
            </p>
            <h2 className="mt-3 text-3xl font-bold leading-[1.45]">
              إدارة أبسط.
              <br />
              قرارات أسرع.
            </h2>
            <p className="mt-4 max-w-sm text-xs leading-6 text-white/70">
              تابع المبيعات والمخزون والعملاء من لوحة تحكم واضحة صُممت لتنجز عملك
              بكفاءة.
            </p>

            <div className="mt-10 rounded-[18px] border border-white/20 bg-[var(--surface)] p-4 text-[var(--foreground)] shadow-[0_30px_60px_rgba(2,48,110,0.28)] backdrop-blur">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-[9px] font-semibold text-[var(--muted-soft)]">
                    ملخص اليوم
                  </p>
                  <p className="mt-1 text-sm font-bold">لوحة التحكم</p>
                </div>
                <span className="h-7 w-20 rounded-md bg-[color-mix(in_srgb,var(--primary)_16%,var(--surface))]" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[72, 48, 86].map((value, index) => (
                  <div
                    key={value}
                    className="rounded-[9px] border border-[var(--border)] p-3"
                  >
                    <span
                      className={`mb-3 block h-7 w-7 rounded-lg ${
                        index === 1
                          ? "bg-[color-mix(in_srgb,var(--warning)_18%,var(--surface))]"
                          : "bg-[color-mix(in_srgb,var(--primary)_16%,var(--surface))]"
                      }`}
                    />
                    <span className="block h-2 w-12 rounded bg-[var(--surface-muted)]" />
                    <span className="mt-2 block h-3 w-16 rounded bg-[var(--muted-soft)]" />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex h-32 items-end gap-2 rounded-[10px] border border-[var(--border)] p-4">
                {[32, 48, 40, 72, 58, 88, 76, 100].map((height, index) => (
                  <span
                    key={`${height}-${index}`}
                    className={`flex-1 rounded-t-sm ${
                      index === 7
                        ? "bg-[var(--primary)]"
                        : "bg-[color-mix(in_srgb,var(--primary)_28%,var(--surface-muted))]"
                    }`}
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
