"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { linkPartyAccounts } from "@/lib/party-link";
import type { Customer, Supplier } from "@/types";

type PartyKind = "customer" | "supplier";

type QuickPartyFormProps = {
  kind: PartyKind;
  initialName?: string;
  onClose: () => void;
  onCreated: (party: Customer | Supplier) => void;
};

export function QuickPartyForm({
  kind,
  initialName = "",
  onClose,
  onCreated,
}: QuickPartyFormProps) {
  const isCustomer = kind === "customer";
  const [name, setName] = useState(initialName.trim());
  const [phone, setPhone] = useState("");
  const [alsoDual, setAlsoDual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("الاسم مطلوب");
      return;
    }

    setLoading(true);
    setError("");

    const table = isCustomer ? "customers" : "suppliers";
    const payload = {
      name: trimmed,
      phone: phone.trim() || null,
      balance: 0,
      opening_balance: 0,
    };

    const { data, error: insertError } = await supabase
      .from(table)
      .insert(payload)
      .select("*")
      .single();

    if (insertError || !data) {
      setError(insertError?.message || "تعذر الحفظ");
      setLoading(false);
      return;
    }

    let party = data as Customer | Supplier;

    if (alsoDual) {
      const otherTable = isCustomer ? "suppliers" : "customers";
      const { data: other, error: otherErr } = await supabase
        .from(otherTable)
        .insert(payload)
        .select("*")
        .single();
      if (otherErr || !other) {
        setError(otherErr?.message || "تم الحفظ لكن تعذر إنشاء الطرف المربوط");
        setLoading(false);
        onCreated(party);
        return;
      }
      try {
        const customerId = isCustomer ? party.id : (other as Customer).id;
        const supplierId = isCustomer ? (other as Supplier).id : party.id;
        await linkPartyAccounts(supabase, customerId, supplierId);
        if (isCustomer) {
          party = { ...(party as Customer), linked_supplier_id: supplierId };
        } else {
          party = { ...(party as Supplier), linked_customer_id: customerId };
        }
      } catch (linkErr) {
        setError(
          linkErr instanceof Error
            ? linkErr.message
            : "تم الإنشاء لكن تعذر الربط"
        );
        setLoading(false);
        onCreated(party);
        return;
      }
    }

    setLoading(false);
    onCreated(party);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isCustomer ? "إضافة عميل سريع" : "إضافة مورد سريع"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            الاسم *
          </label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            الهاتف
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            dir="ltr"
            placeholder="اختياري"
          />
        </div>

        <label className="flex items-start gap-2 rounded-lg border border-violet-100 bg-violet-50/70 px-3 py-2 text-sm text-violet-900">
          <input
            type="checkbox"
            checked={alsoDual}
            onChange={(e) => setAlsoDual(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-bold">عميل ومورد معاً</span>
            <span className="mt-0.5 block text-xs text-violet-800/80">
              ينشئ الحسابين ويربطهما لرصيد صافي واحد (ليّا / عليّا)
            </span>
          </span>
        </label>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? "جاري الحفظ..." : "حفظ واختيار"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
}
