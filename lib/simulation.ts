import type { WarehouseState } from "@/store/warehouseStore";
import {
  MAX_PICK_QUANTITY,
  MAX_RETURN_QUANTITY,
  MAX_SAMEDAY_QUANTITY,
  PALLET_CAPACITY,
  floorSlotById,
  locationById,
  locations,
  products,
  stagingLocations,
  warehouseLayout,
} from "@/data/warehouse";
import { getAvailableQuantity, getStockByLocation } from "./warehouse";
import { getIncomingByLocation, isActiveMovement } from "./movement";

// ---------------------------------------------------------------------------
// Auto simulation: tiap tick memicu aksi yang biasanya diklik user (receive, putaway, pick, load,
// berangkatkan truk, retur, unboxing). Tahap selanjutnya (forklift, picker, checker, truk, Gojek)
// sudah berjalan sendiri lewat animasi di scene.
// ---------------------------------------------------------------------------

export type SimulationIntensity = "LOW" | "NORMAL" | "HIGH";

export const SIMULATION_INTENSITIES: Record<SimulationIntensity, { label: string; tickMs: number; maxOrders: number }> = {
  LOW: { label: "Sepi", tickMs: 8000, maxOrders: 1 },
  NORMAL: { label: "Normal", tickMs: 5000, maxOrders: 2 },
  HIGH: { label: "Sibuk", tickMs: 2500, maxOrders: 3 },
};

/** Inbound hanya dibuat selama occupancy rack di bawah ini, supaya gudang tidak penuh. */
const INBOUND_MAX_OCCUPANCY = 0.65;
/** Movement aktif maksimum, supaya antrean forklift tidak menumpuk. */
const MAX_ACTIVE_MOVEMENTS = 2;
/** Inbound aktif maksimum (truk menuju / sedang dibongkar). */
const MAX_ACTIVE_INBOUND = 2;
/** Truk outbound diberangkatkan begitu muatannya sebanyak ini, walau belum penuh. */
const DISPATCH_MIN_PALLETS = 3;
/** Peluang order pick dikirim sameday (Gojek), bukan lewat truk. */
const SAMEDAY_CHANCE = 0.3;

const rackCapacity = locations.reduce((total, l) => total + l.capacity, 0);

const randomInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const randomItem = <T>(items: T[]): T | undefined => items[Math.floor(Math.random() * items.length)];

/** Pilih satu entri secara acak sesuai bobotnya. */
function weightedPick<T>(entries: [T, number][]): T | undefined {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let r = Math.random() * total;
  for (const [value, weight] of entries) {
    if ((r -= weight) < 0) return value;
  }
  return undefined;
}

/** Location rack yang sedang dipakai let-down (pallet dikunci). */
const getLetDownLocationIds = (state: WarehouseState) =>
  new Set(state.letDowns.filter((l) => l.status !== "DONE").map((l) => l.locationId));

/**
 * Satu tick simulasi. Mengembalikan deskripsi singkat aksi yang dilakukan (untuk ditampilkan),
 * kosong kalau tidak ada yang bisa dilakukan.
 */
export function runSimulationTick(state: () => WarehouseState, intensity: SimulationIntensity): string[] {
  const log: string[] = [];

  // Lanjutan alur yang menunggu "klik user": selalu dikerjakan dulu supaya pipeline tidak macet.
  const unboxed = startArrivedUnboxing(state());
  if (unboxed) log.push(unboxed);
  log.push(...shipCheckedPallets(state()));
  log.push(...dispatchTrucks(state()));
  const putaway = putawayOnePallet(state());
  if (putaway) log.push(putaway);

  // Permintaan baru: satu per tick, dipilih acak.
  const demand = weightedPick<() => string | null>([
    [() => createPickOrder(state(), intensity), 5],
    [() => createInbound(state()), 3],
    [() => createReturnOrder(state()), 1],
  ]);
  const created = demand?.();
  if (created) log.push(created);

  return log;
}

function startArrivedUnboxing(state: WarehouseState): string | null {
  const order = state.returnOrders.find((r) => r.status === "ARRIVED");
  if (!order) return null;
  state.startUnboxing(order.id);
  return `Unboxing retur ${order.id}`;
}

/** Pallet di Shipping yang sudah dicek dan belum diantrekan langsung dimuat ke truk. */
function shipCheckedPallets(state: WarehouseState): string[] {
  const queued = new Set(state.outboundTasks.map((t) => t.inventoryId));
  return state.shippingChecks
    .filter((c) => c.status === "CHECKED" && !queued.has(c.inventoryId))
    .filter((c) => state.inventory.some((i) => i.id === c.inventoryId))
    .map((c) => {
      state.shipPallet(c.inventoryId);
      return `Load ${floorSlotById.get(c.slotId)?.code ?? c.slotId} ke truk`;
    });
}

/**
 * Berangkatkan truk outbound kalau muatannya sudah cukup, atau kalau tidak ada lagi pallet
 * yang sedang menuju truk itu (supaya muatan tidak menunggu selamanya).
 */
function dispatchTrucks(state: WarehouseState): string[] {
  const shippingPipelineBusy =
    state.packingOrders.some((o) => o.status !== "CLOSED" && o.destination.kind === "SHIPPING") ||
    state.inventory.some((i) => floorSlotById.get(i.locationId)?.type === "SHIPPING");

  return warehouseLayout.docks
    .filter((d) => d.direction === "OUTBOUND" && !state.dispatchingDockIds.includes(d.id))
    .flatMap((dock) => {
      const tasks = state.outboundTasks.filter((t) => t.dockId === dock.id);
      const loaded = tasks.filter((t) => t.status === "LOADED").length;
      const loading = tasks.some((t) => t.status === "QUEUED" || t.status === "LOADING");
      if (loaded === 0 || loading) return [];
      if (loaded < DISPATCH_MIN_PALLETS && shippingPipelineBusy) return [];
      state.dispatchTruck(dock.id);
      return [`Truk ${dock.code} berangkat (${loaded} pallet)`];
    });
}

/** Putaway satu pallet dari staging Receiving / slot Return ke location rack yang kosong. */
function putawayOnePallet(state: WarehouseState): string | null {
  // Jangan ganggu user yang sedang memilih tujuan movement.
  if (state.movingInventoryId) return null;
  if (state.movements.filter(isActiveMovement).length >= MAX_ACTIVE_MOVEMENTS) return null;

  const moving = new Set(state.movements.filter(isActiveMovement).map((m) => m.inventoryId));
  const item = state.inventory.find((i) => {
    const type = floorSlotById.get(i.locationId)?.type;
    return (type === "STAGING" || type === "RETURN") && !moving.has(i.id);
  });
  if (!item) return null;

  // Satu pallet per location: pilih location rack yang benar-benar kosong, utamakan level bawah.
  const stock = getStockByLocation(state.inventory);
  const incoming = getIncomingByLocation(state.movements);
  const letDownIds = getLetDownLocationIds(state);
  const empty = locations.filter(
    (l) => !stock.has(l.id) && !incoming.has(l.id) && !letDownIds.has(l.id) && l.capacity >= item.quantity,
  );
  const lowestLevel = Math.min(...empty.map((l) => l.level));
  const target = randomItem(empty.filter((l) => l.level === lowestLevel));
  if (!target) return null;

  state.queueMovement(item.id, target.id);
  return `Putaway ${item.sku} → ${target.code}`;
}

function createInbound(state: WarehouseState): string | null {
  const active = state.inboundTasks.filter((t) => t.status !== "RECEIVED").length;
  if (active >= MAX_ACTIVE_INBOUND) return null;

  const stock = getStockByLocation(state.inventory);
  let rackStock = 0;
  for (const [id, quantity] of stock) if (locationById.has(id)) rackStock += quantity;
  if (rackStock / rackCapacity >= INBOUND_MAX_OCCUPANCY) return null;

  // Staging yang masih terisi pallet lama: tunggu putaway dulu.
  const stagingFull = stagingLocations.every((s) => stock.has(s.id));
  if (stagingFull) return null;

  const product = randomItem(products)!;
  const quantity = randomInt(6, PALLET_CAPACITY / 10) * 10;
  const task = state.receiveInbound(product.sku, quantity);
  return task ? `Inbound ${product.sku} · ${quantity} PCS` : null;
}

function createPickOrder(state: WarehouseState, intensity: SimulationIntensity): string | null {
  const activeOrders = state.packingOrders.filter((o) => o.status !== "CLOSED" && o.status !== "AT_COUNTER").length;
  if (activeOrders >= SIMULATION_INTENSITIES[intensity].maxOrders) return null;

  // Pallet yang sedang dipindah, menunggu dipindah, atau masih diambil order lain tidak boleh di-pick.
  const moving = new Set(state.movements.filter(isActiveMovement).map((m) => m.inventoryId));
  const picking = new Set(
    state.packingOrders.filter((o) => o.status === "QUEUED" || o.status === "PICKING").map((o) => o.sourceInventoryId),
  );
  const letDownIds = getLetDownLocationIds(state);
  const candidates = state.inventory.filter(
    (i) =>
      locationById.has(i.locationId) &&
      getAvailableQuantity(i) > 0 &&
      !moving.has(i.id) &&
      !picking.has(i.id) &&
      !letDownIds.has(i.locationId) &&
      i.id !== state.movingInventoryId,
  );
  const item = randomItem(candidates);
  if (!item) return null;

  const sameday = Math.random() < SAMEDAY_CHANCE;
  const max = Math.min(getAvailableQuantity(item), sameday ? MAX_SAMEDAY_QUANTITY : Math.min(MAX_PICK_QUANTITY, 12));
  const quantity = randomInt(1, max);
  // Kalau tujuan yang dipilih penuh, coba tujuan lainnya.
  const ok =
    state.createPackingOrder(item.id, quantity, sameday) ||
    state.createPackingOrder(item.id, Math.min(quantity, MAX_SAMEDAY_QUANTITY), !sameday);
  if (!ok) return null;
  const code = locationById.get(item.locationId)?.code;
  return `Order pick ${item.sku} · ${quantity} PCS dari ${code}`;
}

function createReturnOrder(state: WarehouseState): string | null {
  const product = randomItem(products)!;
  const quantity = randomInt(3, Math.min(10, MAX_RETURN_QUANTITY));
  const damaged = randomInt(0, Math.min(2, quantity));
  return state.createReturn(product.sku, quantity, damaged) ? `Retur ${product.sku} · ${quantity} paket` : null;
}
