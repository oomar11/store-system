"use client";

import Link from "next/link";

export default function OfflineFallbackPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--background)] p-6 text-center">
      <h1 className="text-2xl font-black text-[var(--foreground)]">ويندور — وضع أوفلاين</h1>
      <p className="max-w-md text-sm text-[var(--muted)]">
        الشاشة دي لسة مش محفوظة أو الاتصال متقطع. البيانات المحفوظة على الجهاز ما زالت
        متاحة من الشاشات اللي اتنزّلت قبل كده.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link
          href="/app-start.html"
          className="rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white"
        >
          إعادة المحاولة
        </Link>
        <Link
          href="/pos"
          className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-bold"
        >
          نقطة البيع
        </Link>
        <Link
          href="/dashboard"
          className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-bold"
        >
          لوحة التحكم
        </Link>
        <Link
          href="/offline-queue"
          className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-bold"
        >
          مركز المزامنة
        </Link>
      </div>
    </main>
  );
}
