"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ReturnsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/sales?tab=returns");
  }, [router]);
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#dcecff] border-t-[#1473e6]" />
    </div>
  );
}
