import { useMemo } from "react";
import { create } from "zustand";
import type {
  FloorSlot,
  InboundTask,
  Inventory,
  InventoryMovement,
  LetDownStatus,
  LetDownTask,
  MovementStatus,
  OutboundTask,
  PackingDestination,
  PackingOrder,
  ReturnOrder,
  ShippingCheck,
} from "@/types/warehouse";
import {
  LET_DOWN_MIN_LEVEL,
  MAX_PICK_QUANTITY,
  MAX_RETURN_QUANTITY,
  MAX_SAMEDAY_QUANTITY,
  SAMEDAY_COUNTER_SLOTS,
  locationById,
  returnSlots,
  warehouseLayout,
  floorSlotById,
  getNearestDock,
  inventory as initialInventory,
  packingStations,
  shippingSlots,
  stagingById,
  stagingLocations,
} from "@/data/warehouse";
import { getAvailableQuantity, getStockByLocation, groupBy } from "@/lib/warehouse";
import { getIncomingByLocation, isActiveMovement } from "@/lib/movement";
import type { CameraFocus } from "@/lib/camera";
import { isReturnPieceDamaged } from "@/lib/returns";

interface WarehouseState {
  inventory: Inventory[];
  movements: InventoryMovement[];
  inboundTasks: InboundTask[];
  packingOrders: PackingOrder[];
  outboundTasks: OutboundTask[];
  /** Dock outbound yang truknya sudah diminta berangkat. */
  dispatchingDockIds: string[];
  returnOrders: ReturnOrder[];
  /** Tugas let-down forklift untuk pick dari rack level atas. */
  letDowns: LetDownTask[];

  /** Ubah status let-down (dipanggil forklift & picker sesuai tahapnya). */
  setLetDownStatus: (letDownId: string, status: LetDownStatus) => void;

  /**
   * Daftarkan retur: `quantity` paket SKU ini datang lewat truk ke dock retur, `damaged` di antaranya
   * akan ditemukan rusak. Gagal (false) kalau masih ada retur aktif atau slot barang bagus belum kosong.
   */
  createReturn: (sku: string, quantity: number, damaged: number) => boolean;
  startReturnUnloading: (returnId: string) => void;
  /** Pallet paket retur sampai di Return Area. */
  arriveReturn: (returnId: string) => void;
  startUnboxing: (returnId: string) => void;
  /** Satu paket selesai dibuka & diperiksa. Paket terakhir membuat inventory barang bagus di slot RETURN. */
  unboxOne: (returnId: string) => void;

  selectedLocationId: string | null;
  hoveredLocationId: string | null;
  /** Inventory yang sedang dipilihkan lokasi tujuannya (mode "pilih tujuan"). */
  movingInventoryId: string | null;

  /** Location yang disorot hasil search (mis. semua location berisi satu SKU). */
  highlightedLocationIds: string[];
  /** Permintaan pindah kamera; `id` naik tiap permintaan supaya fokus yang sama bisa diulang. */
  cameraFocus: (CameraFocus & { id: number }) | null;
  highlightLocations: (ids: string[]) => void;
  focusCamera: (focus: CameraFocus) => void;
  /** Tampilkan kantor mezzanine (lantai 2); bisa disembunyikan supaya tidak menghalangi pandangan. */
  showUpperFloor: boolean;
  toggleUpperFloor: () => void;

  selectLocation: (id: string | null) => void;
  hoverLocation: (id: string) => void;
  /** Hanya menghapus hover kalau `id` masih yang sedang di-hover. */
  unhoverLocation: (id: string) => void;

  /**
   * Daftarkan satu pallet inbound: pesan slot staging kosong pertama dan antrekan ke dock terdekat.
   * Mengembalikan task-nya, atau null kalau semua slot staging terpakai/dipesan.
   */
  receiveInbound: (sku: string, quantity: number) => InboundTask | null;
  /** Pallet mulai dibawa dari truk ke staging. */
  startUnloading: (taskId: string) => void;
  /** Pallet sampai di staging: jadi inventory di slot staging. */
  completeInbound: (taskId: string) => void;

  /**
   * Buat order pick & pack `quantity` PCS dari inventory rack ke packing station kosong pertama,
   * sekaligus memesan tujuan conveyor: slot Shipping, atau (`sameday`) tumpukan di meja loket Sameday.
   * Quantity langsung di-reserve. False kalau station / tujuan penuh atau stok available tidak cukup.
   */
  createPackingOrder: (inventoryId: string, quantity: number, sameday?: boolean) => boolean;
  /** Picker (orang inventory) mulai mengerjakan order: berangkat ke rack. */
  startPicking: (orderId: string) => void;
  /** Picker mengambil barang di rack: stok (dan reserve-nya) berkurang. */
  pickOrderItems: (orderId: string) => void;
  /** Picker menaruh tote di meja check-in. */
  arriveCheckin: (orderId: string) => void;
  /** Checker mulai scan barang per PCS. */
  startChecking: (orderId: string) => void;
  /** Satu PCS selesai di-scan; PCS terakhir membuat order siap diantar ke packing. */
  checkOnePiece: (orderId: string) => void;
  /** Checker mengantar tote ke packing station. */
  startToPacking: (orderId: string) => void;
  /** Tote sampai di packing station, diserahkan ke packer. */
  startHandover: (orderId: string) => void;
  /** Serah terima selesai, tote di meja: packer langsung mulai mengemas. */
  deliverPackingOrder: (orderId: string) => void;
  /** Satu PCS selesai dikemas jadi satu paket dan ditaruh di conveyor. */
  packOnePiece: (orderId: string) => void;
  /**
   * Satu paket sampai di tujuan conveyor. Paket terakhir: pallet slot Shipping jadi inventory,
   * atau (sameday) order AT_COUNTER menunggu driver Gojek.
   */
  conveyOnePiece: (orderId: string) => void;
  /** Driver Gojek menerima semua paket order sameday di loket. */
  handOverToGojek: (orderId: string) => void;

  /** Pengecekan pallet di Shipping Area sebelum dimuat ke truk. */
  shippingChecks: ShippingCheck[];
  /** Shipping checker mulai scan pallet ini. */
  startShippingCheck: (inventoryId: string) => void;
  /** Satu paket di pallet selesai di-scan; paket terakhir membuat pallet CHECKED (boleh dimuat). */
  checkShippingPiece: (inventoryId: string) => void;

  /** Antrekan pallet di slot Shipping untuk dimuat ke truk outbound. Hanya pallet yang sudah dicek. */
  shipPallet: (inventoryId: string) => void;
  /** Hand pallet berangkat dari truk untuk mengambil pallet. */
  startLoading: (taskId: string) => void;
  /** Pallet diangkat dari slot Shipping: keluar dari inventory (in transit ke truk). */
  pickUpOutbound: (taskId: string) => void;
  /** Pallet sudah di dalam truk (truk masih menunggu di dock). */
  completeOutbound: (taskId: string) => void;
  /** Minta truk outbound di dock ini berangkat dengan muatan yang sudah ada. */
  dispatchTruck: (dockId: string) => void;
  /** Truk sudah berangkat: semua pallet LOADED di dock ini jadi SHIPPED. */
  completeDispatch: (dockId: string) => void;

  beginMove: (inventoryId: string) => void;
  cancelMove: () => void;
  /** Membuat movement PENDING dari `movingInventoryId` ke location tujuan. */
  createMovement: (toLocationId: string) => void;
  startMovement: (id: string) => void;
  /** Pallet diangkat forklift: inventory keluar dari location asal (in transit). */
  pickUpMovement: (id: string) => void;
  /** Pallet diturunkan: inventory masuk ke location tujuan. */
  completeMovement: (id: string) => void;
}

let movementSeq = 0;
let inboundSeq = 0;
let outboundSeq = 0;
let packingSeq = 0;
let returnSeq = 0;
let letDownSeq = 0;
let inventorySeq = initialInventory.length;
const nextInventoryId = () => `INV-${String(++inventorySeq).padStart(4, "0")}`;
const nextMovementId = () => `MOV-${String(++movementSeq).padStart(4, "0")}`;

/**
 * Slot lantai kosong: tidak ada pallet, tidak ada movement aktif yang menuju ke sana,
 * dan tidak sedang dipakai order pick & pack (sebagai packing station atau slot Shipping tujuan).
 */
function findFreeFloorSlot(
  slots: FloorSlot[],
  inventory: Inventory[],
  movements: InventoryMovement[],
  packingOrders: PackingOrder[],
) {
  const used = new Set(inventory.map((i) => i.locationId));
  for (const m of movements) {
    if (isActiveMovement(m)) used.add(m.toLocationId);
  }
  for (const order of packingOrders) {
    if (order.status === "CLOSED") continue;
    if (usesStation(order)) used.add(order.stationId);
    if (order.destination.kind === "SHIPPING") used.add(order.destination.slotId);
  }
  return slots.find((s) => !used.has(s.id));
}

/** Order masih memakai packing station-nya. Order sameday yang paketnya sudah di loket tidak lagi. */
export const usesStation = (order: PackingOrder) => order.status !== "CLOSED" && order.status !== "AT_COUNTER";

/** Tumpukan meja loket Sameday yang kosong (tidak dipakai order sameday yang belum diambil Gojek). */
function findFreeCounterSlot(packingOrders: PackingOrder[]): number | undefined {
  const used = new Set(
    packingOrders.flatMap((o) =>
      o.status !== "CLOSED" && o.destination.kind === "SAMEDAY" ? [o.destination.counterSlot] : [],
    ),
  );
  return Array.from({ length: SAMEDAY_COUNTER_SLOTS }, (_, i) => i).find((i) => !used.has(i));
}

const updateOrder = (orders: PackingOrder[], id: string, patch: Partial<PackingOrder>) =>
  orders.map((o) => (o.id === id ? { ...o, ...patch } : o));

const updateReturn = (orders: ReturnOrder[], id: string, patch: Partial<ReturnOrder>) =>
  orders.map((o) => (o.id === id ? { ...o, ...patch } : o));

/** Slot staging terpakai = berisi pallet, atau sudah dipesan inbound yang belum sampai. */
function getUsedStagingIds(inventory: Inventory[], inboundTasks: InboundTask[]): Set<string> {
  const used = new Set<string>();
  for (const item of inventory) {
    if (stagingById.has(item.locationId)) used.add(item.locationId);
  }
  for (const task of inboundTasks) {
    if (task.status !== "RECEIVED") used.add(task.stagingId);
  }
  return used;
}

/** Movement satu pallet utuh dari lokasinya sekarang. */
function createPalletMovement(item: Inventory, type: InventoryMovement["type"], toLocationId: string): InventoryMovement {
  return {
    id: nextMovementId(),
    type,
    inventoryId: item.id,
    sku: item.sku,
    fromLocationId: item.locationId,
    toLocationId,
    quantity: item.quantity,
    reservedQuantity: item.reservedQuantity,
    status: "PENDING",
  };
}

const setStatus = (movements: InventoryMovement[], id: string, status: MovementStatus) =>
  movements.map((m) => (m.id === id ? { ...m, status } : m));

export const useWarehouseStore = create<WarehouseState>((set, get) => ({
  inventory: initialInventory,
  movements: [],
  inboundTasks: [],
  packingOrders: [],
  outboundTasks: [],
  dispatchingDockIds: [],
  returnOrders: [],
  letDowns: [],

  setLetDownStatus: (letDownId, status) =>
    set((state) => ({ letDowns: state.letDowns.map((l) => (l.id === letDownId ? { ...l, status } : l)) })),

  createReturn: (sku, quantity, damaged) => {
    const { returnOrders, inventory } = get();
    const slot = returnSlots[0];
    const dock = warehouseLayout.docks.find((d) => d.direction === "RETURN");
    const busy = returnOrders.some((r) => r.status !== "DONE") || inventory.some((i) => i.locationId === slot.id);
    const valid =
      Number.isInteger(quantity) &&
      quantity >= 1 &&
      quantity <= MAX_RETURN_QUANTITY &&
      Number.isInteger(damaged) &&
      damaged >= 0 &&
      damaged <= quantity;
    if (busy || !valid || !dock) return false;

    const order: ReturnOrder = {
      id: `RT-${String(++returnSeq).padStart(4, "0")}`,
      sku,
      quantity,
      damagedPlanned: damaged,
      dockId: dock.id,
      status: "QUEUED",
      unboxedQuantity: 0,
      goodQuantity: 0,
      damagedQuantity: 0,
    };
    set((state) => ({ returnOrders: [...state.returnOrders, order] }));
    return true;
  },

  startReturnUnloading: (returnId) =>
    set((state) => ({ returnOrders: updateReturn(state.returnOrders, returnId, { status: "UNLOADING" }) })),

  arriveReturn: (returnId) =>
    set((state) => ({ returnOrders: updateReturn(state.returnOrders, returnId, { status: "ARRIVED" }) })),

  startUnboxing: (returnId) =>
    set((state) => ({
      returnOrders: state.returnOrders.map((r) =>
        r.id === returnId && r.status === "ARRIVED" ? { ...r, status: "UNBOXING" } : r,
      ),
    })),

  unboxOne: (returnId) => {
    const order = get().returnOrders.find((r) => r.id === returnId);
    if (!order || order.status !== "UNBOXING") return;

    const damaged = isReturnPieceDamaged(order, order.unboxedQuantity);
    const next: ReturnOrder = {
      ...order,
      unboxedQuantity: order.unboxedQuantity + 1,
      goodQuantity: order.goodQuantity + (damaged ? 0 : 1),
      damagedQuantity: order.damagedQuantity + (damaged ? 1 : 0),
    };
    if (next.unboxedQuantity < order.quantity) {
      set((state) => ({ returnOrders: state.returnOrders.map((r) => (r.id === returnId ? next : r)) }));
      return;
    }

    // Paket terakhir: barang bagus jadi inventory di slot RETURN, siap putaway ke rack.
    const output: Inventory | null =
      next.goodQuantity > 0
        ? {
            id: nextInventoryId(),
            locationId: returnSlots[0].id,
            sku: order.sku,
            quantity: next.goodQuantity,
            reservedQuantity: 0,
          }
        : null;
    set((state) => ({
      inventory: output ? [...state.inventory, output] : state.inventory,
      returnOrders: state.returnOrders.map((r) =>
        r.id === returnId ? { ...next, status: "DONE", outputInventoryId: output?.id } : r,
      ),
    }));
  },

  selectedLocationId: null,
  hoveredLocationId: null,
  movingInventoryId: null,

  highlightedLocationIds: [],
  cameraFocus: null,
  highlightLocations: (ids) => set({ highlightedLocationIds: ids }),
  focusCamera: (focus) =>
    set((state) => ({ cameraFocus: { ...focus, id: (state.cameraFocus?.id ?? 0) + 1 } })),
  showUpperFloor: true,
  toggleUpperFloor: () => set((state) => ({ showUpperFloor: !state.showUpperFloor })),

  selectLocation: (id) => set({ selectedLocationId: id }),
  hoverLocation: (id) => set({ hoveredLocationId: id }),
  unhoverLocation: (id) =>
    set((state) => (state.hoveredLocationId === id ? { hoveredLocationId: null } : state)),

  receiveInbound: (sku, quantity) => {
    const { inventory, inboundTasks } = get();
    const used = getUsedStagingIds(inventory, inboundTasks);
    const slot = stagingLocations.find((s) => !used.has(s.id));
    if (!slot) return null;

    const task: InboundTask = {
      id: `IB-${String(++inboundSeq).padStart(4, "0")}`,
      sku,
      quantity,
      dockId: getNearestDock(slot, "INBOUND").id,
      stagingId: slot.id,
      status: "QUEUED",
    };
    set((state) => ({ inboundTasks: [...state.inboundTasks, task] }));
    return task;
  },

  startUnloading: (taskId) =>
    set((state) => ({
      inboundTasks: state.inboundTasks.map((t) => (t.id === taskId ? { ...t, status: "UNLOADING" } : t)),
    })),

  completeInbound: (taskId) => {
    const task = get().inboundTasks.find((t) => t.id === taskId);
    if (!task) return;

    const item: Inventory = {
      id: nextInventoryId(),
      locationId: task.stagingId,
      sku: task.sku,
      quantity: task.quantity,
      reservedQuantity: 0,
    };
    set((state) => ({
      inventory: [...state.inventory, item],
      inboundTasks: state.inboundTasks.map((t) => (t.id === taskId ? { ...t, status: "RECEIVED" } : t)),
    }));
  },

  createPackingOrder: (inventoryId, quantity, sameday = false) => {
    const { inventory, movements, packingOrders } = get();
    const item = inventory.find((i) => i.id === inventoryId);
    const station = findFreeFloorSlot(packingStations, inventory, movements, packingOrders);
    // Tujuan conveyor: tumpukan di meja loket Sameday, atau slot Shipping (pallet untuk truk).
    let destination: PackingDestination | undefined;
    if (sameday) {
      const counterSlot = findFreeCounterSlot(packingOrders);
      destination = counterSlot === undefined ? undefined : { kind: "SAMEDAY", counterSlot };
    } else {
      const slot = findFreeFloorSlot(shippingSlots, inventory, movements, packingOrders);
      destination = slot && { kind: "SHIPPING", slotId: slot.id };
    }
    const maxQuantity = sameday ? MAX_SAMEDAY_QUANTITY : MAX_PICK_QUANTITY;
    const valid =
      item && Number.isInteger(quantity) && quantity >= 1 && quantity <= Math.min(getAvailableQuantity(item), maxQuantity);
    if (!item || !station || !destination || !valid) return false;

    const order: PackingOrder = {
      id: `PO-${String(++packingSeq).padStart(4, "0")}`,
      stationId: station.id,
      fromLocationId: item.locationId,
      sourceInventoryId: item.id,
      sku: item.sku,
      quantity,
      checkedQuantity: 0,
      packedQuantity: 0,
      destination,
      conveyedQuantity: 0,
      status: "QUEUED",
    };
    // Rack level atas tidak terjangkau tangan: forklift menurunkan pallet untuk picker.
    // Satu pallet hanya bisa di-let-down satu order sekaligus.
    const level = locationById.get(item.locationId)?.level ?? 1;
    const needsLetDown = level >= LET_DOWN_MIN_LEVEL;
    if (needsLetDown && get().letDowns.some((l) => l.locationId === item.locationId && l.status !== "DONE")) {
      return false;
    }
    const letDown: LetDownTask | null =
      needsLetDown
        ? {
            id: `LD-${String(++letDownSeq).padStart(4, "0")}`,
            orderId: order.id,
            locationId: item.locationId,
            status: "PENDING",
          }
        : null;
    set((state) => ({
      letDowns: letDown ? [...state.letDowns, letDown] : state.letDowns,
      packingOrders: [...state.packingOrders, order],
      // Reserve supaya stok yang sama tidak di-pick / dipindah order lain.
      inventory: state.inventory.map((i) =>
        i.id === item.id ? { ...i, reservedQuantity: i.reservedQuantity + quantity } : i,
      ),
    }));
    return true;
  },

  pickOrderItems: (orderId) => {
    const order = get().packingOrders.find((o) => o.id === orderId);
    if (!order) return;
    set((state) => ({
      inventory: state.inventory
        .map((i) =>
          i.id === order.sourceInventoryId
            ? { ...i, quantity: i.quantity - order.quantity, reservedQuantity: i.reservedQuantity - order.quantity }
            : i,
        )
        .filter((i) => i.quantity > 0),
    }));
  },

  startPicking: (orderId) =>
    set((state) => ({ packingOrders: updateOrder(state.packingOrders, orderId, { status: "PICKING" }) })),

  arriveCheckin: (orderId) =>
    set((state) => ({ packingOrders: updateOrder(state.packingOrders, orderId, { status: "AT_CHECKIN" }) })),

  startChecking: (orderId) =>
    set((state) => ({ packingOrders: updateOrder(state.packingOrders, orderId, { status: "CHECKING" }) })),

  checkOnePiece: (orderId) =>
    set((state) => ({
      packingOrders: state.packingOrders.map((o) =>
        o.id === orderId && o.status === "CHECKING"
          ? { ...o, checkedQuantity: Math.min(o.checkedQuantity + 1, o.quantity) }
          : o,
      ),
    })),

  startToPacking: (orderId) =>
    set((state) => ({ packingOrders: updateOrder(state.packingOrders, orderId, { status: "TO_PACKING" }) })),

  startHandover: (orderId) =>
    set((state) => ({ packingOrders: updateOrder(state.packingOrders, orderId, { status: "HANDOVER" }) })),

  deliverPackingOrder: (orderId) =>
    set((state) => ({ packingOrders: updateOrder(state.packingOrders, orderId, { status: "PACKING" }) })),

  packOnePiece: (orderId) => {
    const order = get().packingOrders.find((o) => o.id === orderId);
    if (!order || order.status !== "PACKING") return;

    const packedQuantity = order.packedQuantity + 1;
    // PCS terakhir: tinggal menunggu paket-paket di conveyor sampai di tujuannya.
    const status = packedQuantity < order.quantity ? order.status : "CONVEYING";
    set((state) => ({ packingOrders: updateOrder(state.packingOrders, orderId, { packedQuantity, status }) }));
  },

  conveyOnePiece: (orderId) => {
    const order = get().packingOrders.find((o) => o.id === orderId);
    if (!order || (order.status !== "PACKING" && order.status !== "CONVEYING")) return;

    const conveyedQuantity = order.conveyedQuantity + 1;
    if (conveyedQuantity < order.quantity) {
      set((state) => ({ packingOrders: updateOrder(state.packingOrders, orderId, { conveyedQuantity }) }));
      return;
    }
    // Paket terakhir sameday: semua paket di meja loket, menunggu driver Gojek.
    const { destination } = order;
    if (destination.kind === "SAMEDAY") {
      set((state) => ({
        packingOrders: updateOrder(state.packingOrders, orderId, { conveyedQuantity, status: "AT_COUNTER" }),
      }));
      return;
    }
    // Paket terakhir: pallet di slot Shipping jadi inventory, menunggu dicek sebelum dimuat ke truk.
    const output: Inventory = {
      id: nextInventoryId(),
      locationId: destination.slotId,
      sku: order.sku,
      quantity: order.quantity,
      reservedQuantity: 0,
    };
    const check: ShippingCheck = {
      inventoryId: output.id,
      slotId: destination.slotId,
      quantity: order.quantity,
      checkedQuantity: 0,
      status: "PENDING",
    };
    set((state) => ({
      inventory: [...state.inventory, output],
      shippingChecks: [...state.shippingChecks, check],
      packingOrders: updateOrder(state.packingOrders, orderId, {
        conveyedQuantity,
        status: "CLOSED",
        outputInventoryId: output.id,
      }),
    }));
  },

  handOverToGojek: (orderId) =>
    set((state) => ({
      packingOrders: state.packingOrders.map((o) =>
        o.id === orderId && o.status === "AT_COUNTER" ? { ...o, status: "CLOSED" } : o,
      ),
    })),

  shippingChecks: [],

  startShippingCheck: (inventoryId) =>
    set((state) => ({
      shippingChecks: state.shippingChecks.map((c) =>
        c.inventoryId === inventoryId && c.status === "PENDING" ? { ...c, status: "CHECKING" } : c,
      ),
    })),

  checkShippingPiece: (inventoryId) =>
    set((state) => ({
      shippingChecks: state.shippingChecks.map((c) => {
        if (c.inventoryId !== inventoryId || c.status !== "CHECKING") return c;
        const checkedQuantity = Math.min(c.checkedQuantity + 1, c.quantity);
        return { ...c, checkedQuantity, status: checkedQuantity >= c.quantity ? "CHECKED" : "CHECKING" };
      }),
    })),

  shipPallet: (inventoryId) => {
    const { inventory, outboundTasks, shippingChecks } = get();
    const item = inventory.find((i) => i.id === inventoryId);
    const slot = item && floorSlotById.get(item.locationId);
    if (!item || slot?.type !== "SHIPPING" || outboundTasks.some((t) => t.inventoryId === inventoryId)) return;
    // Belum dicek: belum boleh diserahkan ke transporter.
    if (shippingChecks.find((c) => c.inventoryId === inventoryId)?.status !== "CHECKED") return;

    const task: OutboundTask = {
      id: `OB-${String(++outboundSeq).padStart(4, "0")}`,
      inventoryId,
      sku: item.sku,
      quantity: item.quantity,
      dockId: getNearestDock(slot, "OUTBOUND").id,
      slotId: slot.id,
      status: "QUEUED",
    };
    set((state) => ({ outboundTasks: [...state.outboundTasks, task] }));
  },

  startLoading: (taskId) =>
    set((state) => ({
      outboundTasks: state.outboundTasks.map((t) => (t.id === taskId ? { ...t, status: "LOADING" } : t)),
    })),

  pickUpOutbound: (taskId) => {
    const task = get().outboundTasks.find((t) => t.id === taskId);
    if (!task) return;
    set((state) => ({ inventory: state.inventory.filter((i) => i.id !== task.inventoryId) }));
  },

  completeOutbound: (taskId) =>
    set((state) => ({
      outboundTasks: state.outboundTasks.map((t) => (t.id === taskId ? { ...t, status: "LOADED" } : t)),
    })),

  dispatchTruck: (dockId) =>
    set((state) =>
      state.dispatchingDockIds.includes(dockId)
        ? state
        : { dispatchingDockIds: [...state.dispatchingDockIds, dockId] },
    ),

  completeDispatch: (dockId) =>
    set((state) => ({
      outboundTasks: state.outboundTasks.map((t) =>
        t.dockId === dockId && t.status === "LOADED" ? { ...t, status: "SHIPPED" } : t,
      ),
      dispatchingDockIds: state.dispatchingDockIds.filter((id) => id !== dockId),
    })),

  beginMove: (inventoryId) => set({ movingInventoryId: inventoryId }),
  cancelMove: () => set({ movingInventoryId: null }),

  createMovement: (toLocationId) => {
    const { inventory, movingInventoryId } = get();
    const item = inventory.find((i) => i.id === movingInventoryId);
    if (!item) return;
    // Dari staging Receiving atau slot Return ke rack = putaway; antar rack = transfer.
    const fromType = floorSlotById.get(item.locationId)?.type;
    const type = fromType === "STAGING" || fromType === "RETURN" ? "PUTAWAY" : "TRANSFER";
    set((state) => ({
      movements: [...state.movements, createPalletMovement(item, type, toLocationId)],
      movingInventoryId: null,
    }));
  },

  startMovement: (id) => set((state) => ({ movements: setStatus(state.movements, id, "IN_PROGRESS") })),

  pickUpMovement: (id) => {
    const movement = get().movements.find((m) => m.id === id);
    if (!movement) return;
    set((state) => ({ inventory: state.inventory.filter((i) => i.id !== movement.inventoryId) }));
  },

  completeMovement: (id) => {
    const movement = get().movements.find((m) => m.id === id);
    if (!movement) return;

    set((state) => {
      // SKU yang sama di location tujuan digabung; selain itu pallet masuk sebagai baris
      // inventory dengan id yang sama, supaya data yang terkait (mis. outbound task) tetap nyambung.
      const existing = state.inventory.find(
        (i) => i.locationId === movement.toLocationId && i.sku === movement.sku,
      );
      const inventory = existing
        ? state.inventory.map((i) =>
            i === existing
              ? {
                  ...i,
                  quantity: i.quantity + movement.quantity,
                  reservedQuantity: i.reservedQuantity + movement.reservedQuantity,
                }
              : i,
          )
        : [
            ...state.inventory,
            {
              id: movement.inventoryId,
              locationId: movement.toLocationId,
              sku: movement.sku,
              quantity: movement.quantity,
              reservedQuantity: movement.reservedQuantity,
            },
          ];
      return { inventory, movements: setStatus(state.movements, id, "COMPLETED") };
    });
  },
}));

// Turunan inventory/movement. Di-memo per referensi array, jadi hanya dihitung ulang saat data berubah.

export function useStockByLocation() {
  const inventory = useWarehouseStore((s) => s.inventory);
  return useMemo(() => getStockByLocation(inventory), [inventory]);
}

export function useInventoryByLocation() {
  const inventory = useWarehouseStore((s) => s.inventory);
  return useMemo(() => groupBy(inventory, (i) => i.locationId), [inventory]);
}

/** Inventory yang sedang dipilihkan tujuannya, atau undefined di luar mode "pilih tujuan". */
export function useMovingInventory() {
  return useWarehouseStore((s) =>
    s.movingInventoryId ? s.inventory.find((i) => i.id === s.movingInventoryId) : undefined,
  );
}

/** Ada packing station / slot Shipping yang bisa dipakai. */
export function useFreeFloorSlots() {
  const inventory = useWarehouseStore((s) => s.inventory);
  const movements = useWarehouseStore((s) => s.movements);
  const packingOrders = useWarehouseStore((s) => s.packingOrders);
  return useMemo(
    () => ({
      packing: findFreeFloorSlot(packingStations, inventory, movements, packingOrders) !== undefined,
      shipping: findFreeFloorSlot(shippingSlots, inventory, movements, packingOrders) !== undefined,
      sameday: findFreeCounterSlot(packingOrders) !== undefined,
    }),
    [inventory, movements, packingOrders],
  );
}

/** Order pick & pack yang masih memakai packing station, per station. */
export function useActiveOrderByStation() {
  const packingOrders = useWarehouseStore((s) => s.packingOrders);
  return useMemo(
    () => new Map(packingOrders.filter(usesStation).map((o) => [o.stationId, o])),
    [packingOrders],
  );
}

/** Order pick & pack yang sedang berjalan (belum CLOSED) per slot Shipping tujuannya. */
export function useActiveOrderByShippingSlot() {
  const packingOrders = useWarehouseStore((s) => s.packingOrders);
  return useMemo(
    () =>
      new Map(
        packingOrders.flatMap((o) =>
          o.status !== "CLOSED" && o.destination.kind === "SHIPPING" ? [[o.destination.slotId, o] as const] : [],
        ),
      ),
    [packingOrders],
  );
}

/** Order sameday yang belum diambil Gojek, urut order dibuat. */
export function useActiveSamedayOrders() {
  const packingOrders = useWarehouseStore((s) => s.packingOrders);
  return useMemo(
    () => packingOrders.filter((o) => o.status !== "CLOSED" && o.destination.kind === "SAMEDAY"),
    [packingOrders],
  );
}

/** Outbound task per inventory. */
export function useOutboundByInventory() {
  const outboundTasks = useWarehouseStore((s) => s.outboundTasks);
  return useMemo(() => new Map(outboundTasks.map((t) => [t.inventoryId, t])), [outboundTasks]);
}

/** Slot staging yang sedang terisi atau dipesan inbound. */
export function useUsedStagingIds() {
  const inventory = useWarehouseStore((s) => s.inventory);
  const inboundTasks = useWarehouseStore((s) => s.inboundTasks);
  return useMemo(() => getUsedStagingIds(inventory, inboundTasks), [inventory, inboundTasks]);
}

/** Pallet sedang keluar dari rack-nya (di fork forklift untuk let-down), jadi tidak digambar di rack. */
const PALLET_OUT_STATUSES: LetDownStatus[] = ["LOWERING", "HOLDING", "PICKED", "RETURNING"];

export function useLiftedLocationIds() {
  const letDowns = useWarehouseStore((s) => s.letDowns);
  return useMemo(
    () => new Set(letDowns.filter((l) => PALLET_OUT_STATUSES.includes(l.status)).map((l) => l.locationId)),
    [letDowns],
  );
}

/** Location yang sedang dipakai let-down (belum DONE); pallet-nya dikunci dari movement lain. */
export function useLetDownLocationIds() {
  const letDowns = useWarehouseStore((s) => s.letDowns);
  return useMemo(() => new Set(letDowns.filter((l) => l.status !== "DONE").map((l) => l.locationId)), [letDowns]);
}

export function useIncomingByLocation() {
  const movements = useWarehouseStore((s) => s.movements);
  return useMemo(() => getIncomingByLocation(movements), [movements]);
}
