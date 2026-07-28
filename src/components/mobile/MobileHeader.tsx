"use client";

import { RefreshCw } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { OfflineStatusBadge } from "@/components/offline/OfflineStatusBadge";

type MobileHeaderProps = {
  title?: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  trailing?: React.ReactNode;
};

export function MobileHeader({
  title = "ويندور",
  subtitle = "متصل بالسحابة",
  onRefresh,
  refreshing,
  trailing,
}: MobileHeaderProps) {
  return (
    <header className="mobile-header">
      <div className="mobile-header__brand">
        <BrandLogo size={36} className="mobile-header__logo-img" priority />
        <div>
          <h1 className="mobile-header__title">{title}</h1>
          {subtitle ? (
            <p className="mobile-header__status">
              <span className="mobile-header__dot" />
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mobile-header__actions">
        <OfflineStatusBadge href="/m/more/offline" />
        {trailing}
        {onRefresh ? (
          <button
            type="button"
            className="mobile-icon-btn"
            onClick={onRefresh}
            aria-label="تحديث"
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-5 w-5${refreshing ? " animate-spin" : ""}`}
            />
          </button>
        ) : null}
      </div>
    </header>
  );
}
