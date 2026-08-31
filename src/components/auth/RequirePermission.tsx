"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import {
  canAccess,
  canAccessPath,
  profileSubject,
  type AppPermission,
} from "@/lib/permissions";
import { prefersMobileShell, resolveHomePath } from "@/lib/shell-routes";

type Props = {
  permission?: AppPermission;
  children: React.ReactNode;
};

export function RequirePermission({ permission, children }: Props) {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const subject = profileSubject(profile);
  const allowed = permission
    ? canAccess(subject, permission)
    : canAccessPath(subject, pathname);

  useEffect(() => {
    if (loading) return;
    if (!allowed) {
      const fallback = resolveHomePath({ mobile: prefersMobileShell() });
      router.replace(fallback);
    }
  }, [allowed, loading, pathname, router]);

  if (loading || !allowed) {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#b9d7fa] border-t-[#1473e6]" />
      </div>
    );
  }

  return <>{children}</>;
}
