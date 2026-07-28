"use client";

import { useParams } from "next/navigation";
import { PartyPaymentDetailPage } from "@/components/parties/PartyPaymentDetailPage";

export default function CustomerPaymentDetailRoute() {
  const params = useParams();
  const partyId = String(params.id || "");
  const paymentId = String(params.paymentId || "");
  return (
    <PartyPaymentDetailPage
      kind="customer"
      partyId={partyId}
      paymentId={paymentId}
    />
  );
}
