"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ClipboardList, ExternalLink, Hash } from "lucide-react";
import { createClient } from "@/lib/supabase";
import {
  DOCUMENT_SEQUENCE_LABELS,
  type SettingsFormState,
} from "./settings-form";
import { SettingsCard, SettingsField } from "./SettingsCard";

type SequenceRow = {
  kind: string;
  period: string;
  last_value: number;
};

type InventorySettingsSectionProps = {
  form: SettingsFormState;
  setForm: React.Dispatch<React.SetStateAction<SettingsFormState>>;
};

export function InventorySettingsSection({
  form,
  setForm,
}: InventorySettingsSectionProps) {
  const [sequences, setSequences] = useState<SequenceRow[]>([]);
  const [seqLoading, setSeqLoading] = useState(true);
  const [seqError, setSeqError] = useState("");
  const supabase = createClient();
  const year = String(new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setSeqLoading(true);
      setSeqError("");
      const { data, error } = await supabase
        .from("document_sequences")
        .select("kind, period, last_value")
        .eq("period", year)
        .order("kind");
      if (cancelled) return;
      if (error) {
        setSeqError(error.message);
        setSequences([]);
      } else {
        setSequences((data as SequenceRow[]) || []);
      }
      setSeqLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  return (
    <div className="space-y-5">
      <SettingsCard
        title="ورقة الجرد"
        description="تخصيص أعمدة وعناوين ورقة الجرد المطبوعة عند العدّ الفعلي."
        icon={ClipboardList}
      >
        <Link
          href="/inventory/sheet-setup"
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface))] px-4 py-2.5 text-sm font-bold text-[var(--primary)] transition hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))]"
        >
          فتح إعداد ورقة الجرد
          <ExternalLink className="h-4 w-4" />
        </Link>
      </SettingsCard>

      <SettingsCard
        title="تنبيه نقص المخزون"
        description="قيمة ابتدائية لحقل الحد الأدنى عند إنشاء منتج جديد."
        icon={AlertTriangle}
      >
        <SettingsField
          label="الحد الافتراضي للحد الأدنى"
          hint="يمكن تغييره لكل منتج على حدة لاحقاً."
        >
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.default_low_stock_threshold}
            onChange={(e) =>
              setForm({
                ...form,
                default_low_stock_threshold: Math.max(
                  0,
                  Number(e.target.value) || 0
                ),
              })
            }
            className="settings-input w-40 max-w-full"
            dir="ltr"
          />
        </SettingsField>
      </SettingsCard>

      <SettingsCard
        title="تسلسل أرقام المستندات"
        description={`آخر رقم مُخصَّص لكل نوع مستند لسنة ${year} (للعرض فقط).`}
        icon={Hash}
      >
        {seqLoading ? (
          <p className="text-sm text-[var(--muted)]">جاري التحميل...</p>
        ) : seqError ? (
          <p className="text-sm text-amber-700">تعذر تحميل التسلسل: {seqError}</p>
        ) : sequences.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            لا توجد أرقام مسجّلة لهذه السنة بعد.
          </p>
        ) : (
          <ul className="divide-y divide-[color-mix(in_srgb,var(--border)_60%,transparent)] overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--border)_70%,transparent)]">
            {sequences.map((row) => (
              <li
                key={`${row.kind}-${row.period}`}
                className="flex items-center justify-between gap-3 bg-[var(--surface)] px-4 py-3 text-sm"
              >
                <span className="font-semibold text-[var(--foreground)]">
                  {DOCUMENT_SEQUENCE_LABELS[row.kind] || row.kind}
                </span>
                <span
                  className="font-mono font-bold text-[var(--primary)]"
                  dir="ltr"
                >
                  {row.last_value}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </div>
  );
}
