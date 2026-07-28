import type { PrintFormatsConfig } from "@/lib/print-formats";
import { DEFAULT_PRINT_FORMATS } from "@/lib/print-formats";

export type SettingsTabId =
  | "general"
  | "finance"
  | "print"
  | "inventory"
  | "tiers"
  | "users"
  | "backup";

export type SettingsFormState = {
  store_name: string;
  phone: string;
  address: string;
  logo_url: string;
  tax_number: string;
  commercial_register: string;
  receipt_footer: string;
  invoice_tagline: string;
  tax_rate: number;
  tax_enabled: boolean;
  currency: string;
  print_offset: number;
  drawer_safe_id: string;
  default_low_stock_threshold: number;
  print_formats: PrintFormatsConfig;
};

export const EMPTY_SETTINGS_FORM: SettingsFormState = {
  store_name: "",
  phone: "",
  address: "",
  logo_url: "",
  tax_number: "",
  commercial_register: "",
  receipt_footer: "",
  invoice_tagline: "",
  tax_rate: 15,
  tax_enabled: true,
  currency: "EGP",
  print_offset: 0,
  drawer_safe_id: "",
  default_low_stock_threshold: 0,
  print_formats: { ...DEFAULT_PRINT_FORMATS },
};

export const DOCUMENT_SEQUENCE_LABELS: Record<string, string> = {
  sale: "فواتير البيع",
  purchase: "فواتير الشراء",
  quote: "عروض الأسعار",
  purchase_order: "طلبات المشتريات",
  sale_return: "مرتجعات البيع",
  purchase_return: "مرتجعات الشراء",
  inventory_count: "الجرد",
};

export const SETTINGS_SAVE_TABS: SettingsTabId[] = [
  "general",
  "finance",
  "print",
  "inventory",
];
