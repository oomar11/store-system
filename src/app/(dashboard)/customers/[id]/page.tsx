"use client";

import { useParams } from "next/navigation";
import { PartyDetailPage } from "@/components/parties/PartyDetailPage";

export default function CustomerDetailRoute() {
  const params = useParams();
  const id = String(params.id || "");
  return <PartyDetailPage kind="customer" partyId={id} />;
}
