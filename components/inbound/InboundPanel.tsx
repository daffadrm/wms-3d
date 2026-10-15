"use client";

import { useState, type FormEvent } from "react";
import type { InboundStatus } from "@/types/warehouse";
import { PALLET_CAPACITY, dockById, getLocationCode, products, stagingLocations } from "@/data/warehouse";
import { useUsedStagingIds, useWarehouseStore } from "@/store/warehouseStore";

const STATUS_LABELS: Record<InboundStatus, string> = {
  QUEUED: "Antre",
  UNLOADING: "Dibongkar",
  RECEIVED: "Diterima",
};

/** Form penerimaan barang: satu submit = satu pallet datang lewat truk ke dock terdekat. */
export default function InboundPanel() {
  const receiveInbound = useWarehouseStore((s) => s.receiveInbound);
  const inboundTasks = useWarehouseStore((s) => s.inboundTasks);
  const usedStagingIds = useUsedStagingIds();

  const [sku, setSku] = useState(products[0].sku);
  const [quantity, setQuantity] = useState(100);
  const [error, setError] = useState<string | null>(null);

  const isFull = usedStagingIds.size >= stagingLocations.length;
  const isQuantityValid = Number.isInteger(quantity) && quantity >= 1 && quantity <= PALLET_CAPACITY;
  const activeTasks = inboundTasks.filter((t) => t.status !== "RECEIVED");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isQuantityValid) return;
    const task = receiveInbound(sku, quantity);
    setError(task ? null : "Semua slot staging terpakai. Putaway dulu pallet yang ada.");
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-xs shadow-sm backdrop-blur"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold text-slate-700">Inbound</p>
        <span className={`tabular-nums ${isFull ? "font-medium text-red-600" : "text-slate-500"}`}>
          Staging {usedStagingIds.size}/{stagingLocations.length}
        </span>
      </div>

      <label className="mb-1 block text-slate-500" htmlFor="inbound-sku">
        Product
      </label>
      <select
        id="inbound-sku"
        value={sku}
        onChange={(e) => setSku(e.target.value)}
        className="mb-2 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500"
      >
        {products.map((p) => (
          <option key={p.sku} value={p.sku}>
            {p.sku} · {p.name}
          </option>
        ))}
      </select>

      <label className="mb-1 block text-slate-500" htmlFor="inbound-qty">
        Quantity (maks {PALLET_CAPACITY} PCS / pallet)
      </label>
      <input
        id="inbound-qty"
        type="number"
        min={1}
        max={PALLET_CAPACITY}
        value={Number.isNaN(quantity) ? "" : quantity}
        onChange={(e) => setQuantity(e.target.valueAsNumber)}
        className="mb-3 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-blue-500"
      />

      <button
        type="submit"
        disabled={!isQuantityValid || isFull}
        className="w-full rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:bg-slate-200 disabled:text-slate-500"
      >
        Receive
      </button>

      {error && <p className="mt-2 text-red-600">{error}</p>}

      {activeTasks.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-slate-200 pt-2">
          {activeTasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-slate-600">
                {dockById.get(t.dockId)?.code} → {getLocationCode(t.stagingId)} · {t.sku} · {t.quantity}
              </span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${
                  t.status === "UNLOADING" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                }`}
              >
                {STATUS_LABELS[t.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
