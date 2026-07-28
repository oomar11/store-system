"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useViewportMode } from "@/hooks/useViewportMode";
import {
  isMobileNavActive,
  mobileNavItems,
  type MobileNavItem,
} from "@/lib/mobile-nav";
import { canAccess, profileSubject } from "@/lib/permissions";

function canSeeItem(
  item: MobileNavItem,
  subject: ReturnType<typeof profileSubject>,
  showPosTab: boolean,
  hasProfile: boolean
): boolean {
  if (item.tabletOnly && !showPosTab) return false;
  if (!item.permissions?.length) return true;
  // Missing cached profile: don't hide the whole bottom nav
  if (!hasProfile) return true;
  return item.permissions.some((p) => canAccess(subject, p));
}

export function BottomNav() {
  const pathname = usePathname();
  const { profile } = useAuth();
  const { showPosTab } = useViewportMode();
  const subject = profileSubject(profile);

  const items = mobileNavItems.filter((item) =>
    canSeeItem(item, subject, showPosTab, !!profile)
  );

  return (
    <nav
      className="mobile-bottom-nav"
      aria-label="التنقل الرئيسي"
    >
      {items.map((item) => {
        const active = isMobileNavActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.id}
            href={item.href}
            className={`mobile-bottom-nav__item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
            <span>{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
