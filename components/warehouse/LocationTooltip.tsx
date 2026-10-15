"use client";

import { useEffect, useRef } from "react";
import type { FloorSlotType } from "@/types/warehouse";
import { floorSlotById, locationById } from "@/data/warehouse";
import { STATUS_COLORS, STATUS_LABELS, getLocationStatus, getOccupancy } from "@/lib/warehouse";
import { canReceive, getFreeCapacity } from "@/lib/movement";
import {
  useIncomingByLocation,
  useInventoryByLocation,
  useMovingInventory,
  useActiveOrderByStation,
  useStockByLocation,
  useWarehouseStore,
} from "@/store/warehouseStore";

const CURSOR_OFFSET = 16;

const FLOOR_SLOT_LABELS: Record<FloorSlotType, string> = {
  STAGING: "Receiving staging",
  PACKING: "Packing station",
  SHIPPING: "Shipping",
  RETURN: "Return (barang bagus)",
};

export default function LocationTooltip() {
  const hoveredLocationId = useWarehouseStore((s) => s.hoveredLocationId);
  const stockByLocation = useStockByLocation();
  const inventoryByLocation = useInventoryByLocation();
  const incomingByLocation = useIncomingByLocation();
  const movingItem = useMovingInventory();
  const activeOrderByStation = useActiveOrderByStation();
  const ref = useRef<HTMLDivElement>(null);

  // Posisi diupdate langsung ke DOM, bukan lewat state, supaya tidak re-render tiap gerakan mouse.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (ref.current) {
        ref.current.style.transform = `translate(${e.clientX + CURSOR_OFFSET}px, ${e.clientY + CURSOR_OFFSET}px)`;
      }
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const location = hoveredLocationId ? locationById.get(hoveredLocationId) : undefined;
  const floorSlot = hoveredLocationId ? floorSlotById.get(hoveredLocationId) : undefined;

  return (
    <div
      ref={ref}
      className={`pointer-events-none fixed top-0 left-0 z-50 rounded-md bg-slate-900/90 px-3 py-2 text-xs text-white shadow-lg ${
        location || floorSlot ? "" : "hidden"
      }`}
    >
      {floorSlot && (
        <>
          <p className="font-semibold">{floorSlot.code}</p>
          <p className="mt-0.5 text-slate-300">
            {FLOOR_SLOT_LABELS[floorSlot.type]}
          </p>
          {floorSlot.type === "PACKING"
            ? (() => {
                const order = activeOrderByStation.get(floorSlot.id);
                return (
                  order && (
                    <p className="text-slate-400">
                      {order.sku} · {order.packedQuantity}/{order.quantity} PCS dikemas
                    </p>
                  )
                );
              })()
            : inventoryByLocation.get(floorSlot.id)?.map((item) => (
                <p key={item.id} className="text-slate-400">
                  {item.sku} · {item.quantity} PCS
                </p>
              ))}
        </>
      )}
      {location &&
        (() => {
          const stock = stockByLocation.get(location.id) ?? 0;
          const incoming = incomingByLocation.get(location.id) ?? 0;
          const status = getLocationStatus(stock, location.capacity);
          const skuCount = inventoryByLocation.get(location.id)?.length ?? 0;
          return (
            <>
              <p className="font-semibold">{location.code}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-slate-300">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] }} />
                {STATUS_LABELS[status]} · {Math.round(getOccupancy(stock, location.capacity))}%
              </p>
              <p className="text-slate-400">
                {stock} / {location.capacity} PCS · {skuCount} SKU
              </p>
              {movingItem && (
                <p
                  className={`mt-1 font-medium ${
                    canReceive(location, movingItem, stock, incoming) ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {location.id === movingItem.locationId
                    ? "Location asal"
                    : canReceive(location, movingItem, stock, incoming)
                      ? `Klik untuk pindahkan ke sini`
                      : `Kapasitas tidak cukup (sisa ${getFreeCapacity(location, stock, incoming)} PCS)`}
                </p>
              )}
            </>
          );
        })()}
    </div>
  );
}
