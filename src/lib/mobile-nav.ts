import type { LucideIcon } from "lucide-react";
import {
  CircleDollarSign,
  FileText,
  LayoutDashboard,
  Menu,
  ReceiptText,
  ShoppingCart,
  Users,
} from "lucide-react";
import type { AppPermission } from "@/lib/permissions";

export type MobileNavItem = {
  id: string;
  name: string;
  href: string;
  icon: LucideIcon;
  /** Permission required to show the tab (any of these). */
  permissions?: AppPermission[];
  /** Only show on tablet+ (md breakpoint / 768px). */
  tabletOnly?: boolean;
};

/** Bottom tabs for the `/m` companion shell. */
export const mobileNavItems: MobileNavItem[] = [
  {
    id: "home",
    name: "الرئيسية",
    href: "/m",
    icon: LayoutDashboard,
    permissions: ["dashboard"],
  },
  {
    id: "finance",
    name: "المالية",
    href: "/m/finance",
    icon: CircleDollarSign,
    permissions: ["treasury", "expenses"],
  },
  {
    id: "pos",
    name: "البيع",
    href: "/m/pos",
    icon: ShoppingCart,
    permissions: ["pos"],
    tabletOnly: true,
  },
  {
    id: "invoices",
    name: "الفواتير",
    href: "/m/invoices",
    icon: ReceiptText,
    permissions: ["sales", "purchases"],
  },
  {
    id: "parties",
    name: "الأطراف",
    href: "/m/parties",
    icon: Users,
    permissions: ["customers", "suppliers"],
  },
  {
    id: "more",
    name: "المزيد",
    href: "/m/more",
    icon: Menu,
  },
];

export const MOBILE_TABLET_MIN = 768;
export const MOBILE_DESKTOP_MIN = 1280;

export function isMobileNavActive(pathname: string, href: string): boolean {
  if (href === "/m") return pathname === "/m" || pathname === "/m/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Map `/m/*` paths to desktop permission keys. */
export function permissionForMobilePath(pathname: string): AppPermission | null {
  if (pathname === "/m" || pathname === "/m/") return "dashboard";
  if (pathname.startsWith("/m/pos")) return "pos";
  if (pathname.startsWith("/m/finance")) return "treasury";
  if (pathname.startsWith("/m/invoices")) return "sales";
  if (pathname.startsWith("/m/parties")) return "customers";
  if (pathname.startsWith("/m/reports")) return "reports";
  if (pathname.startsWith("/m/stock") || pathname.startsWith("/m/more/stock")) {
    return "products";
  }
  if (pathname.startsWith("/m/more/shifts") || pathname.startsWith("/m/shifts")) {
    return "shifts";
  }
  if (pathname.startsWith("/m/more")) return null; // hub always reachable
  return null;
}
