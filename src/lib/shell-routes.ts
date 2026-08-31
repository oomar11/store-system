/** Viewport breakpoints shared with mobile nav. */
export const MOBILE_TABLET_MIN = 768;
export const MOBILE_DESKTOP_MIN = 1280;

const DESKTOP_HOME = "/dashboard";
const MOBILE_HOME = "/m";

/** Prefix pairs: desktop prefix → mobile prefix (longest first). */
const PREFIX_PAIRS: [string, string][] = [
  ["/dashboard", MOBILE_HOME],
  ["/offline-queue", "/m/more/offline"],
  ["/treasury", "/m/finance"],
  ["/expenses", "/m/finance"],
  ["/purchases", "/m/invoices"],
  ["/documents", "/m/invoices"],
  ["/sales", "/m/invoices"],
  ["/customers", "/m/parties"],
  ["/suppliers", "/m/parties"],
  ["/receivables", "/m/reports"],
  ["/inventory", "/m/more/stock"],
  ["/products", "/m/more/stock"],
  ["/reports", "/m/reports"],
  ["/settings", "/m/more"],
  ["/shifts", "/m/more/shifts"],
  ["/pos", "/m/pos"],
];

type RouteRule = {
  test: RegExp;
  toMobile: (match: RegExpMatchArray) => string;
  toDesktop: (match: RegExpMatchArray) => string;
};

const DYNAMIC_RULES: RouteRule[] = [
  {
    test: /^\/customers\/([^/]+)(?:\/(.*))?$/,
    toMobile: (m) =>
      m[2] ? `/m/parties/customer/${m[1]}/${m[2]}` : `/m/parties/customer/${m[1]}`,
    toDesktop: () => "/customers",
  },
  {
    test: /^\/suppliers\/([^/]+)(?:\/(.*))?$/,
    toMobile: (m) =>
      m[2] ? `/m/parties/supplier/${m[1]}/${m[2]}` : `/m/parties/supplier/${m[1]}`,
    toDesktop: () => "/suppliers",
  },
  {
    test: /^\/shifts\/([^/]+)$/,
    toMobile: (m) => `/m/more/shifts/${m[1]}`,
    toDesktop: (m) => `/shifts/${m[1]}`,
  },
  {
    test: /^\/products\/([^/]+)$/,
    toMobile: (m) => `/m/more/stock/${m[1]}`,
    toDesktop: (m) => `/products/${m[1]}`,
  },
  {
    test: /^\/inventory\/([^/]+)$/,
    toMobile: (m) => `/m/more/stock/${m[1]}`,
    toDesktop: (m) => `/inventory/${m[1]}`,
  },
  {
    test: /^\/m\/parties\/(customer|supplier)\/([^/]+)(?:\/statement)?$/,
    toMobile: (m) =>
      m[0].endsWith("/statement")
        ? `/m/parties/${m[1]}/${m[2]}/statement`
        : `/m/parties/${m[1]}/${m[2]}`,
    toDesktop: (m) => `/${m[1] === "customer" ? "customers" : "suppliers"}/${m[2]}`,
  },
  {
    test: /^\/m\/parties\/(customer|supplier)\/([^/]+)\/statement$/,
    toMobile: (m) => `/m/parties/${m[1]}/${m[2]}/statement`,
    toDesktop: (m) => `/${m[1] === "customer" ? "customers" : "suppliers"}/${m[2]}`,
  },
  {
    test: /^\/m\/more\/shifts\/([^/]+)$/,
    toMobile: (m) => `/m/more/shifts/${m[1]}`,
    toDesktop: (m) => `/shifts/${m[1]}`,
  },
  {
    test: /^\/m\/more\/stock\/([^/]+)$/,
    toMobile: (m) => `/m/more/stock/${m[1]}`,
    toDesktop: (m) => `/products/${m[1]}`,
  },
  {
    test: /^\/m\/invoices\/inv\/([^/]+)$/,
    toMobile: (m) => `/m/invoices/inv/${m[1]}`,
    toDesktop: () => "/sales",
  },
  {
    test: /^\/m\/invoices\/doc\/([^/]+)$/,
    toMobile: (m) => `/m/invoices/doc/${m[1]}`,
    toDesktop: () => "/documents",
  },
];

export function isMobilePath(pathname: string): boolean {
  return pathname === MOBILE_HOME || pathname.startsWith(`${MOBILE_HOME}/`);
}

export function prefersMobileShell(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_DESKTOP_MIN;
}

/** Coarse mobile/tablet hint for middleware (no viewport on server). */
export function isMobileUserAgent(userAgent: string): boolean {
  return /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
    userAgent
  );
}

export function resolveHomePath(options: {
  mobile: boolean;
  employee?: boolean;
  needShift?: boolean;
}): string {
  const { mobile, employee, needShift } = options;
  if (employee) {
    if (mobile) {
      return needShift ? "/m/more/shifts?needShift=1" : "/m/more/shifts";
    }
    return needShift ? "/shifts?needShift=1" : "/shifts";
  }
  return mobile ? MOBILE_HOME : DESKTOP_HOME;
}

function stripTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

function applyPrefixMap(
  pathname: string,
  pairs: [string, string][]
): string | null {
  const path = stripTrailingSlash(pathname);
  for (const [from, to] of pairs) {
    if (path === from) return to;
    if (path.startsWith(`${from}/`)) {
      return `${to}${path.slice(from.length)}`;
    }
  }
  return null;
}

/** Map a desktop (or unknown) path to its mobile-shell equivalent. */
export function toMobilePath(pathname: string): string {
  const path = stripTrailingSlash(pathname.split("?")[0] ?? pathname);
  if (isMobilePath(path)) return path;

  for (const rule of DYNAMIC_RULES) {
    const match = path.match(rule.test);
    if (match && !path.startsWith("/m/")) {
      return rule.toMobile(match);
    }
  }

  const mapped = applyPrefixMap(path, PREFIX_PAIRS);
  if (mapped) return mapped;

  return MOBILE_HOME;
}

/** Map a mobile-shell path to its desktop equivalent. */
export function toDesktopPath(pathname: string): string {
  const path = stripTrailingSlash(pathname.split("?")[0] ?? pathname);
  if (!isMobilePath(path)) return path;

  for (const rule of DYNAMIC_RULES) {
    const match = path.match(rule.test);
    if (match) return rule.toDesktop(match);
  }

  const mobileToDesktop = PREFIX_PAIRS.map(
    ([desktop, mobile]) => [mobile, desktop] as [string, string]
  ).sort((a, b) => b[0].length - a[0].length);

  const mapped = applyPrefixMap(path, mobileToDesktop);
  if (mapped) return mapped;

  if (path === MOBILE_HOME) return DESKTOP_HOME;

  return DESKTOP_HOME;
}

/** Resolve the correct shell path for the current viewport preference. */
export function resolveShellPath(
  pathname: string,
  preferMobile: boolean
): string {
  const onMobile = isMobilePath(pathname);
  if (preferMobile && !onMobile) return toMobilePath(pathname);
  if (!preferMobile && onMobile) return toDesktopPath(pathname);
  return stripTrailingSlash(pathname.split("?")[0] ?? pathname);
}
