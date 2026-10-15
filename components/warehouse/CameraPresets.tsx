"use client";

import { warehouseLayout } from "@/data/warehouse";
import { getAreaFocus, getOverviewFocus } from "@/lib/camera";
import { useWarehouseStore } from "@/store/warehouseStore";

const presets = [
  { label: "Overview", focus: getOverviewFocus() },
  ...warehouseLayout.areas.map((area) => ({
    label: area.name.replace(" Area", ""),
    focus: getAreaFocus(area),
  })),
];

/** Tombol pindah kamera cepat ke seluruh gudang atau ke salah satu area. */
export default function CameraPresets() {
  const focusCamera = useWarehouseStore((s) => s.focusCamera);
  const showUpperFloor = useWarehouseStore((s) => s.showUpperFloor);
  const toggleUpperFloor = useWarehouseStore((s) => s.toggleUpperFloor);

  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-lg border border-slate-200 bg-white/90 p-1 text-xs shadow-sm backdrop-blur">
      {presets.map((preset) => (
        <button
          key={preset.label}
          type="button"
          onClick={() => focusCamera(preset.focus)}
          className="rounded-md px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          {preset.label}
        </button>
      ))}
      <span className="mx-0.5 w-px bg-slate-200" />
      {/* Sembunyikan kantor mezzanine kalau menghalangi area di bawah/di belakangnya. */}
      <button
        type="button"
        onClick={toggleUpperFloor}
        aria-pressed={showUpperFloor}
        className={`rounded-md px-2.5 py-1 font-medium ${
          showUpperFloor ? "bg-slate-800 text-white hover:bg-slate-700" : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        Lt. 2
      </button>
    </div>
  );
}
