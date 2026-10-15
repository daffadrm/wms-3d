"use client";

import { locations } from "@/data/warehouse";
import { LOCATION_STATUSES, STATUS_COLORS, STATUS_LABELS, getLocationStatus } from "@/lib/warehouse";
import { useStockByLocation } from "@/store/warehouseStore";

export default function StatusLegend() {
  const stockByLocation = useStockByLocation();
  const counts = Object.fromEntries(LOCATION_STATUSES.map((status) => [status, 0]));
  for (const location of locations) {
    counts[getLocationStatus(stockByLocation.get(location.id) ?? 0, location.capacity)]++;
  }

  return (
    <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-slate-200 bg-white/90 px-4 py-3 text-xs shadow-sm backdrop-blur">
      <p className="mb-2 font-semibold text-slate-700">Location Status</p>
      <ul className="flex flex-col gap-1.5">
        {LOCATION_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-2 text-slate-600">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: STATUS_COLORS[status] }} />
            <span className="w-20">{STATUS_LABELS[status]}</span>
            <span className="ml-auto font-medium tabular-nums text-slate-800">{counts[status]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
