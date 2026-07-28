"use client";

import { useParams } from "next/navigation";
import { PartyPaymentDetailPage } from "@/components/parties/PartyPaymentDetailPage";

export default function CustomerPaymentNewPage() {
  const params = useParams();
  const partyId = String(params.id || "");
  return (
    <PartyPaymentDetailPage
      kind="customer"
      partyId={partyId}
      paymentId={null}
    />
  );
}
