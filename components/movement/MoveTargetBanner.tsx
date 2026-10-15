"use client";

import { getLocationCode, stagingById } from "@/data/warehouse";
import { useMovingInventory, useWarehouseStore } from "@/store/warehouseStore";

/** Petunjuk di atas scene selama mode "pilih tujuan movement". */
export default function MoveTargetBanner() {
  const item = useMovingInventory();
  const cancelMove = useWarehouseStore((s) => s.cancelMove);
  if (!item) return null;

  return (
    <div className="absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white shadow-lg">
      <span>
        {stagingById.has(item.locationId) ? "Putaway" : "Pindahkan"} <b>{item.sku}</b> ({item.quantity}{" "}
        PCS) dari <b>{getLocationCode(item.locationId)}</b> — klik location tujuan di rack
      </span>
      <button
        type="button"
        onClick={cancelMove}
        className="rounded bg-white/20 px-2 py-0.5 text-xs font-medium hover:bg-white/30"
      >
        Batal (Esc)
      </button>
    </div>
  );
}
