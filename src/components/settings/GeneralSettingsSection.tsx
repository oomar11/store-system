"use client";

import { Building2, Landmark, Monitor, Moon, Palette, Sun } from "lucide-react";
import type { ThemePreference } from "@/lib/theme";
import type { SettingsFormState } from "./settings-form";
import {
  SettingsCard,
  SettingsField,
  SettingsFieldGrid,
} from "./SettingsCard";

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: "system", label: "تلقائي", icon: Monitor },
  { value: "light", label: "فاتح", icon: Sun },
  { value: "dark", label: "داكن", icon: Moon },
];

type GeneralSettingsSectionProps = {
  theme: ThemePreference;
  setTheme: (t: ThemePreference) => void;
  canStoreSettings: boolean;
  form: SettingsFormState;
  setForm: React.Dispatch<React.SetStateAction<SettingsFormState>>;
};

export function GeneralSettingsSection({
  theme,
  setTheme,
  canStoreSettings,
  form,
  setForm,
}: GeneralSettingsSectionProps) {
  return (
    <div className="space-y-5">
      <SettingsCard
        title="المظهر"
        description="اختر الوضع الفاتح أو الداكن، أو اتركه يتبع نظام الجهاز."
        icon={Palette}
      >
        <div className="settings-theme-grid">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                className={`settings-theme-option ${
                  active ? "settings-theme-option--active" : ""
                }`}
                aria-pressed={active}
              >
                <Icon className="h-5 w-5" strokeWidth={2} />
                {option.label}
              </button>
            );
          })}
        </div>
      </SettingsCard>

      {canStoreSettings && (
        <>
          <SettingsCard
            title="بيانات المحل"
            description="الاسم وبيانات التواصل تظهر على الفواتير والمستندات."
            icon={Building2}
          >
            <div className="space-y-4">
              <SettingsField label="اسم المحل">
                <input
                  type="text"
                  value={form.store_name}
                  onChange={(e) =>
                    setForm({ ...form, store_name: e.target.value })
                  }
                  className="settings-input"
                />
              </SettingsField>

              <SettingsFieldGrid>
                <SettingsField label="رقم الهاتف">
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) =>
                      setForm({ ...form, phone: e.target.value })
                    }
                    className="settings-input"
                    dir="ltr"
                  />
                </SettingsField>
                <SettingsField label="العملة الافتراضية">
                  <select
                    value={form.currency}
                    onChange={(e) =>
                      setForm({ ...form, currency: e.target.value })
                    }
                    className="settings-select"
                  >
                    <option value="EGP">جنيه مصري (EGP)</option>
                    <option value="USD">دولار أمريكي (USD)</option>
                    <option value="SAR">ريال سعودي (SAR)</option>
                    <option value="AED">درهم إماراتي (AED)</option>
                  </select>
                </SettingsField>
              </SettingsFieldGrid>

              <SettingsField label="العنوان">
                <textarea
                  value={form.address}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                  rows={2}
                  className="settings-textarea"
                />
              </SettingsField>

              <SettingsField
                label="رابط شعار المحل"
                hint="يظهر على الفواتير والنسخ الاحتياطي. اتركه فارغاً لاستخدام الشعار الافتراضي."
              >
                <input
                  type="url"
                  value={form.logo_url}
                  onChange={(e) =>
                    setForm({ ...form, logo_url: e.target.value })
                  }
                  placeholder="https://..."
                  className="settings-input"
                  dir="ltr"
                />
                {form.logo_url.trim() ? (
                  <div className="settings-logo-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={form.logo_url.trim()}
                      alt="معاينة الشعار"
                      className="max-h-20 max-w-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                ) : null}
              </SettingsField>

              <SettingsField
                label="جملة الفاتورة"
                hint="تظهر تحت اسم المحل في فاتورة البيع. اتركها فارغة لإخفائها."
              >
                <input
                  type="text"
                  value={form.invoice_tagline}
                  onChange={(e) =>
                    setForm({ ...form, invoice_tagline: e.target.value })
                  }
                  placeholder={
                    form.store_name.trim()
                      ? `مثال: ${form.store_name.trim()} — وكيل حصري`
                      : "مثال: وكيل حصري لبريمير"
                  }
                  className="settings-input"
                />
              </SettingsField>
            </div>
          </SettingsCard>

          <SettingsCard
            title="بيانات قانونية"
            description="تظهر تحت بيانات الاتصال في الفاتورة المطبوعة."
            icon={Landmark}
          >
            <div className="space-y-4">
              <SettingsFieldGrid>
                <SettingsField label="الرقم الضريبي">
                  <input
                    type="text"
                    value={form.tax_number}
                    onChange={(e) =>
                      setForm({ ...form, tax_number: e.target.value })
                    }
                    className="settings-input"
                    dir="ltr"
                  />
                </SettingsField>
                <SettingsField label="السجل التجاري">
                  <input
                    type="text"
                    value={form.commercial_register}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        commercial_register: e.target.value,
                      })
                    }
                    className="settings-input"
                    dir="ltr"
                  />
                </SettingsField>
              </SettingsFieldGrid>
              <SettingsField
                label="تذييل الفاتورة"
                hint="يظهر أسفل الفاتورة. اتركه فارغاً لاستخدام النص الافتراضي."
              >
                <textarea
                  value={form.receipt_footer}
                  onChange={(e) =>
                    setForm({ ...form, receipt_footer: e.target.value })
                  }
                  rows={3}
                  placeholder="مثال: البضاعة المباعة لا ترد ولا تستبدل إلا خلال 14 يوماً مع وجود الفاتورة الأصلية."
                  className="settings-textarea"
                />
              </SettingsField>
            </div>
          </SettingsCard>
        </>
      )}

      {!canStoreSettings ? (
        <p className="text-center text-sm text-[var(--muted)]">
          يمكنك تغيير المظهر فقط. باقي إعدادات المحل تحتاج صلاحية الإعدادات.
        </p>
      ) : null}
    </div>
  );
}
