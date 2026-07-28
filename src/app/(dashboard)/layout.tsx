"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { useAuth } from "@/hooks/useAuth";
import { canAccessPath, profileSubject } from "@/lib/permissions";
import { ShiftProvider, useOpenShift } from "@/hooks/useOpenShift";
import { ShiftExitGuard } from "@/components/shifts/ShiftExitGuard";
import { getMemoryProfile } from "@/lib/offline/session-memory";

function DashboardShell({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState(() => !!getMemoryProfile());
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  const { profile, loading: authLoading, isEmployee } = useAuth();
  const { blockedByShift, loading: shiftLoading, hasActiveShift } =
    useOpenShift();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { resolveAuthUser } = await import("@/lib/offline/auth-session");
      const { user } = await resolveAuthUser(supabase);
      if (cancelled) return;
      if (user) {
        setAuthorized(true);
      } else {
        setAuthorized(false);
        router.replace("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  useEffect(() => {
    if (authLoading || !profile) return;
    if (profile.is_active === false) {
      void (async () => {
        const { signOutLocalKeepingEnrollment, revokeOfflineCredentialByUserId } =
          await import("@/lib/offline/auth-session");
        await revokeOfflineCredentialByUserId(profile.id);
        await signOutLocalKeepingEnrollment(supabase);
        router.replace("/login");
      })();
    }
  }, [authLoading, profile, router, supabase]);

  useEffect(() => {
    if (!authorized || authLoading) return;
    if (!profile) return;
    if (!canAccessPath(profileSubject(profile), pathname)) {
      router.replace(isEmployee ? "/shifts" : "/dashboard");
    }
  }, [authorized, authLoading, profile, pathname, router, isEmployee]);

  useEffect(() => {
    if (!authorized || authLoading || shiftLoading) return;
    if (!isEmployee) return;
    if (pathname.startsWith("/shifts")) return;
    if (blockedByShift) {
      router.replace("/shifts?needShift=1");
    }
  }, [
    authorized,
    authLoading,
    shiftLoading,
    isEmployee,
    blockedByShift,
    pathname,
    router,
  ]);

  useEffect(() => {
    if (!authorized || authLoading || shiftLoading) return;
    if (!isEmployee) return;
    if (
      (pathname === "/dashboard" || pathname === "/") &&
      !hasActiveShift
    ) {
      router.replace("/shifts?needShift=1");
    }
  }, [
    authorized,
    authLoading,
    shiftLoading,
    isEmployee,
    hasActiveShift,
    pathname,
    router,
  ]);

  if (!authorized || profile?.is_active === false) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--background)]">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--border)] border-t-[var(--primary)]" />
      </div>
    );
  }

  // While profile is still missing, don't block the whole app with a spinner
  // (offline remounts can briefly lack cache). Permission redirect still runs above.
  const allowed =
    authLoading ||
    !profile ||
    canAccessPath(profileSubject(profile), pathname);

  const shiftGatePending =
    isEmployee &&
    !!profile &&
    !pathname.startsWith("/shifts") &&
    (shiftLoading || blockedByShift);

  return (
    <div className="app-shell flex h-screen overflow-hidden">
      <ShiftExitGuard />
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Suspense
          fallback={
            <div className="h-[72px] border-b border-[var(--border)] bg-[var(--surface-subtle)]" />
          }
        >
          <Header />
        </Suspense>
        <main className="page-enter flex-1 overflow-y-auto p-4 sm:p-6 lg:p-7">
          <div className="mx-auto w-full max-w-[1500px]">
            {!allowed || shiftGatePending ? (
              <div className="flex justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--border)] border-t-[var(--primary)]" />
              </div>
            ) : (
              <Suspense
                fallback={
                  <div className="flex justify-center py-16">
                    <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--border)] border-t-[var(--primary)]" />
                  </div>
                }
              >
                {children}
              </Suspense>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ShiftProvider>
      <DashboardShell>{children}</DashboardShell>
    </ShiftProvider>
  );
}
