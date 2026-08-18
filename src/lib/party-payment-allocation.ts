/** FIFO + account-credit allocation for customer collect / supplier pay. */

export type OpenInvoiceForPayment = {
  id: string;
  invoice_number: string;
  total: number;
  paid_amount: number;
  remaining: number;
  created_at: string;
};

export type AllocationPreview = {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  remainingAfter: number;
};

export function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Preview FIFO allocation without writing. */
export function previewFifoAllocation(
  invoices: OpenInvoiceForPayment[],
  amount: number
): { allocations: AllocationPreview[]; totalOpen: number; leftover: number } {
  const pay = money(amount);
  const totalOpen = money(
    invoices.reduce((sum, inv) => sum + inv.remaining, 0)
  );
  let left = pay;
  const allocations: AllocationPreview[] = [];

  for (const inv of invoices) {
    if (left <= 0.001) break;
    const slice = money(Math.min(left, inv.remaining));
    if (slice <= 0) continue;
    allocations.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number,
      amount: slice,
      remainingAfter: money(inv.remaining - slice),
    });
    left = money(left - slice);
  }

  return { allocations, totalOpen, leftover: left };
}

/**
 * Allocate a party payment without closing invoices before covering
 * non-invoice debt (opening balance, linked debts, etc.).
 *
 * Order: (1) cover max(0, partyBalance - openInvoices), (2) FIFO on invoices,
 * (3) anything left is account credit/advance.
 *
 * Leftover is never an error — overpay / no invoices is allowed.
 */
export function previewPartyPaymentAllocation(
  invoices: OpenInvoiceForPayment[],
  amount: number,
  partyBalance: number
): {
  allocations: AllocationPreview[];
  totalOpen: number;
  leftover: number;
  nonInvoiceCover: number;
  towardInvoices: number;
} {
  const pay = money(amount);
  const totalOpen = money(
    invoices.reduce((sum, inv) => sum + inv.remaining, 0)
  );
  const bal = money(partyBalance);
  const nonInvoiceDebt = money(Math.max(0, bal - totalOpen));
  const nonInvoiceCover = money(Math.min(pay, nonInvoiceDebt));
  const towardInvoices = money(Math.max(0, pay - nonInvoiceCover));
  const fifo = previewFifoAllocation(invoices, towardInvoices);
  const leftover = money(nonInvoiceCover + fifo.leftover);

  return {
    allocations: fifo.allocations,
    totalOpen,
    leftover,
    nonInvoiceCover,
    towardInvoices: money(towardInvoices - fifo.leftover),
  };
}
