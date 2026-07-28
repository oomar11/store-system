"use client";

import { useParams } from "next/navigation";
import { PartyDetailPage } from "@/components/parties/PartyDetailPage";

export default function SupplierDetailRoute() {
  const params = useParams();
  const id = String(params.id || "");
  return <PartyDetailPage kind="supplier" partyId={id} />;
}
