"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { MobileShell } from "@/components/mobile/MobileShell";
import { useAuth } from "@/hooks/useAuth";
import { canAccessPath, profileSubject } from "@/lib/permissions";
import { ShiftProvider, useOpenShift } from "@/hooks/useOpenShift";
import { ShiftExitGuard } from "@/components/shifts/ShiftExitGuard";
import { getMemoryProfile } from "@/lib/offline/session-memory";

function MobileAuthShell({ children }: { children: React.ReactNode }) {
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
      router.replace(isEmployee ? "/m/more/shifts?needShift=1" : "/m");
    }
  }, [authorized, authLoading, profile, pathname, router, isEmployee]);

  useEffect(() => {
    if (!authorized || authLoading || shiftLoading) return;
    if (!isEmployee) return;
    if (pathname.startsWith("/m/more/shifts") || pathname.startsWith("/m/shifts")) {
      return;
    }
    if (blockedByShift) {
      router.replace("/m/more/shifts?needShift=1");
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
      (pathname === "/m" || pathname === "/m/") &&
      !hasActiveShift
    ) {
      router.replace("/m/more/shifts?needShift=1");
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
      <div className="mobile-loading-screen">
        <div className="mobile-spinner" />
      </div>
    );
  }

  // Wait for profile before permission checks; keep shell chrome visible
  if (!profile) {
    return (
      <MobileShell>
        <div className="mobile-loading-inline">
          <div className="mobile-spinner" />
        </div>
      </MobileShell>
    );
  }

  const allowed = canAccessPath(profileSubject(profile), pathname);

  const shiftGatePending =
    isEmployee &&
    !pathname.startsWith("/m/more/shifts") &&
    !pathname.startsWith("/m/shifts") &&
    (shiftLoading || blockedByShift);

  return (
    <MobileShell>
      <ShiftExitGuard />
      {!allowed || shiftGatePending ? (
        <div className="mobile-loading-inline">
          <div className="mobile-spinner" />
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="mobile-loading-inline">
              <div className="mobile-spinner" />
            </div>
          }
        >
          {children}
        </Suspense>
      )}
    </MobileShell>
  );
}

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ShiftProvider>
      <MobileAuthShell>{children}</MobileAuthShell>
    </ShiftProvider>
  );
}
