export type AreaType =
  | "ZONE"
  | "RECEIVING"
  | "RETURN"
  | "CHECKIN"
  | "PACKING"
  | "SHIPPING"
  | "SAMEDAY"
  | "OFFICE"
  | "PANTRY";

/** Koordinat lantai dalam meter: x = kiri/kanan, z = depan/belakang. */
export type FloorPoint = [x: number, z: number];

export interface WarehouseArea {
  id: string;
  code: string;
  name: string;
  type: AreaType;
  /** Titik tengah area di lantai. */
  position: FloorPoint;
  /** Lebar (x) dan kedalaman (z) area. */
  size: [width: number, depth: number];
}

/**
 * Pintu dock di dinding barat (x = -width/2) atau timur (x = +width/2).
 * INBOUND: truk dibongkar ke staging Receiving. OUTBOUND: pallet dari Shipping dimuat ke truk.
 * RETURN: truk retur dibongkar ke Return Area.
 */
export interface DockDoor {
  id: string;
  code: string;
  wall: "WEST" | "EAST";
  direction: "INBOUND" | "OUTBOUND" | "RETURN";
  /** Posisi tengah pintu sepanjang dinding. */
  z: number;
  width: number;
}

export interface WarehouseLayout {
  id: string;
  name: string;
  width: number;
  depth: number;
  wallHeight: number;
  areas: WarehouseArea[];
  docks: DockDoor[];
}

/** SOUTH = menghadap +z, NORTH = -z, WEST = -x, EAST = +x. */
export type RackFacing = "SOUTH" | "NORTH" | "WEST" | "EAST";

export interface Rack {
  id: string;
  code: string;
  zoneId: string;
  /** Titik tengah rack di lantai. */
  position: FloorPoint;
  /** Arah sisi depan rack (tempat forklift & picker mengambil barang). */
  facing: RackFacing;
  /**
   * Hanya untuk rack yang menghadap barat/timur (memanjang searah z): z lajur forklift dari corridor
   * ke aisle depan rack. Picker lewat lajur sejajar di selatannya.
   */
  accessZ?: number;
  levels: number;
  slotsPerLevel: number;
}

export type LocationStatus = "EMPTY" | "AVAILABLE" | "ALMOST_FULL" | "FULL";

/**
 * Stock dan status tidak disimpan di sini. Stock = jumlah `Inventory.quantity`
 * di location ini, status dihitung dari stock / capacity, supaya tidak bisa tidak sinkron.
 */
export interface WarehouseLocation {
  id: string;
  /** Format: <rack>-<level>-<slot>, contoh A01-1-01. */
  code: string;
  rackId: string;
  /** 1 = level paling bawah. */
  level: number;
  /** 1 = slot paling kiri dilihat dari depan rack. */
  slot: number;
  capacity: number;
}

/**
 * STAGING = slot di Receiving, pallet inbound menunggu putaway.
 * PACKING = packing station di Packing Area, barang hasil pick dikemas lalu dikirim lewat conveyor.
 * SHIPPING = slot di Shipping Area, pallet paket dari conveyor menunggu dimuat ke truk outbound.
 * RETURN = slot di Return Area, barang retur yang lolos pemeriksaan menunggu putaway.
 */
export type FloorSlotType = "STAGING" | "PACKING" | "SHIPPING" | "RETURN";

/**
 * Slot pallet di lantai (bukan di rack). Satu slot = satu pallet.
 * Inventory bisa berada di sini (locationId = id slot).
 */
export interface FloorSlot {
  id: string;
  code: string;
  type: FloorSlotType;
  areaId: string;
  /** Titik tengah pallet di lantai. */
  position: FloorPoint;
}

export interface Product {
  sku: string;
  name: string;
  category: string;
  unit: string;
}

/** Satu location bisa berisi lebih dari satu SKU. */
export interface Inventory {
  id: string;
  locationId: string;
  sku: string;
  quantity: number;
  reservedQuantity: number;
}

/**
 * Satu pallet inbound: QUEUED (menunggu truk/dock) → UNLOADING (dibawa dari truk ke staging)
 * → RECEIVED (sudah jadi inventory di slot staging). Slot staging sudah dipesan sejak QUEUED.
 */
export type InboundStatus = "QUEUED" | "UNLOADING" | "RECEIVED";

export interface InboundTask {
  id: string;
  sku: string;
  quantity: number;
  dockId: string;
  stagingId: string;
  status: InboundStatus;
}

/**
 * Retur dari customer: QUEUED (truk menuju dock retur) → UNLOADING (pallet paket dibongkar)
 * → ARRIVED (pallet di Return Area) → UNBOXING (dibuka & diperiksa per paket) → DONE.
 * Barang bagus jadi inventory di slot RETURN (siap putaway); barang rusak masuk karantina.
 */
export type ReturnStatus = "QUEUED" | "UNLOADING" | "ARRIVED" | "UNBOXING" | "DONE";

export interface ReturnOrder {
  id: string;
  sku: string;
  /** Jumlah paket retur (1 paket = 1 PCS). */
  quantity: number;
  /** Jumlah PCS yang akan ditemukan rusak saat diperiksa. */
  damagedPlanned: number;
  dockId: string;
  status: ReturnStatus;
  unboxedQuantity: number;
  goodQuantity: number;
  damagedQuantity: number;
  /** Inventory barang bagus di slot RETURN, dibuat saat DONE (kalau ada yang bagus). */
  outputInventoryId?: string;
}

export type MovementStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED";

/**
 * Satu pallet outbound: QUEUED (menunggu truk) → LOADING (hand pallet mengambil & memuat)
 * → LOADED (sudah di dalam truk yang masih di dock) → SHIPPED (truk sudah berangkat).
 */
export type OutboundStatus = "QUEUED" | "LOADING" | "LOADED" | "SHIPPED";

/**
 * Pengecekan pallet di Shipping Area sebelum diserahkan ke transporter (dimuat ke truk):
 * PENDING (pallet lengkap, menunggu checker) → CHECKING (checker scan per paket) → CHECKED.
 */
export type ShippingCheckStatus = "PENDING" | "CHECKING" | "CHECKED";

export interface ShippingCheck {
  inventoryId: string;
  slotId: string;
  /** Jumlah paket di pallet (1 PCS = 1 paket). */
  quantity: number;
  checkedQuantity: number;
  status: ShippingCheckStatus;
}

export interface OutboundTask {
  id: string;
  inventoryId: string;
  sku: string;
  quantity: number;
  dockId: string;
  slotId: string;
  status: OutboundStatus;
}

/**
 * Let-down: barang di rack level atas (tidak terjangkau tangan) diturunkan forklift untuk picker.
 * PENDING (menunggu forklift) → FETCHING (forklift menuju rack) → LOWERING (pallet di fork, turun)
 * → HOLDING (pallet ditahan rendah di aisle, picker boleh mengambil) → PICKED (picker selesai)
 * → RETURNING (pallet dikembalikan ke rack) → DONE.
 * Inventory tetap tercatat di location rack sepanjang proses.
 */
export type LetDownStatus = "PENDING" | "FETCHING" | "LOWERING" | "HOLDING" | "PICKED" | "RETURNING" | "DONE";

export interface LetDownTask {
  id: string;
  orderId: string;
  locationId: string;
  status: LetDownStatus;
}

/** PUTAWAY = dari staging Receiving / slot Return ke rack, TRANSFER = antar location rack. */
export type MovementType = "PUTAWAY" | "TRANSFER";

/**
 * Order pick & pack per PCS di satu packing station:
 * QUEUED (menunggu picker) → PICKING (picker/orang inventory ke rack, ambil barang, bawa ke check-in)
 * → AT_CHECKIN (tote di meja check-in) → CHECKING (checker scan per PCS) → TO_PACKING (checker
 * mengantar tote) → HANDOVER (serah terima ke packer) → PACKING (tote di meja, langsung dikemas per
 * PCS, 1 PCS = 1 paket; tiap paket langsung ditaruh di conveyor ke tujuannya) → CONVEYING
 * (semua sudah dikemas, paket terakhir masih di conveyor) → lalu tergantung tujuan:
 * - SHIPPING: CLOSED (semua paket sampai: pallet di slot Shipping jadi inventory);
 * - SAMEDAY: AT_COUNTER (semua paket di meja loket, menunggu driver Gojek) → CLOSED (diambil Gojek).
 */
export type PackingOrderStatus =
  | "QUEUED"
  | "PICKING"
  | "AT_CHECKIN"
  | "CHECKING"
  | "TO_PACKING"
  | "HANDOVER"
  | "PACKING"
  | "CONVEYING"
  | "AT_COUNTER"
  | "CLOSED";

/**
 * Tujuan paket hasil packing:
 * - SHIPPING: ditumpuk di pallet slot Shipping, nanti dimuat ke truk;
 * - SAMEDAY: dikumpulkan di meja loket Sameday (tumpukan ke-`counterSlot`), diambil driver Gojek.
 */
export type PackingDestination = { kind: "SHIPPING"; slotId: string } | { kind: "SAMEDAY"; counterSlot: number };

export interface PackingOrder {
  id: string;
  stationId: string;
  /** Location rack asal barang. */
  fromLocationId: string;
  /** Inventory di rack yang di-pick (sudah di-reserve sejak order dibuat). */
  sourceInventoryId: string;
  sku: string;
  quantity: number;
  /** PCS yang sudah di-scan di check-in. */
  checkedQuantity: number;
  packedQuantity: number;
  /** Tujuan conveyor (slot Shipping / tumpukan di loket Sameday), dipesan sejak order dibuat. */
  destination: PackingDestination;
  /** Paket yang sudah sampai di tujuan conveyor. */
  conveyedQuantity: number;
  status: PackingOrderStatus;
  /** Inventory pallet paket di slot Shipping, dibuat saat CLOSED. */
  outputInventoryId?: string;
}

/**
 * Perpindahan satu inventory (satu pallet) secara utuh.
 * Selama IN_PROGRESS dan pallet sudah diangkat, stock tidak dihitung di location mana pun (in transit).
 */
export interface InventoryMovement {
  id: string;
  type: MovementType;
  inventoryId: string;
  sku: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  reservedQuantity: number;
  status: MovementStatus;
}
