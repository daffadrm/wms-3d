import type { Inventory, LocationStatus, Rack, RackFacing, WarehouseLocation } from "@/types/warehouse";

/** Ukuran fisik rack dalam meter. */
export const RACK_DIMENSIONS = {
  slotWidth: 1.4,
  depth: 1.1,
  levelHeight: 1.2,
  postSize: 0.08,
  shelfThickness: 0.06,
} as const;

export const STATUS_COLORS: Record<LocationStatus, string> = {
  EMPTY: "#9ca3af",
  AVAILABLE: "#22c55e",
  ALMOST_FULL: "#eab308",
  FULL: "#ef4444",
};

export const STATUS_LABELS: Record<LocationStatus, string> = {
  EMPTY: "Empty",
  AVAILABLE: "Available",
  ALMOST_FULL: "Almost Full",
  FULL: "Full",
};

export const LOCATION_STATUSES = Object.keys(STATUS_COLORS) as LocationStatus[];

/** Occupancy dalam persen (0–100). */
export function getOccupancy(stock: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return (stock / capacity) * 100;
}

/** 0% EMPTY, ≤70% AVAILABLE, ≤90% ALMOST_FULL, >90% FULL. */
export function getLocationStatus(stock: number, capacity: number): LocationStatus {
  const occupancy = getOccupancy(stock, capacity);
  if (occupancy <= 0) return "EMPTY";
  if (occupancy <= 70) return "AVAILABLE";
  if (occupancy <= 90) return "ALMOST_FULL";
  return "FULL";
}

export function getAvailableQuantity(item: Inventory): number {
  return item.quantity - item.reservedQuantity;
}

/** Total quantity inventory per location. Location tanpa inventory tidak ada di map (stock 0). */
export function getStockByLocation(inventory: Inventory[]): Map<string, number> {
  const stock = new Map<string, number>();
  for (const item of inventory) {
    stock.set(item.locationId, (stock.get(item.locationId) ?? 0) + item.quantity);
  }
  return stock;
}

export function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

export function getRackSize(rack: Rack) {
  return {
    width: rack.slotsPerLevel * RACK_DIMENSIONS.slotWidth,
    height: rack.levels * RACK_DIMENSIONS.levelHeight,
    depth: RACK_DIMENSIONS.depth,
  };
}

/** Posisi x tengah slot, relatif terhadap pusat rack. */
export function getSlotX(rack: Rack, slot: number): number {
  const { width } = getRackSize(rack);
  return -width / 2 + (slot - 0.5) * RACK_DIMENSIONS.slotWidth;
}

/** Tinggi permukaan papan (tempat pallet diletakkan) di sebuah level. */
export function getLevelFloorY(level: number): number {
  return (level - 1) * RACK_DIMENSIONS.levelHeight + RACK_DIMENSIONS.shelfThickness;
}

const FACING_ROTATION: Record<RackFacing, number> = {
  SOUTH: 0,
  NORTH: Math.PI,
  WEST: -Math.PI / 2,
  EAST: Math.PI / 2,
};

/** Rotasi rack terhadap sumbu y. Model rack lokal: slot berjajar searah +x, sisi depan menghadap +z. */
export function getRackRotation(rack: Rack): number {
  return FACING_ROTATION[rack.facing];
}

type Vec2 = [x: number, z: number];

/**
 * Vektor satuan dunia (x, z) rack: `along` = arah slot 1 → slot terakhir, `front` = arah sisi depan.
 */
export function getRackAxes(rack: Rack): { along: Vec2; front: Vec2 } {
  const t = getRackRotation(rack);
  const r = (v: number) => Math.round(v * 1e9) / 1e9;
  return { along: [r(Math.cos(t)), r(-Math.sin(t))], front: [r(Math.sin(t)), r(Math.cos(t))] };
}

/** Batas rack di lantai (koordinat dunia). */
export function getRackFootprint(rack: Rack) {
  const { width, depth } = getRackSize(rack);
  const { along } = getRackAxes(rack);
  const [x, z] = rack.position;
  const halfX = Math.abs(along[0]) * (width / 2) + Math.abs(along[1]) * (depth / 2);
  const halfZ = Math.abs(along[1]) * (width / 2) + Math.abs(along[0]) * (depth / 2);
  return { west: x - halfX, east: x + halfX, north: z - halfZ, south: z + halfZ };
}

/** Titik tengah-bawah slot dalam koordinat dunia. */
export function getSlotWorldPosition(
  rack: Rack,
  location: WarehouseLocation,
): [x: number, y: number, z: number] {
  const offset = getSlotX(rack, location.slot);
  const { along } = getRackAxes(rack);
  return [
    rack.position[0] + along[0] * offset,
    getLevelFloorY(location.level),
    rack.position[1] + along[1] * offset,
  ];
}
