"use client";

import { useState } from "react";

const NAV_ITEMS = ["Dashboard", "Warehouse", "Inventory", "Movement"];
const ACTIVE_ITEM = "Warehouse";

/** Sidebar navigasi yang bisa di-minimize supaya area 3D lebih lega. */
export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ${
        collapsed ? "w-14 p-2" : "w-56 p-4"
      }`}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Perbesar sidebar" : "Minimize sidebar"}
        title={collapsed ? "Perbesar sidebar" : "Minimize sidebar"}
        className={`mb-2 flex h-8 items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 ${
          collapsed ? "justify-center" : "justify-end px-2"
        }`}
      >
        <span aria-hidden className="text-sm">
          {collapsed ? "»" : "«"}
        </span>
      </button>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <span
            key={item}
            title={collapsed ? item : undefined}
            className={`flex h-9 items-center rounded-md text-sm font-medium ${
              collapsed ? "justify-center" : "px-3"
            } ${item === ACTIVE_ITEM ? "bg-blue-50 text-blue-700" : "text-slate-600"}`}
          >
            {/* Saat diminimize hanya huruf depan, nama lengkap muncul di tooltip. */}
            {collapsed ? item[0] : item}
          </span>
        ))}
      </nav>
    </aside>
  );
}
