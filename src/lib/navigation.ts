/** Store sidebar navigation (RTL Arabic). */
import type { LucideIcon } from "lucide-react";
import {
  CloudOff,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  FileText,
  HandCoins,
  LayoutDashboard,
  Package,
  ReceiptText,
  ScrollText,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

export type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export const storeNavGroups: NavGroup[] = [
  {
    id: "overview",
    label: "نظرة عامة",
    items: [
      { name: "لوحة التحكم", href: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    id: "daily",
    label: "العمليات اليومية",
    items: [
      { name: "نقطة البيع", href: "/pos", icon: ShoppingCart },
      { name: "فواتير المبيعات", href: "/sales", icon: ReceiptText },
      { name: "فواتير المشتريات", href: "/purchases", icon: ShoppingBag },
      { name: "الوردية", href: "/shifts", icon: Clock3 },
    ],
  },
  {
    id: "inventory",
    label: "المخزون والعلاقات",
    items: [
      { name: "الأصناف", href: "/products", icon: Package },
      { name: "الجرد", href: "/inventory", icon: ClipboardList },
      { name: "العملاء", href: "/customers", icon: Users },
      { name: "الموردون", href: "/suppliers", icon: Truck },
    ],
  },
  {
    id: "finance",
    label: "المالية والرقابة",
    items: [
      { name: "الخزينة", href: "/treasury", icon: CircleDollarSign },
      { name: "المصروفات", href: "/expenses", icon: Wallet },
      { name: "فلوس لِيا برا", href: "/receivables", icon: HandCoins },
      { name: "التقارير", href: "/reports", icon: FileText },
    ],
  },
  {
    id: "system",
    label: "النظام",
    items: [
      { name: "سجل التدقيق", href: "/audit", icon: ScrollText },
      { name: "عمليات أوفلاين", href: "/offline-queue", icon: CloudOff },
      { name: "الإعدادات", href: "/settings", icon: Settings },
    ],
  },
];

/** @deprecated use getNavGroupsForPath */
export const navGroups = storeNavGroups;

export function getNavGroupsForPath(_pathname: string): NavGroup[] {
  return storeNavGroups;
}

export function programHome(_pathname: string): string {
  return "/dashboard";
}

export function programBrand(_pathname: string): string {
  return "ويندور";
}

export function isNavItemActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (!pathname.startsWith(href + "/")) return false;

  const allHrefs = storeNavGroups.flatMap((group) =>
    group.items.map((item) => item.href)
  );
  const moreSpecific = allHrefs.some(
    (other) =>
      other !== href &&
      other.startsWith(href + "/") &&
      (pathname === other || pathname.startsWith(other + "/"))
  );
  return !moreSpecific;
}
