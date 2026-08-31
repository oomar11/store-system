"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useViewportMode } from "@/hooks/useViewportMode";
import { isMobilePath, resolveShellPath } from "@/lib/shell-routes";

const RESIZE_DEBOUNCE_MS = 150;

type Props = {
  children: React.ReactNode;
};

/**
 * Redirects when the current route belongs to the wrong shell for the viewport.
 * Renders a lightweight spinner during the swap to avoid flashing the wrong chrome.
 */
export function ShellGuard({ children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { ready, isDesktop } = useViewportMode();
  const preferMobile = !isDesktop;
  const [redirecting, setRedirecting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;

    const run = () => {
      const query = searchParams.toString();
      const suffix = query ? `?${query}` : "";
      const targetBase = resolveShellPath(pathname, preferMobile);
      const target = `${targetBase}${suffix}`;
      const onMobile = isMobilePath(pathname);
      const wrongShell =
        (preferMobile && !onMobile) || (!preferMobile && onMobile);

      if (!wrongShell) {
        setRedirecting(false);
        lastTargetRef.current = null;
        return;
      }

      if (lastTargetRef.current === target) return;
      lastTargetRef.current = target;
      setRedirecting(true);
      router.replace(target);
    };

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(run, RESIZE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [ready, preferMobile, pathname, searchParams, router]);

  if (!ready || redirecting) {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--border,#b9d7fa)] border-t-[var(--primary,#1473e6)]" />
      </div>
    );
  }

  return <>{children}</>;
}
