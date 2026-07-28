"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
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

    setLoading(false);
    onCreated(data as Customer | Supplier);
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
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
}
