"use client";

import type { MovementStatus } from "@/types/warehouse";
import { getLocationCode } from "@/data/warehouse";
import { MOVEMENT_STATUS_LABELS, MOVEMENT_TYPE_LABELS } from "@/lib/movement";
import { useWarehouseStore } from "@/store/warehouseStore";

const STATUS_STYLES: Record<MovementStatus, string> = {
  PENDING: "bg-slate-100 text-slate-600",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-700",
};

const MAX_ROWS = 5;

/** Daftar movement terbaru di pojok kanan bawah scene. */
export default function MovementPanel() {
  const movements = useWarehouseStore((s) => s.movements);
  const recent = movements.slice(-MAX_ROWS).reverse();

  return (
    <div className="absolute right-4 bottom-4 w-80 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-xs shadow-sm backdrop-blur">
      <p className="mb-2 font-semibold text-slate-700">Movements</p>
      {recent.length === 0 ? (
        <p className="text-slate-500">Belum ada movement. Klik location → Move → klik location tujuan.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {recent.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">
                  <span className="mr-1 text-slate-400">{MOVEMENT_TYPE_LABELS[m.type]}</span>
                  {getLocationCode(m.fromLocationId)} → {getLocationCode(m.toLocationId)}
                </p>
                <p className="truncate text-slate-500">
                  {m.id} · {m.sku} · {m.quantity} PCS
                </p>
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 font-medium ${STATUS_STYLES[m.status]}`}>
                {MOVEMENT_STATUS_LABELS[m.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
