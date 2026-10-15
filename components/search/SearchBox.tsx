"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import type { FloorSlotType } from "@/types/warehouse";
import { floorSlots, locations, products, rackById } from "@/data/warehouse";
import { getFitFocus, getLocationFocus } from "@/lib/camera";
import { useInventoryByLocation, useWarehouseStore } from "@/store/warehouseStore";

const MAX_PER_GROUP = 5;

const FLOOR_SLOT_LABELS: Record<FloorSlotType, string> = {
  STAGING: "Receiving staging",
  PACKING: "Packing station",
  SHIPPING: "Shipping",
  RETURN: "Return (barang bagus)",
};

type Result =
  | { kind: "location"; id: string; code: string; detail: string }
  | { kind: "sku"; sku: string; name: string; locationIds: string[]; quantity: number };

const resultKey = (r: Result) => (r.kind === "location" ? `loc-${r.id}` : `sku-${r.sku}`);

/**
 * Cari SKU, nama produk, atau kode location. Memilih location → location dipilih + kamera terbang ke sana.
 * Memilih SKU → semua location berisi SKU itu disorot + kamera menyesuaikan supaya semuanya terlihat.
 */
export default function SearchBox() {
  const inventory = useWarehouseStore((s) => s.inventory);
  const highlightedCount = useWarehouseStore((s) => s.highlightedLocationIds.length);
  const selectLocation = useWarehouseStore((s) => s.selectLocation);
  const highlightLocations = useWarehouseStore((s) => s.highlightLocations);
  const focusCamera = useWarehouseStore((s) => s.focusCamera);
  const inventoryByLocation = useInventoryByLocation();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    // Location rack & slot lantai yang kodenya cocok.
    const locationResults: Result[] = [
      ...locations
        .filter((l) => l.code.toLowerCase().includes(q))
        .map((l): Result => {
          const stock = (inventoryByLocation.get(l.id) ?? []).reduce((total, i) => total + i.quantity, 0);
          return {
            kind: "location",
            id: l.id,
            code: l.code,
            detail: `Rack ${rackById.get(l.rackId)?.code} · Level ${l.level} · ${stock}/${l.capacity} PCS`,
          };
        }),
      ...floorSlots
        .filter((s) => s.code.toLowerCase().includes(q))
        .map((s): Result => ({ kind: "location", id: s.id, code: s.code, detail: FLOOR_SLOT_LABELS[s.type] })),
    ].slice(0, MAX_PER_GROUP);

    // SKU / nama produk yang cocok, beserta location yang menyimpannya.
    const skuResults: Result[] = products
      .filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .map((p): Result => {
        const items = inventory.filter((i) => i.sku === p.sku);
        return {
          kind: "sku",
          sku: p.sku,
          name: p.name,
          locationIds: [...new Set(items.map((i) => i.locationId))],
          quantity: items.reduce((total, i) => total + i.quantity, 0),
        };
      })
      .slice(0, MAX_PER_GROUP);

    return [...skuResults, ...locationResults];
  }, [query, inventory, inventoryByLocation]);

  const choose = (result: Result) => {
    if (result.kind === "location") {
      selectLocation(result.id);
      highlightLocations([result.id]);
      const focus = getLocationFocus(result.id);
      if (focus) focusCamera(focus);
      setQuery(result.code);
    } else {
      selectLocation(null);
      highlightLocations(result.locationIds);
      const focus = getFitFocus(result.locationIds);
      if (focus) focusCamera(focus);
      setQuery(result.sku);
    }
    setOpen(false);
  };

  const clear = () => {
    setQuery("");
    highlightLocations([]);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      if (open) setOpen(false);
      else clear();
    }
  };

  return (
    <div className="relative w-72">
      <input
        type="search"
        value={query}
        placeholder="Cari SKU, produk, atau location…"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-slate-300 py-1.5 pr-24 pl-3 text-sm outline-none focus:border-blue-500"
      />
      {highlightedCount > 0 && (
        <button
          type="button"
          onClick={clear}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded bg-fuchsia-100 px-2 py-0.5 text-xs font-medium text-fuchsia-700 hover:bg-fuchsia-200"
          title="Hapus sorotan"
        >
          {highlightedCount} lokasi ✕
        </button>
      )}

      {open && query.trim() && (
        <ul className="absolute top-full right-0 left-0 z-50 mt-1 max-h-96 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-slate-500">Tidak ditemukan</li>
          ) : (
            results.map((r, i) => (
              <li key={resultKey(r)}>
                <button
                  type="button"
                  // mousedown supaya terpilih sebelum input kehilangan fokus (onBlur menutup dropdown).
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(r);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left ${
                    i === active ? "bg-slate-100" : ""
                  }`}
                >
                  {r.kind === "sku" ? (
                    <>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">{r.name}</span>
                        <span className="text-xs text-slate-500">
                          {r.sku} · {r.quantity} PCS
                        </span>
                      </span>
                      <span className="shrink-0 rounded bg-fuchsia-50 px-1.5 py-0.5 text-xs text-fuchsia-700">
                        {r.locationIds.length} lokasi
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-900">{r.code}</span>
                        <span className="block truncate text-xs text-slate-500">{r.detail}</span>
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">Location</span>
                    </>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
