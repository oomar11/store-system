"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

/** Seed local search state from `?q=` (header quick search handoff). */
export function useUrlSearchTerm(initial = "") {
  const searchParams = useSearchParams();
  const urlQ = searchParams.get("q")?.trim() || "";
  const [searchTerm, setSearchTerm] = useState(urlQ || initial);
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ);

  // Sync when navigating via header quick search (?q= changes).
  if (urlQ !== prevUrlQ) {
    setPrevUrlQ(urlQ);
    if (urlQ) setSearchTerm(urlQ);
  }

  return [searchTerm, setSearchTerm] as const;
}
