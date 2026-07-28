"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Clock3,
  CloudOff,
  FileText,
  LogOut,
  Package,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { canAccess, profileSubject } from "@/lib/permissions";
import { useViewportMode } from "@/hooks/useViewportMode";
import { MobileHeader } from "@/components/mobile/MobileHeader";

export default function MobileMorePage() {
  const router = useRouter();
  const supabase = createClient();
  const { profile, loading: authLoading } = useAuth();
  const { isPhone } = useViewportMode();
  const subject = profileSubject(profile);

  const canProducts = canAccess(subject, "products");
  const canReports = canAccess(subject, "reports");
  const canShifts = canAccess(subject, "shifts");

  async function logout() {
    const { signOutLocalKeepingEnrollment } = await import(
      "@/lib/offline/auth-session"
    );
    await signOutLocalKeepingEnrollment(supabase);
    router.replace("/login");
    router.refresh();
  }

  const links = [
    {
      href: "/m/more/offline",
      label: "عمليات أوفلاين",
      meta: "مزامنة · معلّقات · تعارضات",
      icon: CloudOff,
    },
    canProducts
      ? {
          href: "/m/more/stock",
          label: "المخزن",
          meta: "بحث وعرض الأرصدة",
          icon: Package,
        }
      : null,
    canReports
      ? {
          href: "/m/reports",
          label: "التقارير",
          meta: "مبيعات · ربح · خزنة",
          icon: FileText,
        }
      : null,
    canShifts
      ? {
          href: "/m/more/shifts",
          label: "الوردية",
          meta: isPhone
            ? "الفتح من التابلت أو سطح المكتب فقط"
            : "فتح وإقفال الوردية",
          icon: Clock3,
        }
      : null,
  ].filter(Boolean) as {
    href: string;
    label: string;
    meta: string;
    icon: typeof Package;
  }[];

  return (
    <>
      <MobileHeader
        title="المزيد"
        subtitle={profile?.full_name || "الحساب"}
      />
      <div className="mobile-page">
        {authLoading ? (
          <div className="mobile-loading-inline">
            <div className="mobile-spinner" />
          </div>
        ) : (
          <div className="mobile-panel">
            {links.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="mobile-more-link"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[rgb(20_115_230_/_12%)] text-[var(--primary-dark)]">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate">{item.label}</p>
                      <p className="mobile-more-link__meta">{item.meta}</p>
                    </div>
                  </div>
                  <ChevronLeft className="h-4 w-4 text-[var(--muted)]" />
                </Link>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={logout}
          className="mobile-btn mobile-btn--ghost mt-4 text-[var(--danger)]"
        >
          <LogOut className="h-4 w-4" />
          تسجيل الخروج
        </button>
      </div>
    </>
  );
}
