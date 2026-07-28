"use client";

import { useParams } from "next/navigation";
import { PartyPaymentDetailPage } from "@/components/parties/PartyPaymentDetailPage";

export default function SupplierPaymentDetailRoute() {
  const params = useParams();
  const partyId = String(params.id || "");
  const paymentId = String(params.paymentId || "");
  return (
    <PartyPaymentDetailPage
      kind="supplier"
      partyId={partyId}
      paymentId={paymentId}
    />
  );
}
