import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assemblePartyStatement,
  debitCreditForPrimary,
  toWhatsAppDigits,
  type PartyStatementEvent,
  type StatementParty,
} from "./party-statement-core.ts";

function customer(): StatementParty {
  return {
    id: "c1",
    kind: "customer",
    name: "أحمد",
    phone: "01012345678",
    address: null,
    balance: 600,
    openingBalance: 0,
  };
}

function ev(
  partial: Partial<PartyStatementEvent> &
    Pick<PartyStatementEvent, "id" | "occurredAt" | "type" | "signedOrigin">
): PartyStatementEvent {
  return {
    sortRank: 0,
    originKind: "customer",
    label: partial.type,
    reference: partial.id,
    notes: null,
    sourceSystem: "store",
    lines: [],
    ...partial,
  };
}

test("Egyptian mobile numbers become WhatsApp digits", () => {
  assert.equal(toWhatsAppDigits("01012345678"), "201012345678");
  assert.equal(toWhatsAppDigits("+20 101 234 5678"), "201012345678");
  assert.equal(toWhatsAppDigits("00201012345678"), "201012345678");
  assert.equal(toWhatsAppDigits("1012345678"), "201012345678");
  assert.equal(toWhatsAppDigits(""), null);
  assert.equal(toWhatsAppDigits("123"), null);
});

test("customer debit is عليه and supplier credit is علينا", () => {
  assert.deepEqual(debitCreditForPrimary("customer", 100), {
    debit: 100,
    credit: 0,
  });
  assert.deepEqual(debitCreditForPrimary("customer", -40), {
    debit: 0,
    credit: 40,
  });
  assert.deepEqual(debitCreditForPrimary("supplier", 80), {
    debit: 0,
    credit: 80,
  });
  assert.deepEqual(debitCreditForPrimary("supplier", -25), {
    debit: 25,
    credit: 0,
  });
});

test("credit sale then collection reconstructs the customer balance", () => {
  const statement = assemblePartyStatement({
    kind: "customer",
    party: customer(),
    linkedParty: null,
    dateFrom: "2026-08-01",
    dateTo: "2026-08-18",
    events: [
      ev({
        id: "inv-1",
        occurredAt: "2026-08-05T10:00:00",
        type: "sale",
        label: "بيع",
        reference: "S-1",
        signedOrigin: 1000,
      }),
      ev({
        id: "pay-1",
        occurredAt: "2026-08-10T10:00:00",
        type: "collection",
        label: "تحصيل",
        reference: "تحص-1",
        signedOrigin: -400,
        sortRank: 2,
      }),
    ],
  });
  assert.equal(statement.openingBalance, 0);
  assert.equal(statement.closingBalance, 600);
  assert.equal(statement.periodDebit, 1000);
  assert.equal(statement.periodCredit, 400);
  const sale = statement.rows.find((r) => r.type === "sale");
  const coll = statement.rows.find((r) => r.type === "collection");
  assert.equal(sale?.debit, 1000);
  assert.equal(coll?.credit, 400);
  assert.equal(coll?.runningBalance, 600);
});

test("cash paid with the invoice does not leave a customer balance", () => {
  const statement = assemblePartyStatement({
    kind: "customer",
    party: { ...customer(), balance: 0 },
    linkedParty: null,
    dateFrom: "2026-08-01",
    dateTo: "2026-08-18",
    events: [
      ev({
        id: "inv-1",
        occurredAt: "2026-08-05T10:00:00",
        type: "sale",
        signedOrigin: 250,
      }),
      ev({
        id: "inv-paid-1",
        occurredAt: "2026-08-05T10:00:00",
        type: "invoice_payment",
        signedOrigin: -250,
        sortRank: 1,
      }),
    ],
  });
  assert.equal(statement.closingBalance, 0);
});

test("supplier purchase shows as credit (علينا)", () => {
  const statement = assemblePartyStatement({
    kind: "supplier",
    party: {
      id: "s1",
      kind: "supplier",
      name: "مورد",
      phone: null,
      address: null,
      balance: 500,
      openingBalance: 0,
    },
    linkedParty: null,
    dateFrom: "2026-08-01",
    dateTo: "2026-08-18",
    events: [
      ev({
        id: "inv-p",
        occurredAt: "2026-08-03T09:00:00",
        originKind: "supplier",
        type: "purchase",
        label: "شراء",
        reference: "P-1",
        signedOrigin: 500,
      }),
    ],
  });
  const purchase = statement.rows.find((r) => r.type === "purchase");
  assert.equal(purchase?.credit, 500);
  assert.equal(purchase?.debit, 0);
  assert.equal(statement.closingBalance, 500);
});
