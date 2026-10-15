"use client";

import type { OutboundStatus } from "@/types/warehouse";
import { TRUCK_PALLET_CAPACITY, dockById, getLocationCode, warehouseLayout } from "@/data/warehouse";
import { useWarehouseStore } from "@/store/warehouseStore";

const STATUS_LABELS: Record<OutboundStatus, string> = {
  QUEUED: "Antre",
  LOADING: "Dimuat",
  LOADED: "Di truk",
  SHIPPED: "Terkirim",
};

const STATUS_STYLES: Record<OutboundStatus, string> = {
  QUEUED: "bg-slate-100 text-slate-600",
  LOADING: "bg-purple-100 text-purple-700",
  LOADED: "bg-blue-100 text-blue-700",
  SHIPPED: "bg-green-100 text-green-700",
};

const outboundDocks = warehouseLayout.docks.filter((d) => d.direction === "OUTBOUND");

/** Ringkasan pengiriman: muatan truk per dock outbound, antrean muat, dan total terkirim. */
export default function OutboundPanel() {
  const outboundTasks = useWarehouseStore((s) => s.outboundTasks);
  const dispatchingDockIds = useWarehouseStore((s) => s.dispatchingDockIds);
  const dispatchTruck = useWarehouseStore((s) => s.dispatchTruck);
  const packingOrders = useWarehouseStore((s) => s.packingOrders);

  const shipped = outboundTasks.filter((t) => t.status === "SHIPPED");
  const active = outboundTasks.filter((t) => t.status !== "SHIPPED");
  const samedayOrders = packingOrders.filter((o) => o.destination.kind === "SAMEDAY");
  const atCounter = samedayOrders.filter((o) => o.status === "AT_COUNTER").length;
  const pickedUp = samedayOrders.filter((o) => o.status === "CLOSED").length;

  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-xs shadow-sm backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-slate-700">Outbound</p>
        <span className="text-slate-500 tabular-nums">
          Terkirim {shipped.length} pallet · {shipped.reduce((total, t) => total + t.quantity, 0)} PCS
        </span>
      </div>

      {outboundDocks.map((dock) => {
        const loaded = active.filter((t) => t.dockId === dock.id && t.status === "LOADED").length;
        const isDispatching = dispatchingDockIds.includes(dock.id);
        return (
          <div key={dock.id} className="mt-2 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-slate-600">
                Truk {dock.code} · <span className="font-medium tabular-nums">{loaded}</span>/{TRUCK_PALLET_CAPACITY}{" "}
                pallet
              </p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-purple-500"
                  style={{ width: `${(loaded / TRUCK_PALLET_CAPACITY) * 100}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              disabled={loaded === 0 || isDispatching}
              onClick={() => dispatchTruck(dock.id)}
              className="shrink-0 rounded-md bg-purple-600 px-2 py-1 font-medium text-white hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-500"
            >
              {isDispatching ? "Berangkat…" : "Berangkatkan"}
            </button>
          </div>
        );
      })}

      <p className="mt-2 flex items-center justify-between text-slate-600">
        <span>
          <span className="font-medium text-green-700">Sameday</span> · menunggu Gojek{" "}
          <span className="font-medium tabular-nums">{atCounter}</span>
        </span>
        <span className="text-slate-500 tabular-nums">Diambil {pickedUp} order</span>
      </p>

      {active.length === 0 ? (
        <p className="mt-2 text-slate-500">Pack → conveyor ke Shipping → cek pallet → Load ke Truk.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5 border-t border-slate-200 pt-2">
          {active.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-slate-600">
                {getLocationCode(t.slotId)} → {dockById.get(t.dockId)?.code} · {t.sku} · {t.quantity}
              </span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${STATUS_STYLES[t.status]}`}>
                {STATUS_LABELS[t.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
