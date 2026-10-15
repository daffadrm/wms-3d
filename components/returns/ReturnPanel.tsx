"use client";

import { useState, type FormEvent } from "react";
import type { ReturnStatus } from "@/types/warehouse";
import { MAX_RETURN_QUANTITY, dockById, productBySku, products, returnSlots } from "@/data/warehouse";
import { useStockByLocation, useWarehouseStore } from "@/store/warehouseStore";

const STATUS_LABELS: Record<ReturnStatus, string> = {
  QUEUED: "Truk retur menuju dock",
  UNLOADING: "Pallet retur dibongkar",
  ARRIVED: "Pallet retur di Return Area",
  UNBOXING: "Dibuka & diperiksa per paket",
  DONE: "Selesai",
};

/** Form retur customer + status unboxing. Satu retur diproses dalam satu waktu. */
export default function ReturnPanel() {
  const returnOrders = useWarehouseStore((s) => s.returnOrders);
  const createReturn = useWarehouseStore((s) => s.createReturn);
  const startUnboxing = useWarehouseStore((s) => s.startUnboxing);
  const stockByLocation = useStockByLocation();

  const [sku, setSku] = useState(products[0].sku);
  const [quantity, setQuantity] = useState(5);
  const [damaged, setDamaged] = useState(1);

  const active = returnOrders.find((r) => r.status !== "DONE");
  const goodWaiting = stockByLocation.get(returnSlots[0].id) ?? 0;
  const totalDamaged = returnOrders.reduce((total, r) => total + r.damagedQuantity, 0);
  const isValid =
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= MAX_RETURN_QUANTITY &&
    Number.isInteger(damaged) &&
    damaged >= 0 &&
    damaged <= quantity;
  const blockedReason = active
    ? "Retur sebelumnya masih diproses"
    : goodWaiting > 0
      ? `Putaway dulu ${goodWaiting} PCS di ${returnSlots[0].code}`
      : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isValid && !blockedReason) createReturn(sku, quantity, damaged);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-xs shadow-sm backdrop-blur"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold text-slate-700">Return</p>
        <span className="text-slate-500">Karantina {totalDamaged} PCS</span>
      </div>

      {active ? (
        <div className="flex flex-col gap-1.5">
          <p className="font-medium text-slate-800">
            {active.id} · {productBySku.get(active.sku)?.name ?? active.sku}
          </p>
          <p className="text-slate-500">
            {active.quantity} paket · dock {dockById.get(active.dockId)?.code} · {STATUS_LABELS[active.status]}
          </p>
          {active.status === "UNBOXING" && (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-rose-500"
                  style={{ width: `${(active.unboxedQuantity / active.quantity) * 100}%` }}
                />
              </div>
              <p className="text-slate-600 tabular-nums">
                Dibuka {active.unboxedQuantity}/{active.quantity} · bagus {active.goodQuantity} · rusak{" "}
                {active.damagedQuantity}
              </p>
            </>
          )}
          {active.status === "ARRIVED" && (
            <button
              type="button"
              onClick={() => startUnboxing(active.id)}
              className="mt-1 rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
            >
              Mulai Unboxing
            </button>
          )}
        </div>
      ) : (
        <>
          <label className="mb-1 block text-slate-500" htmlFor="return-sku">
            Product
          </label>
          <select
            id="return-sku"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className="mb-2 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-rose-500"
          >
            {products.map((p) => (
              <option key={p.sku} value={p.sku}>
                {p.sku} · {p.name}
              </option>
            ))}
          </select>
          <div className="mb-3 flex gap-2">
            <label className="flex-1 text-slate-500">
              Paket (maks {MAX_RETURN_QUANTITY})
              <input
                type="number"
                min={1}
                max={MAX_RETURN_QUANTITY}
                value={Number.isNaN(quantity) ? "" : quantity}
                onChange={(e) => setQuantity(e.target.valueAsNumber)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-rose-500"
              />
            </label>
            <label className="flex-1 text-slate-500">
              Rusak
              <input
                type="number"
                min={0}
                max={Number.isNaN(quantity) ? MAX_RETURN_QUANTITY : quantity}
                value={Number.isNaN(damaged) ? "" : damaged}
                onChange={(e) => setDamaged(e.target.valueAsNumber)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-rose-500"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={!isValid || blockedReason !== null}
            className="w-full rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-500"
          >
            Terima Return
          </button>
          {blockedReason && <p className="mt-2 text-amber-700">{blockedReason}</p>}
        </>
      )}
    </form>
  );
}
