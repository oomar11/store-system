import type { LucideIcon } from "lucide-react";

export interface DaySales {
  label: string;
  value: number;
}

export interface RecentInvoice {
  id: string;
  invoice_number: string;
  total: number;
  created_at: string;
  customer?: { name: string } | null;
}

export interface DashboardStats {
  totalProducts: number;
  totalCustomers: number;
  totalSalesToday: number;
  lowStockCount: number;
  totalRevenue: number;
  weeklySales: DaySales[];
  totalSafes: number;
}

export interface DashboardAction {
  title: string;
  subtitle: string;
  href: string;
  icon: LucideIcon;
}

export interface SetupStep {
  done: boolean;
  title: string;
  subtitle: string;
  href: string;
}
