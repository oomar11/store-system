"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, LogOut, Menu, Search, X } from "lucide-react";
import { QuickSearch } from "@/components/layout/QuickSearch";
import { NotificationsBell } from "@/components/layout/NotificationsBell";
import { OfflineStatusBadge } from "@/components/offline/OfflineStatusBadge";
import { useShiftExitLogout } from "@/components/shifts/ShiftExitGuard";
import { useOpenShift } from "@/hooks/useOpenShift";
import type { Profile } from "@/types";

const pageTitles: Record<string, string> = {
  dashboard: "لوحة التحكم",
  pos: "نقطة البيع",
  sales: "فواتير المبيعات",
  purchases: "فواتير المشتريات",
  products: "الأصناف",
  inventory: "الجرد",
  customers: "العملاء",
  suppliers: "الموردون",
  treasury: "الخزينة",
  reports: "التقارير",
  settings: "الإعدادات",
  expenses: "المصروفات",
  shifts: "الوردية",
  audit: "سجل التدقيق",
};

export function Header() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const confirmLogout = useShiftExitLogout();
  const { hasActiveShift } = useOpenShift();
  const segments = pathname.split("/").filter(Boolean);
  const pageKey = segments[0] || "dashboard";
  const posMode = searchParams.get("mode");
  const isProductDetail =
    pageKey === "products" && segments.length > 1;
  const isInventorySheetSetup =
    pageKey === "inventory" && segments[1] === "sheet-setup";
  const isPartyPaymentPage =
    (pageKey === "customers" || pageKey === "suppliers") &&
    segments[2] === "payments";
  const isNewPartyPayment =
    isPartyPaymentPage && segments[3] === "new";
  const title =
    pageKey === "pos"
      ? posMode === "quote"
        ? "عرض سعر"
        : posMode === "purchase"
          ? "فاتورة مشتريات"
          : posMode === "purchase_order"
            ? "طلب مشتريات"
            : "نقطة البيع"
      : isInventorySheetSetup
        ? "شكل ورقة الجرد"
        : isPartyPaymentPage
          ? pageKey === "customers"
            ? isNewPartyPayment
              ? "تحصيل جديد"
              : "تفاصيل التحصيل"
            : isNewPartyPayment
              ? "سداد جديد"
              : "تفاصيل السداد"
          : isProductDetail
            ? "تفاصيل الصنف"
            : pageTitles[pageKey] || "ويندور";

  useEffect(() => {
    async function getProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();
        if (data) setProfile(data);
      }
    }
    getProfile();
  }, [supabase]);

  useEffect(() => {
    setMobileSearchOpen(false);
    setShowMenu(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileSearchOpen]);

  async function handleLogout() {
    setShowMenu(false);
    const ok = await confirmLogout(() => router.push("/shifts"));
    if (!ok) return;
    const { signOutLocalKeepingEnrollment } = await import(
      "@/lib/offline/auth-session"
    );
    await signOutLocalKeepingEnrollment(supabase);
    router.push("/login");
    router.refresh();
  }

  const roleLabels: Record<string, string> = {
    owner: "مالك",
    manager: "مدير",
    employee: "موظف",
  };

  return (
    <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-subtle)] px-4 shadow-[0_1px_3px_rgba(20,32,51,0.06)] sm:gap-4 sm:px-6">
      <button
        onClick={() => window.dispatchEvent(new Event("toggle-sidebar"))}
        className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] hover:text-[var(--primary)] lg:hidden"
        aria-label="فتح القائمة"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-[var(--foreground)]">
            {title}
          </p>
          <p className="hidden text-[11px] text-[var(--muted)] sm:block">
            إدارة أعمالك من مكان واحد
          </p>
        </div>
        {hasActiveShift && (
          <Link
            href="/shifts"
            title="الذهاب إلى الوردية"
            className="inline-flex items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--success)_18%,var(--surface))] px-2 py-0.5 text-[10px] font-bold text-[var(--success)] ring-1 ring-[color-mix(in_srgb,var(--success)_35%,var(--border))] transition hover:bg-[color-mix(in_srgb,var(--success)_28%,var(--surface))]"
          >
            وردية مفتوحة
          </Link>
        )}
      </div>

      <div className="mr-auto hidden w-full max-w-[360px] md:block">
        <QuickSearch />
      </div>

      <button
        type="button"
        onClick={() => setMobileSearchOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] hover:text-[var(--primary)] md:hidden"
        aria-label="بحث سريع"
      >
        <Search className="h-5 w-5" />
      </button>

      <NotificationsBell />

      <OfflineStatusBadge />

      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1 hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))]"
          aria-expanded={showMenu}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-sm font-bold text-[var(--primary)]">
            {profile?.full_name?.charAt(0) || "م"}
          </div>
          <div className="hidden text-right sm:block">
            <p className="max-w-28 truncate text-xs font-bold text-[var(--foreground)]">
              {profile?.full_name || "مستخدم"}
            </p>
            <p className="text-[10px] text-[var(--muted)]">
              {roleLabels[profile?.role || "employee"]}
            </p>
          </div>
          <ChevronDown className="hidden h-3.5 w-3.5 text-[var(--muted-soft)] sm:block" />
        </button>

        {showMenu && (
          <div className="absolute left-0 top-full z-50 mt-2 w-48 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-1.5 shadow-[0_16px_40px_rgba(16,24,40,0.16)]">
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-semibold text-[var(--danger)] hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" />
              تسجيل الخروج
            </button>
          </div>
        )}
      </div>

      {mobileSearchOpen && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-[var(--surface-subtle)] md:hidden">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
            <p className="flex-1 text-sm font-bold text-[var(--foreground)]">بحث سريع</p>
            <button
              type="button"
              onClick={() => setMobileSearchOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--muted)]"
              aria-label="إغلاق البحث"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-visible p-4">
            <QuickSearch
              autoFocus
              className="relative w-full"
              onNavigate={() => setMobileSearchOpen(false)}
            />
          </div>
        </div>
      )}
    </header>
  );
}
