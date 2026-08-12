import type { Profile, UserRole } from "@/types";

/** Granular app permissions — templates + per-user overrides. */
export type AppPermission =
  | "dashboard"
  | "pos"
  | "sales"
  | "purchases"
  | "products"
  | "products.write"
  | "inventory"
  | "customers"
  | "customers.write"
  | "suppliers"
  | "treasury"
  | "expenses"
  | "reports"
  | "settings"
  | "settings.backup"
  | "users.manage"
  | "invoices.delete"
  | "prices.edit"
  | "shifts"
  | "audit";

export type PermissionSubject = {
  role?: UserRole | string | null;
  permissions?: AppPermission[] | string[] | null;
};

export const ALL_PERMISSIONS: AppPermission[] = [
  "dashboard",
  "pos",
  "sales",
  "purchases",
  "products",
  "products.write",
  "inventory",
  "customers",
  "customers.write",
  "suppliers",
  "treasury",
  "expenses",
  "reports",
  "settings",
  "settings.backup",
  "users.manage",
  "invoices.delete",
  "prices.edit",
  "shifts",
  "audit",
];

export const PERMISSION_LABELS: Record<AppPermission, string> = {
  dashboard: "لوحة التحكم",
  pos: "نقطة البيع",
  sales: "فواتير المبيعات",
  purchases: "فواتير المشتريات",
  products: "عرض الأصناف",
  "products.write": "إضافة/تعديل الأصناف",
  inventory: "الجرد",
  customers: "عرض العملاء",
  "customers.write": "تعديل/حذف العملاء",
  suppliers: "الموردون",
  treasury: "الخزينة",
  expenses: "المصروفات",
  reports: "التقارير",
  settings: "إعدادات المتجر",
  "settings.backup": "النسخ الاحتياطي وإعادة الضبط",
  "users.manage": "إدارة المستخدمين والصلاحيات",
  "invoices.delete": "حذف الفواتير",
  "prices.edit": "تعديل الأسعار",
  shifts: "فتح/إقفال الوردية",
  audit: "سجل التدقيق",
};

export type PermissionGroup = {
  id: string;
  label: string;
  permissions: AppPermission[];
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "overview",
    label: "نظرة عامة",
    permissions: ["dashboard"],
  },
  {
    id: "ops",
    label: "العمليات اليومية",
    permissions: ["pos", "sales", "purchases", "invoices.delete", "shifts"],
  },
  {
    id: "stock",
    label: "المخزون",
    permissions: ["products", "products.write", "inventory", "prices.edit"],
  },
  {
    id: "parties",
    label: "العملاء والموردون",
    permissions: ["customers", "customers.write", "suppliers"],
  },
  {
    id: "finance",
    label: "المالية والرقابة",
    permissions: ["treasury", "expenses", "reports"],
  },
  {
    id: "system",
    label: "النظام",
    permissions: ["settings", "settings.backup", "users.manage", "audit"],
  },
];

const ROLE_TEMPLATE_LISTS: Record<UserRole, AppPermission[]> = {
  owner: [
    "dashboard",
    "pos",
    "sales",
    "purchases",
    "products",
    "products.write",
    "inventory",
    "customers",
    "customers.write",
    "suppliers",
    "treasury",
    "expenses",
    "reports",
    "settings",
    "settings.backup",
    "users.manage",
    "invoices.delete",
    "prices.edit",
    "shifts",
    "audit",
  ],
  manager: [
    "dashboard",
    "pos",
    "sales",
    "purchases",
    "products",
    "products.write",
    "inventory",
    "customers",
    "customers.write",
    "suppliers",
    "treasury",
    "expenses",
    "reports",
    "prices.edit",
    "shifts",
    "settings",
    "audit",
  ],
  employee: [
    "dashboard",
    "pos",
    "sales",
    "products",
    "inventory",
    "customers",
    "shifts",
  ],
};

export const ROLE_TEMPLATES: Record<
  UserRole,
  { label: string; description: string; permissions: AppPermission[] }
> = {
  owner: {
    label: "مالك",
    description: "صلاحيات كاملة بما فيها المستخدمين والنسخ الاحتياطي",
    permissions: ROLE_TEMPLATE_LISTS.owner,
  },
  manager: {
    label: "مدير",
    description: "عمليات يومية + مالية وإعدادات المتجر (بدون نسخ احتياطي/مستخدمين)",
    permissions: ROLE_TEMPLATE_LISTS.manager,
  },
  employee: {
    label: "موظف",
    description: "بيع ومبيعات وعرض أصناف/عملاء وجرد",
    permissions: ROLE_TEMPLATE_LISTS.employee,
  },
};

export function templatePermissions(
  role: UserRole | string | null | undefined
): AppPermission[] {
  if (role === "owner" || role === "manager" || role === "employee") {
    return [...ROLE_TEMPLATE_LISTS[role]];
  }
  return [...ROLE_TEMPLATE_LISTS.employee];
}

export function normalizePermissions(value: unknown): AppPermission[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const allowed = new Set(ALL_PERMISSIONS);
  const out = value.filter(
    (p): p is AppPermission =>
      typeof p === "string" && allowed.has(p as AppPermission)
  );
  return out;
}

/** Effective permissions: custom list if set, otherwise role template. */
export function effectivePermissions(
  subject: PermissionSubject | null | undefined
): AppPermission[] {
  if (!subject?.role && !subject?.permissions) return [];
  const custom = normalizePermissions(subject.permissions ?? null);
  if (custom) {
    return custom;
  }
  return templatePermissions(subject.role);
}

export function canAccess(
  subject: PermissionSubject | UserRole | string | null | undefined,
  permission: AppPermission
): boolean {
  if (!subject) return false;
  if (typeof subject === "string") {
    return templatePermissions(subject).includes(permission);
  }
  return effectivePermissions(subject).includes(permission);
}

export function permissionForPath(pathname: string): AppPermission | null {
  if (pathname === "/m" || pathname === "/m/") return "dashboard";
  if (pathname.startsWith("/m/pos")) return "pos";
  if (pathname.startsWith("/m/finance")) {
    return "treasury";
  }
  if (pathname.startsWith("/m/invoices")) return "sales";
  if (pathname.startsWith("/m/parties")) return "customers";
  if (pathname.startsWith("/m/reports")) return "reports";
  if (pathname.startsWith("/m/stock") || pathname.startsWith("/m/more/stock")) {
    return "products";
  }
  if (pathname.startsWith("/m/more/shifts") || pathname.startsWith("/m/shifts")) {
    return "shifts";
  }
  if (pathname.startsWith("/m/more")) return null;

  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/pos")) return "pos";
  if (pathname.startsWith("/sales")) return "sales";
  if (pathname.startsWith("/purchases")) return "purchases";
  if (pathname.startsWith("/products")) return "products";
  if (pathname.startsWith("/inventory")) return "inventory";
  if (pathname.startsWith("/customers")) return "customers";
  if (pathname.startsWith("/suppliers")) return "suppliers";
  if (pathname.startsWith("/treasury")) return "treasury";
  if (pathname.startsWith("/expenses")) return "expenses";
  if (pathname.startsWith("/receivables")) return "reports";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/shifts")) return "shifts";
  if (pathname.startsWith("/audit")) return "audit";
  if (pathname.startsWith("/offline-queue")) return null;
  if (pathname.startsWith("/m/more/offline")) return null;
  if (pathname.startsWith("/documents")) return "purchases";
  if (pathname.startsWith("/returns")) return "sales";
  return null;
}

export function canAccessPath(
  subject: PermissionSubject | UserRole | string | null | undefined,
  pathname: string
): boolean {
  if (pathname.startsWith("/settings")) {
    return (
      canAccess(subject, "settings") ||
      canAccess(subject, "users.manage") ||
      canAccess(subject, "settings.backup")
    );
  }
  if (pathname.startsWith("/m/finance")) {
    return canAccess(subject, "treasury") || canAccess(subject, "expenses");
  }
  if (pathname.startsWith("/m/invoices")) {
    return canAccess(subject, "sales") || canAccess(subject, "purchases");
  }
  if (pathname.startsWith("/m/parties")) {
    return canAccess(subject, "customers") || canAccess(subject, "suppliers");
  }
  const permission = permissionForPath(pathname);
  if (!permission) return true;
  return canAccess(subject, permission);
}

export function permissionsEqual(a: AppPermission[], b: AppPermission[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((p) => setB.has(p));
}

/** True when custom list matches the role template (treat as using template). */
export function isUsingTemplate(
  role: UserRole | string | null | undefined,
  permissions: AppPermission[] | null | undefined
): boolean {
  if (permissions == null) return true;
  return permissionsEqual(permissions, templatePermissions(role));
}

export function profileSubject(
  profile: Pick<Profile, "role" | "permissions"> | null | undefined
): PermissionSubject | null {
  if (!profile) return null;
  return { role: profile.role, permissions: profile.permissions ?? null };
}
