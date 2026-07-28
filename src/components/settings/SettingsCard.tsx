"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type SettingsCardProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function SettingsCard({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className = "",
}: SettingsCardProps) {
  return (
    <section className={`settings-card ${className}`.trim()}>
      <div className="settings-card__header">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {Icon ? (
            <span className="settings-card__icon" aria-hidden>
              <Icon className="h-4.5 w-4.5 h-[18px] w-[18px]" strokeWidth={2} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="settings-card__title">{title}</h2>
            {description ? (
              <p className="settings-card__desc">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="settings-card__body">{children}</div>
    </section>
  );
}

type SettingsFieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
};

export function SettingsField({
  label,
  hint,
  children,
  className = "",
}: SettingsFieldProps) {
  return (
    <div className={`settings-field ${className}`.trim()}>
      <label className="settings-label">{label}</label>
      {children}
      {hint ? <p className="settings-hint">{hint}</p> : null}
    </div>
  );
}

export function SettingsFieldGrid({ children }: { children: ReactNode }) {
  return <div className="settings-field-grid">{children}</div>;
}
