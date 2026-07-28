"use client";

import { useParams } from "next/navigation";
import { PartyPaymentDetailPage } from "@/components/parties/PartyPaymentDetailPage";

export default function SupplierPaymentNewPage() {
  const params = useParams();
  const partyId = String(params.id || "");
  return (
    <PartyPaymentDetailPage
      kind="supplier"
      partyId={partyId}
      paymentId={null}
    />
  );
}
