import type {
  DockDoor,
  FloorSlot,
  Inventory,
  Product,
  Rack,
  RackFacing,
  WarehouseLayout,
  WarehouseLocation,
} from "@/types/warehouse";
import { groupBy } from "@/lib/warehouse";

/**
 * Titik-titik Return Area (koordinat dunia). Semua di satu garis z sejajar dock retur (dinding timur):
 * pallet paket retur (dari truk, timur) → petugas + meja unboxing → pallet barang bagus (RET-01, barat).
 * Bin karantina barang rusak di selatan petugas.
 */
export const RETURN_LAYOUT = {
  z: -7.3,
  sourceX: 21.4,
  workerX: 20,
  goodX: 18.6,
  /** Meja di utara petugas, bin rusak di selatannya. */
  tableOffsetZ: -0.95,
  binOffsetZ: 1,
};

/**
 * Garis tengah conveyor paket: lurus sepanjang x, menempel di dinding utara (tepi dalam meja loket
 * Sameday). Baris utara dari timur ke barat: Check-in → Packing → Shipping → loket Sameday, jadi paket
 * mengalir lurus ke barat dari packing station melewati slot Shipping sampai meja loket.
 */
export const CONVEYOR_Z = -17.43;

/**
 * Layout dummy untuk MVP. Lantai berpusat di (0, 0). Receiving & Return di timur, Zone A / Zone B
 * di tengah, Zone C di barat (utara mezzanine), Check-in → Packing → Shipping → Sameday berjajar di sepanjang dinding utara.
 */
export const warehouseLayout: WarehouseLayout = {
  id: "WH-001",
  name: "Main Warehouse",
  width: 58,
  depth: 36,
  wallHeight: 1.2,
  // Dinding timur: dock retur (samping Return Area) & dock inbound (samping Receiving).
  // Dinding barat: dock outbound; hand pallet ke slot Shipping lewat lorong di selatan baris utara.
  docks: [
    { id: "DOCK-01", code: "D01", wall: "EAST", direction: "RETURN", z: RETURN_LAYOUT.z, width: 3 },
    { id: "DOCK-02", code: "D02", wall: "EAST", direction: "INBOUND", z: 5, width: 3 },
    { id: "DOCK-03", code: "D03", wall: "WEST", direction: "OUTBOUND", z: -8, width: 3 },
  ],
  areas: [
    {
      id: "AREA-RET",
      code: "RET",
      name: "Return Area",
      type: "RETURN",
      position: [20, -6.75],
      size: [6, 10.5],
    },
    {
      id: "AREA-RCV",
      code: "RCV",
      name: "Receiving Area",
      type: "RECEIVING",
      position: [20, 5.25],
      size: [6, 13.5],
    },
    {
      id: "ZONE-A",
      code: "A",
      name: "Zone A",
      type: "ZONE",
      position: [-2, -6.5],
      size: [18, 11],
    },
    {
      id: "ZONE-B",
      code: "B",
      name: "Zone B",
      type: "ZONE",
      position: [-2, 6.5],
      size: [18, 11],
    },
    {
      // Dua rack memanjang searah z, menghadap barat (lihat ZONE_RACK_LAYOUTS), di utara mezzanine
      // Pantry/Office. Forklift & picker masuk dari corridor lewat aisle Zone B di depan rack B02.
      id: "ZONE-C",
      code: "C",
      name: "Zone C",
      type: "ZONE",
      position: [-18.1, -1],
      size: [10, 15],
    },
    {
      // Paket order sameday dikumpulkan di meja loket di dinding utara (jauh dari parkiran mobil di
      // depan gudang), diambil driver Gojek lewat jalan belakang di sisi utara gudang. Ujung barat conveyor.
      id: "AREA-SDY",
      code: "SDY",
      name: "Sameday Counter",
      type: "SAMEDAY",
      position: [-20, -16.55],
      size: [6, 2.7],
    },
    {
      // Shipping di barat Packing: conveyor melewati slot Shipping lalu terus ke loket Sameday.
      id: "AREA-SHP",
      code: "SHP",
      name: "Shipping Area",
      type: "SHIPPING",
      position: [-11, -15.25],
      size: [10, 5.5],
    },
    {
      // Packing di antara Check-in (timur) dan Shipping (barat), di belakang (utara) rack.
      id: "AREA-PCK",
      code: "PCK",
      name: "Packing Area",
      type: "PACKING",
      position: [0, -15.25],
      size: [10, 5.5],
    },
    {
      // Barang hasil pick dicek (scan per PCS) di sini sebelum dikemas. Di ujung utara walkway picker
      // dan di timur ujung awal conveyor, jadi picker & checker tidak perlu menyeberangi conveyor.
      id: "AREA-CHK",
      code: "CHK",
      name: "Check-in Area",
      type: "CHECKIN",
      position: [7.5, -15.25],
      size: [4, 5.5],
    },
    // Mezzanine (lantai 2) di pojok barat daya, jauh dari dock & baris conveyor di utara. Lantai bawahnya
    // kosong. Tangga naik ke utara di sela Pantry (barat) & Office (timur, ke arah Zone B); di ujung atas
    // tangga belok kiri ke Pantry, belok kanan ke Office. Di sisi timur Office ada tangga kedua yang turun
    // ke utara menuju aisle Zone B. Lihat Office.tsx.
    {
      id: "AREA-PAN",
      code: "PAN",
      name: "Pantry (Lt. 2)",
      type: "PANTRY",
      position: [-22, 13.8],
      size: [5.6, 8],
    },
    {
      id: "AREA-OFC",
      code: "OFC",
      name: "Office (Lt. 2)",
      type: "OFFICE",
      position: [-14.35, 13.8],
      size: [7.5, 8],
    },
  ],
};

/**
 * Pintu masuk pegawai: bukaan di dinding selatan selebar `width`, berpusat di `x`. Di sebelah timur
 * kaki tangga mezzanine, jadi dari pintu bisa langsung masuk ke gudang atau belok kiri ke tangga.
 */
export const OFFICE_DOOR = { x: -16.9, width: 1.2 };

/**
 * Loket Sameday: bukaan di dinding utara selebar `width`, berpusat di `x`, dengan meja loket.
 * Di ujung barat conveyor (lihat CONVEYOR_Z).
 */
export const SAMEDAY_COUNTER = { x: -19.5, width: 3 };
/** Jumlah tumpukan paket di meja loket = jumlah order sameday yang bisa aktif sekaligus. */
export const SAMEDAY_COUNTER_SLOTS = 4;
/** Quantity maksimum satu order sameday (1 driver Gojek membawa semuanya). */
export const MAX_SAMEDAY_QUANTITY = 8;

const RACK_LEVELS = 4;
const SLOTS_PER_LEVEL = 10;
const LOCATION_CAPACITY = 300;
/** Quantity maksimum satu pallet inbound; sama dengan kapasitas satu location. */
export const PALLET_CAPACITY = LOCATION_CAPACITY;
/** Jumlah pallet maksimum satu truk outbound; truk berangkat otomatis kalau penuh. */
export const TRUCK_PALLET_CAPACITY = 10;
/** Quantity maksimum satu order pick & pack (dikemas per PCS, jadi dibatasi supaya tidak terlalu lama). */
export const MAX_PICK_QUANTITY = 50;
/** Quantity maksimum satu retur (dibuka per paket, jadi dibatasi supaya tidak terlalu lama). */
export const MAX_RETURN_QUANTITY = 20;
/** Level rack mulai dari sini tidak terjangkau tangan: pick lewat let-down forklift. */
export const LET_DOWN_MIN_LEVEL = 3;
const STAGING_SLOTS = 5;
const STAGING_SPACING = 2.2;
/** Slot staging pertama, di selatan aisle tengah (z = 0). */
const STAGING_START_Z = 1.5;
const PACKING_STATION_OFFSETS = [-3, 0, 3];
const SHIPPING_SLOT_OFFSETS = [-3.75, -1.25, 1.25, 3.75];
/** Packer berdiri sejauh ini di selatan garis tengah conveyor, di samping ujung meja packing. */
export const PACKER_OFFSET_Z = 0.85;
/** Tengah pallet Shipping sejauh ini di selatan garis tengah conveyor, menyisakan ruang untuk transfer. */
export const SHIPPING_SLOT_OFFSET_Z = 1.4;

/**
 * Susunan rack per zone: arah hadap dan offset tiap rack dari tengah zone, searah sisi depan rack
 * (jarak antar rack = aisle forklift ±2,7 m). Rack yang menghadap barat/timur butuh `accessZ`.
 */
interface ZoneRackLayout {
  facing: RackFacing;
  offsets: number[];
  accessZ?: number;
}
const DEFAULT_RACK_LAYOUT: ZoneRackLayout = { facing: "SOUTH", offsets: [-3.8, 0, 3.8] };
const ZONE_RACK_LAYOUTS: Record<string, ZoneRackLayout> = {
  // Lajur akses = travel line forklift rack B02 (z 6,5 + 1,2), lurus dari corridor lewat aisle Zone B.
  C: { facing: "WEST", offsets: [-1.9, 1.9], accessZ: 7.7 },
};

/**
 * Pola occupancy (%) supaya semua status muncul. Deterministik, bukan random,
 * agar tampilan sama setiap reload.
 */
const OCCUPANCY_PATTERN = [0, 20, 45, 65, 75, 85, 95, 100, 35, 55, 0, 80];

const pad = (n: number) => String(n).padStart(2, "0");

export const racks: Rack[] = warehouseLayout.areas
  .filter((area) => area.type === "ZONE")
  .flatMap((zone) => {
    const { facing, offsets, accessZ } = ZONE_RACK_LAYOUTS[zone.code] ?? DEFAULT_RACK_LAYOUT;
    // Rack yang menghadap barat/timur berjajar searah x, yang lain searah z.
    const alongX = facing === "WEST" || facing === "EAST";
    return offsets.map((offset, i): Rack => {
      const code = `${zone.code}${pad(i + 1)}`;
      return {
        id: `RACK-${code}`,
        code,
        zoneId: zone.id,
        position: alongX
          ? [zone.position[0] + offset, zone.position[1]]
          : [zone.position[0], zone.position[1] + offset],
        facing,
        accessZ,
        levels: RACK_LEVELS,
        slotsPerLevel: SLOTS_PER_LEVEL,
      };
    });
  });

const receivingArea = warehouseLayout.areas.find((area) => area.type === "RECEIVING")!;

/** Satu kolom slot staging di tengah Receiving Area, berjajar sepanjang z. */
export const stagingLocations: FloorSlot[] = Array.from({ length: STAGING_SLOTS }, (_, i) => {
  const code = `RCV-${pad(i + 1)}`;
  return {
    id: `STG-${code}`,
    code,
    type: "STAGING",
    areaId: receivingArea.id,
    position: [receivingArea.position[0], STAGING_START_Z + i * STAGING_SPACING],
  };
});

const returnArea = warehouseLayout.areas.find((area) => area.type === "RETURN")!;

/** Slot barang retur yang lolos pemeriksaan, di sebelah barat meja unboxing (sisi corridor forklift). */
export const returnSlots: FloorSlot[] = [
  {
    id: "RTS-RET-01",
    code: "RET-01",
    type: "RETURN",
    areaId: returnArea.id,
    position: [RETURN_LAYOUT.goodX, RETURN_LAYOUT.z],
  },
];

const packingArea = warehouseLayout.areas.find((area) => area.type === "PACKING")!;

/**
 * Packing station berjajar sepanjang x di selatan conveyor. Posisi slot = tempat packer berdiri:
 * belt di utaranya, meja packing (tegak lurus belt) di timurnya, tote diserahkan dari sisi baratnya.
 */
export const packingStations: FloorSlot[] = PACKING_STATION_OFFSETS.map((offsetX, i) => {
  const code = `PCK-${pad(i + 1)}`;
  return {
    id: `PST-${code}`,
    code,
    type: "PACKING",
    areaId: packingArea.id,
    position: [packingArea.position[0] + offsetX, CONVEYOR_Z + PACKER_OFFSET_Z],
  };
});

const shippingArea = warehouseLayout.areas.find((area) => area.type === "SHIPPING")!;

/**
 * Slot Shipping berjajar sepanjang x di selatan conveyor: conveyor mengisi pallet dari sisi utara,
 * hand pallet mengambilnya dari sisi selatan (lorong ke dock outbound).
 */
export const shippingSlots: FloorSlot[] = SHIPPING_SLOT_OFFSETS.map((offsetX, i) => {
  const code = `SHP-${pad(i + 1)}`;
  return {
    id: `SST-${code}`,
    code,
    type: "SHIPPING",
    areaId: shippingArea.id,
    position: [shippingArea.position[0] + offsetX, CONVEYOR_Z + SHIPPING_SLOT_OFFSET_Z],
  };
});

export const products: Product[] = [
  { sku: "SKU-00123", name: "Plastic Container 20L", category: "Container", unit: "PCS" },
  { sku: "SKU-00124", name: "Plastic Container 5L", category: "Container", unit: "PCS" },
  { sku: "SKU-00210", name: "Cardboard Box 40x30", category: "Packaging", unit: "PCS" },
  { sku: "SKU-00311", name: "Stretch Film 50cm", category: "Packaging", unit: "PCS" },
  { sku: "SKU-00405", name: "Pallet Wrap Roll", category: "Packaging", unit: "PCS" },
  { sku: "SKU-00512", name: "Bubble Wrap 1m", category: "Protective", unit: "PCS" },
  { sku: "SKU-00620", name: "Packing Tape 48mm", category: "Supplies", unit: "PCS" },
  { sku: "SKU-00733", name: "Label Sticker A4", category: "Supplies", unit: "PCS" },
];

/** Porsi quantity yang sudah di-reserve, dipilih bergiliran. */
const RESERVED_RATIOS = [0, 0.1, 0.2, 0.15];

export const locations: WarehouseLocation[] = [];
export const inventory: Inventory[] = [];

racks.forEach((rack, rackIndex) => {
  for (let level = 1; level <= rack.levels; level++) {
    for (let slot = 1; slot <= rack.slotsPerLevel; slot++) {
      const code = `${rack.code}-${level}-${pad(slot)}`;
      const location: WarehouseLocation = {
        id: `LOC-${code}`,
        code,
        rackId: rack.id,
        level,
        slot,
        capacity: LOCATION_CAPACITY,
      };
      locations.push(location);

      const pattern = (rackIndex * 5 + level * 7 + slot * 3) % OCCUPANCY_PATTERN.length;
      const quantity = Math.round((LOCATION_CAPACITY * OCCUPANCY_PATTERN[pattern]) / 100);
      if (quantity === 0) continue;

      // Sebagian location berisi 2 SKU (mixed pallet).
      const productIndex = (rackIndex * 3 + level + slot) % products.length;
      const isMixed = pattern % 3 === 0 && quantity >= 60;
      const splits = isMixed
        ? [
            { sku: products[productIndex].sku, quantity: Math.round(quantity * 0.6) },
            { sku: products[(productIndex + 1) % products.length].sku, quantity: quantity - Math.round(quantity * 0.6) },
          ]
        : [{ sku: products[productIndex].sku, quantity }];

      for (const split of splits) {
        const ratio = RESERVED_RATIOS[(level + slot + inventory.length) % RESERVED_RATIOS.length];
        inventory.push({
          id: `INV-${String(inventory.length + 1).padStart(4, "0")}`,
          locationId: location.id,
          sku: split.sku,
          quantity: split.quantity,
          reservedQuantity: Math.round(split.quantity * ratio),
        });
      }
    }
  }
});

// Lookup untuk data master yang tidak berubah. Inventory bisa berubah (movement),
// jadi lookup-nya diturunkan dari store, lihat store/warehouseStore.ts.
export const rackById = new Map(racks.map((r) => [r.id, r]));
export const locationById = new Map(locations.map((l) => [l.id, l]));
export const productBySku = new Map(products.map((p) => [p.sku, p]));
export const locationsByRack = groupBy(locations, (l) => l.rackId);
export const stagingById = new Map(stagingLocations.map((s) => [s.id, s]));
export const packingById = new Map(packingStations.map((s) => [s.id, s]));
/** Semua slot lantai: staging Receiving + packing station + slot Shipping + slot Return. */
export const floorSlots = [...stagingLocations, ...packingStations, ...shippingSlots, ...returnSlots];
export const floorSlotById = new Map(floorSlots.map((s) => [s.id, s]));

export const dockById = new Map(warehouseLayout.docks.map((d) => [d.id, d]));

/** Dock terdekat dengan arah tertentu dari sebuah slot (berdasarkan z), supaya jalur hand pallet pendek. */
export function getNearestDock(slot: FloorSlot, direction: DockDoor["direction"]) {
  const z = slot.position[1];
  return warehouseLayout.docks
    .filter((dock) => dock.direction === direction)
    .reduce((best, dock) => (Math.abs(dock.z - z) < Math.abs(best.z - z) ? dock : best));
}

/** Kode untuk id location rack maupun slot lantai. */
export function getLocationCode(id: string): string {
  return locationById.get(id)?.code ?? floorSlotById.get(id)?.code ?? id;
}
