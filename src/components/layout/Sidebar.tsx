"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, SlidersHorizontal, X } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import {
  getNavGroupsForPath,
  isNavItemActive,
  programBrand,
  programHome,
} from "@/lib/navigation";
import { canAccessPath, profileSubject } from "@/lib/permissions";
import { useAuth } from "@/hooks/useAuth";
import { useOpenShift } from "@/hooks/useOpenShift";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();
  const { profile, isEmployee } = useAuth();
  const { blockedByShift, hasActiveShift } = useOpenShift();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const subject = profileSubject(profile);
  const navGroups = getNavGroupsForPath(pathname);
  const homeHref = programHome(pathname);
  const brand = programBrand(pathname);

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        // Profile still hydrating / missing from cache: don't strip the whole menu
        // (only /offline-queue is permission-free — that was leaving a single item)
        if (!profile) return true;
        if (!canAccessPath(subject, item.href)) return false;
        // بدون وردية: الموظف يشوف الوردية فقط (برنامج المتجر)
        if (
          blockedByShift &&
          item.href !== "/shifts"
        ) {
          return false;
        }
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);

  useEffect(() => {
    const toggleMobile = () => setMobileOpen((open) => !open);
    const closeMobile = () => setMobileOpen(false);
    window.addEventListener("toggle-sidebar", toggleMobile);
    window.addEventListener("close-sidebar", closeMobile);
    return () => {
      window.removeEventListener("toggle-sidebar", toggleMobile);
      window.removeEventListener("close-sidebar", closeMobile);
    };
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-slate-950/25 backdrop-blur-[2px] transition-opacity lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setMobileOpen(false)}
      />

      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-[248px] flex-col border-l border-[var(--border)] bg-[var(--surface)] transition-all duration-300 lg:relative lg:z-auto lg:translate-x-0",
          mobileOpen ? "translate-x-0 shadow-2xl" : "translate-x-full",
          collapsed ? "lg:w-[84px]" : "lg:w-[248px]"
        )}
      >
        <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-[var(--border)] px-5">
          <Link
            href={homeHref}
            className="flex min-w-0 items-center gap-3"
            onClick={() => setMobileOpen(false)}
          >
            <BrandLogo size={36} className="h-9 w-9" priority />
            {!collapsed && (
              <span className="truncate text-[17px] font-bold tracking-tight text-[var(--foreground)]">
                {brand}
              </span>
            )}
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-2 text-[var(--muted-soft)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] lg:hidden"
            aria-label="إغلاق القائمة"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav
          className={cn(
            "flex-1 space-y-5 overflow-y-auto px-4 pb-4 pt-5",
            collapsed && "lg:space-y-3 lg:px-3"
          )}
        >
          {visibleGroups.map((group, groupIndex) => (
            <div key={group.id} className="space-y-1.5">
              {!collapsed && (
                <p className="px-3 pb-0.5 text-[10px] font-bold tracking-[0.08em] text-[var(--muted-soft)]">
                  {group.label}
                </p>
              )}
              {collapsed && groupIndex > 0 && (
                <div
                  className="mx-auto mb-1 hidden h-px w-6 bg-[var(--border)] lg:block"
                  aria-hidden
                />
              )}
              {group.items.map((item) => {
                const isActive = isNavItemActive(pathname, item.href);
                const Icon = item.icon;
                const showShiftDot =
                  item.href === "/shifts" && isEmployee && !hasActiveShift;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.name}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "group relative flex h-11 items-center gap-3 rounded-[10px] px-3 text-[13px] font-semibold",
                      isActive
                        ? "bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]"
                        : "text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]",
                      collapsed && "lg:justify-center lg:px-0"
                    )}
                  >
                    <span className="relative shrink-0">
                      <Icon
                        className={cn(
                          "h-[18px] w-[18px]",
                          isActive
                            ? "text-[var(--primary)]"
                            : "text-[var(--muted-soft)] group-hover:text-[var(--primary)]"
                        )}
                        strokeWidth={2}
                      />
                      {showShiftDot && (
                        <span
                          className="absolute -left-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-[var(--surface)]"
                          aria-label="لا توجد وردية مفتوحة"
                        />
                      )}
                    </span>
                    {!collapsed && <span>{item.name}</span>}
                    {isActive && !collapsed && (
                      <span className="mr-auto h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--border)] p-4">
          <div
            className={cn(
              "rounded-xl bg-[var(--surface-subtle)] p-3",
              collapsed && "lg:bg-transparent lg:p-0"
            )}
          >
            {!collapsed && (
              <div className="mb-3 flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-[var(--primary)]" />
                <p className="text-xs font-semibold text-[var(--foreground)]">
                  إدارة ذكية وسريعة
                </p>
              </div>
            )}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={cn(
                "hidden w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--primary)] lg:flex",
                collapsed && "h-10 border-0 bg-transparent px-0"
              )}
              aria-label={collapsed ? "توسيع القائمة" : "طي القائمة"}
              title={collapsed ? "توسيع القائمة" : "طي القائمة"}
            >
              <ChevronLeft className={cn("h-4 w-4", collapsed && "rotate-180")} />
              {!collapsed && <span>طي القائمة</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
