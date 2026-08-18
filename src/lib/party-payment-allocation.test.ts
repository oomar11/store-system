import assert from "node:assert/strict";
import { test } from "node:test";
import { previewPartyPaymentAllocation } from "./party-payment-allocation.ts";

test("supplier pay with no invoices is advance leftover, not a rejection", () => {
  const preview = previewPartyPaymentAllocation([], 500, 0);
  assert.equal(preview.allocations.length, 0);
  assert.equal(preview.totalOpen, 0);
  assert.equal(preview.leftover, 500);
  assert.equal(preview.towardInvoices, 0);
});

test("supplier pay above open invoices keeps the extra as account credit", () => {
  const preview = previewPartyPaymentAllocation(
    [
      {
        id: "inv-1",
        invoice_number: "P-1",
        total: 100,
        paid_amount: 40,
        remaining: 60,
        created_at: "2026-01-01",
      },
    ],
    200,
    60
  );
  assert.equal(preview.allocations.length, 1);
  assert.equal(preview.towardInvoices, 60);
  assert.equal(preview.leftover, 140);
});

test("opening-balance debt is covered before closing invoices", () => {
  const preview = previewPartyPaymentAllocation(
    [
      {
        id: "inv-1",
        invoice_number: "P-1",
        total: 80,
        paid_amount: 0,
        remaining: 80,
        created_at: "2026-01-01",
      },
    ],
    50,
    200
  );
  assert.equal(preview.allocations.length, 0);
  assert.equal(preview.nonInvoiceCover, 50);
  assert.equal(preview.towardInvoices, 0);
  assert.equal(preview.leftover, 50);
});
