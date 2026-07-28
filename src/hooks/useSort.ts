import { useState, useMemo } from "react";

export type SortDirection = "asc" | "desc" | null;

export interface SortConfig {
  key: string;
  direction: SortDirection;
}

export function useSort<T>(items: T[], initialConfig: SortConfig = { key: "", direction: null }) {
  const [sortConfig, setSortConfig] = useState<SortConfig>(initialConfig);

  const sortedItems = useMemo(() => {
    if (!sortConfig.key || !sortConfig.direction) return items;

    return [...items].sort((a, b) => {
      let aVal: any = a;
      let bVal: any = b;

      // Handle nested property keys (e.g. "category.name")
      if (sortConfig.key.includes(".")) {
        const parts = sortConfig.key.split(".");
        for (const part of parts) {
          aVal = aVal?.[part];
          bVal = bVal?.[part];
        }
      } else {
        aVal = (a as any)[sortConfig.key];
        bVal = (b as any)[sortConfig.key];
      }

      // Handle null/undefined values
      if (aVal === null || aVal === undefined) return sortConfig.direction === "asc" ? -1 : 1;
      if (bVal === null || bVal === undefined) return sortConfig.direction === "asc" ? 1 : -1;

      // Date comparison if valid dates (ensure we don't treat normal short numbers or SKUs as dates)
      const isDateA = aVal instanceof Date || (typeof aVal === "string" && aVal.includes("-") && !isNaN(Date.parse(aVal)) && isNaN(Number(aVal)));
      const isDateB = bVal instanceof Date || (typeof bVal === "string" && bVal.includes("-") && !isNaN(Date.parse(bVal)) && isNaN(Number(bVal)));
      
      // If it looks like ISO date or date format, parse it
      if (isDateA && isDateB) {
        const dateA = new Date(aVal).getTime();
        const dateB = new Date(bVal).getTime();
        return sortConfig.direction === "asc" ? dateA - dateB : dateB - dateA;
      }

      // Numeric comparison
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
      }

      // Numeric strings (like SKU numbers if numeric, but keep as string comparison if needed)
      // Check if both strings are numeric
      const numA = Number(aVal);
      const numB = Number(bVal);
      if (!isNaN(numA) && !isNaN(numB) && typeof aVal === "string" && typeof bVal === "string" && aVal !== "" && bVal !== "") {
        return sortConfig.direction === "asc" ? numA - numB : numB - numA;
      }

      // Arabic string comparison (localeCompare)
      const strA = String(aVal);
      const strB = String(bVal);
      const comp = strA.localeCompare(strB, "ar", { sensitivity: "accent", numeric: true });
      return sortConfig.direction === "asc" ? comp : -comp;
    });
  }, [items, sortConfig]);

  const requestSort = (key: string) => {
    let direction: SortDirection = "asc";
    if (sortConfig.key === key) {
      if (sortConfig.direction === "asc") {
        direction = "desc";
      } else if (sortConfig.direction === "desc") {
        direction = null; // Reset sort to default order
      }
    }
    setSortConfig({ key: direction ? key : "", direction });
  };

  return { items: sortedItems, sortConfig, requestSort };
}
