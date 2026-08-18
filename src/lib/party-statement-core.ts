export type PartyKind = "customer" | "supplier";
export type StatementSource = "store" | "aa" | "plisse";

export type StatementLine = {
  name: string;
  detail?: string;
  qty?: string;
  unitPrice?: number | null;
  total?: number | null;
};

export type StatementRow = {
  id: string;
  occurredAt: string;
  type: string;
  label: string;
  reference: string;
  notes: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
  sourceSystem: StatementSource;
  invoiceId?: string | null;
  lines: StatementLine[];
};

export type StatementParty = {
  id: string;
  kind: PartyKind;
  name: string;
  phone?: string | null;
  address?: string | null;
  balance: number;
  openingBalance: number;
};

export type PartyStatement = {
  kind: PartyKind;
  party: StatementParty;
  linkedParty: StatementParty | null;
  dateFrom: string | null;
  dateTo: string | null;
  title: string;
  openingBalance: number;
  closingBalance: number;
  periodDebit: number;
  periodCredit: number;
  rows: StatementRow[];
};

export type PartyStatementEvent = {
  id: string;
  occurredAt: string;
  sortRank: number;
  originKind: PartyKind;
  type: string;
  label: string;
  reference: string;
  notes: string | null;
  /** + يزيد رصيد الطرف الأصلي (عليه/علينا) */
  signedOrigin: number;
  sourceSystem: StatementSource;
  invoiceId?: string | null;
  lines: StatementLine[];
};

function roundMoney(amount: number): number {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

export function todayIsoDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function monthStartIsoDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export function daysAgoIsoDate(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return todayIsoDate(d);
}

export function toWhatsAppDigits(
  phone: string | null | undefined
): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  let n = digits;
  if (n.startsWith("00")) n = n.slice(2);
  if (n.startsWith("20") && n.length >= 11) return n;
  if (n.startsWith("0") && n.length >= 10) return `20${n.slice(1)}`;
  if (n.length === 10 && n.startsWith("1")) return `20${n}`;
  if (n.length >= 10) return n;
  return null;
}

export function debitCreditForPrimary(
  kind: PartyKind,
  signedPrimary: number
): { debit: number; credit: number } {
  const amount = roundMoney(Math.abs(signedPrimary));
  if (amount < 0.0005) return { debit: 0, credit: 0 };
  if (kind === "customer") {
    return signedPrimary > 0
      ? { debit: amount, credit: 0 }
      : { debit: 0, credit: amount };
  }
  return signedPrimary > 0
    ? { debit: 0, credit: amount }
    : { debit: amount, credit: 0 };
}

function dayStart(date: string): string {
  return `${date}T00:00:00`;
}

function dayEnd(date: string): string {
  return `${date}T23:59:59.999`;
}

function eventTime(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function assemblePartyStatement(params: {
  kind: PartyKind;
  party: StatementParty;
  linkedParty: StatementParty | null;
  dateFrom: string | null;
  dateTo: string | null;
  events: PartyStatementEvent[];
}): PartyStatement {
  const { kind, party, linkedParty, dateFrom, dateTo } = params;
  const toBound = dateTo ? eventTime(dayEnd(dateTo)) : Number.POSITIVE_INFINITY;

  const flipped = params.events.map((ev) => {
    const signedPrimary =
      ev.originKind === kind ? ev.signedOrigin : -ev.signedOrigin;
    return { ...ev, signedPrimary };
  });

  const inWindow = flipped.filter((ev) => eventTime(ev.occurredAt) <= toBound);
  inWindow.sort((a, b) => {
    const dt = eventTime(a.occurredAt) - eventTime(b.occurredAt);
    if (dt !== 0) return dt;
    return a.sortRank - b.sortRank;
  });

  const allSigned = flipped.reduce((s, ev) => s + ev.signedPrimary, 0);
  const primaryBalance = linkedParty
    ? roundMoney(party.balance - linkedParty.balance)
    : roundMoney(party.balance);

  const openingBalance = dateFrom
    ? roundMoney(primaryBalance - allSigned)
    : roundMoney(
        linkedParty
          ? party.openingBalance - linkedParty.openingBalance
          : party.openingBalance
      );

  const rows: StatementRow[] = [];
  let running = openingBalance;
  const openingDc = debitCreditForPrimary(kind, openingBalance);
  rows.push({
    id: "opening-prior",
    occurredAt: dateFrom ? dayStart(dateFrom) : "1970-01-01T00:00:00.000Z",
    type: "opening",
    label: dateFrom ? "رصيد سابق" : "رصيد افتتاحي",
    reference: "—",
    notes: null,
    debit: openingDc.debit,
    credit: openingDc.credit,
    runningBalance: running,
    sourceSystem: "store",
    lines: [],
  });

  let periodDebit = 0;
  let periodCredit = 0;

  for (const ev of inWindow) {
    const dc = debitCreditForPrimary(kind, ev.signedPrimary);
    running = roundMoney(running + ev.signedPrimary);
    periodDebit = roundMoney(periodDebit + dc.debit);
    periodCredit = roundMoney(periodCredit + dc.credit);
    rows.push({
      id: ev.id,
      occurredAt: ev.occurredAt,
      type: ev.type,
      label: ev.label,
      reference: ev.reference,
      notes: ev.notes,
      debit: dc.debit,
      credit: dc.credit,
      runningBalance: running,
      sourceSystem: ev.sourceSystem,
      invoiceId: ev.invoiceId || null,
      lines: ev.lines,
    });
  }

  const isDual = Boolean(linkedParty);
  const title = isDual
    ? `كشف حساب موحّد — ${party.name}`
    : kind === "customer"
      ? `كشف حساب عميل — ${party.name}`
      : `كشف حساب مورد — ${party.name}`;

  return {
    kind,
    party,
    linkedParty,
    dateFrom,
    dateTo,
    title,
    openingBalance,
    closingBalance: running,
    periodDebit,
    periodCredit,
    rows,
  };
}
