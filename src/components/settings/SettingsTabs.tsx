"use client";

import type { LucideIcon } from "lucide-react";
import {
  HardDrive,
  Package,
  Palette,
  Printer,
  Tags,
  Users,
  Wallet,
} from "lucide-react";
import type { SettingsTabId } from "./settings-form";

export type SettingsTabDef = {
  id: SettingsTabId;
  label: string;
};

type SettingsTabsProps = {
  tabs: SettingsTabDef[];
  active: SettingsTabId;
  onChange: (tab: SettingsTabId) => void;
};

const TAB_ICONS: Record<SettingsTabId, LucideIcon> = {
  general: Palette,
  finance: Wallet,
  print: Printer,
  inventory: Package,
  tiers: Tags,
  users: Users,
  backup: HardDrive,
};

export function SettingsTabs({ tabs, active, onChange }: SettingsTabsProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="settings-tab-track mb-6" role="tablist" aria-label="أقسام الإعدادات">
      <div className="settings-tab-track__scroll">
        {tabs.map((tab) => {
          const Icon = TAB_ICONS[tab.id];
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={`settings-tab ${isActive ? "settings-tab--active" : ""}`}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
