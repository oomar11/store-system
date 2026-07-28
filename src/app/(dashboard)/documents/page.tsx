"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Standalone documents page removed — quotes live under sales, POs under purchases. */
export default function DocumentsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/purchases?tab=orders");
  }, [router]);
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#dcecff] border-t-[#1473e6]" />
    </div>
  );
}
