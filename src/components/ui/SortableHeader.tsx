import React from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

interface SortableHeaderProps {
  label: string;
  field: string;
  sortField: string | null;
  sortDirection: "asc" | "desc" | null;
  onSort: (field: string) => void;
  className?: string;
  align?: "right" | "left" | "center";
}

export function SortableHeader({
  label,
  field,
  sortField,
  sortDirection,
  onSort,
  className = "",
  align = "right",
}: SortableHeaderProps) {
  const isActive = sortField === field;

  const getAlignClass = () => {
    if (align === "left") return "justify-start text-left";
    if (align === "center") return "justify-center text-center";
    return "justify-start text-right"; // In RTL environment, justify-start aligns to the right.
  };

  return (
    <th
      onClick={() => onSort(field)}
      className={`px-4 py-3 cursor-pointer select-none hover:bg-gray-100/80 transition-colors ${className}`}
    >
      <div className={`flex items-center gap-1.5 ${getAlignClass()}`}>
        <span className="font-medium text-gray-700">{label}</span>
        <span className="inline-flex text-gray-400">
          {!isActive && <ChevronsUpDown className="h-3.5 w-3.5 opacity-30" />}
          {isActive && sortDirection === "asc" && <ChevronUp className="h-3.5 w-3.5 text-blue-700 stroke-[3px]" />}
          {isActive && sortDirection === "desc" && <ChevronDown className="h-3.5 w-3.5 text-blue-700 stroke-[3px]" />}
        </span>
      </div>
    </th>
  );
}
