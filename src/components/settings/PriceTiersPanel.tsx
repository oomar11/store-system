"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Percent, Plus, RefreshCw, Star, Tags, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { listPriceTiers } from "@/lib/price-tiers";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { TierRulesModal } from "@/components/settings/TierRulesModal";
import { SettingsCard } from "@/components/settings/SettingsCard";
import type { PriceTier } from "@/types";

export function PriceTiersPanel() {
  const supabase = createClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();
  const [tiers, setTiers] = useState<PriceTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [rulesTier, setRulesTier] = useState<PriceTier | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTiers(await listPriceTiers(supabase));
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر تحميل الشرائح");
    } finally {
      setLoading(false);
    }
  }, [supabase, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const maxSort = tiers.reduce((m, t) => Math.max(m, t.sort_order), 0);
      const { error } = await supabase.from("price_tiers").insert({
        name,
        is_default: false,
        sort_order: maxSort + 1,
      });
      if (error) throw new Error(error.message);
      setNewName("");
      toastSuccess("تمت إضافة الشريحة");
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر الإضافة");
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(tier: PriceTier) {
    const name = editName.trim();
    if (!name || name === tier.name) {
      setEditingId(null);
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("price_tiers")
        .update({ name })
        .eq("id", tier.id);
      if (error) throw new Error(error.message);
      toastSuccess("تم تحديث الاسم");
      setEditingId(null);
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر التعديل");
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(tier: PriceTier) {
    if (tier.is_default) return;
    if (
      !(await confirm({
        title: "تعيين شريحة افتراضية",
        message: `جعل «${tier.name}» هي شريحة التجزئة الافتراضية؟\nسيتم مزامنة أسعارها مع سعر البيع على الأصناف.`,
        confirmLabel: "تعيين",
      }))
    ) {
      return;
    }
    setSaving(true);
    try {
      await supabase
        .from("price_tiers")
        .update({ is_default: false })
        .eq("is_default", true);
      const { error } = await supabase
        .from("price_tiers")
        .update({ is_default: true })
        .eq("id", tier.id);
      if (error) throw new Error(error.message);
      toastSuccess("تم تعيين الشريحة الافتراضية");
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر التعيين");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tier: PriceTier) {
    if (tier.is_default) {
      toastError("لا يمكن حذف الشريحة الافتراضية");
      return;
    }
    if (
      !(await confirm({
        message: `حذف شريحة «${tier.name}»؟ الأسعار والقواعد المرتبطة بها ستُحذف.`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("price_tiers")
        .delete()
        .eq("id", tier.id);
      if (error) throw new Error(error.message);
      toastSuccess("تم الحذف");
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر الحذف");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      title="شرائح الأسعار"
      description="تجزئة / جملة / خصم أقسام. اربط العميل بشريحة، واضبط قواعد الخصم أو الأسعار الثابتة من بطاقة الصنف."
      icon={Tags}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--muted)] hover:bg-[var(--surface-subtle)]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          تحديث
        </button>
      }
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--primary)]" />
        </div>
      ) : (
        <ul className="mb-4 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          {tiers.map((tier) => (
            <li
              key={tier.id}
              className="flex flex-wrap items-center gap-2 px-3 py-2.5"
            >
              {editingId === tier.id ? (
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleRename(tier);
                    }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="min-w-[8rem] flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-2 py-1.5 text-sm text-[var(--foreground)]"
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(tier.id);
                    setEditName(tier.name);
                  }}
                  className="min-w-0 flex-1 text-right text-sm font-semibold text-[var(--foreground)] hover:text-[var(--primary)]"
                >
                  {tier.name}
                  {tier.is_default && (
                    <span className="mr-2 inline-flex items-center gap-0.5 rounded-full bg-[color-mix(in_srgb,var(--warning)_16%,var(--surface))] px-2 py-0.5 text-[10px] font-bold text-[var(--warning)]">
                      <Star className="h-3 w-3" />
                      افتراضي
                    </span>
                  )}
                </button>
              )}

              <div className="flex items-center gap-1">
                {editingId === tier.id ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleRename(tier)}
                    className="rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[var(--primary-dark)]"
                  >
                    حفظ
                  </button>
                ) : (
                  <>
                    {!tier.is_default && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setRulesTier(tier)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] px-2.5 py-1.5 text-xs font-semibold text-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_22%,var(--surface))]"
                        title="قواعد الخصم"
                      >
                        <Percent className="h-3.5 w-3.5" />
                        قواعد
                      </button>
                    )}
                    {!tier.is_default && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleSetDefault(tier)}
                        className="rounded-lg border border-[color-mix(in_srgb,var(--warning)_35%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_14%,var(--surface))] px-2.5 py-1.5 text-xs font-semibold text-[var(--warning)] hover:bg-[color-mix(in_srgb,var(--warning)_22%,var(--surface))]"
                        title="تعيين كافتراضي"
                      >
                        افتراضي
                      </button>
                    )}
                  </>
                )}
                {!tier.is_default && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleDelete(tier)}
                    className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,var(--surface))]"
                    title="حذف"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
          {tiers.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-[var(--muted-soft)]">
              لا توجد شرائح
            </li>
          )}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="اسم شريحة جديدة (مثل: جملة)"
          className="flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={saving || !newName.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          إضافة
        </button>
      </form>

      {rulesTier && (
        <TierRulesModal tier={rulesTier} onClose={() => setRulesTier(null)} />
      )}
    </SettingsCard>
  );
}
