import type { FloorSlot, Inventory, InventoryMovement, Rack, WarehouseLocation } from "@/types/warehouse";
import { RACK_DIMENSIONS, getLevelFloorY, getRackAxes, getRackFootprint, getSlotWorldPosition } from "./warehouse";

export const MOVEMENT_STATUS_LABELS: Record<InventoryMovement["status"], string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
};

export const MOVEMENT_TYPE_LABELS: Record<InventoryMovement["type"], string> = {
  PUTAWAY: "Putaway",
  TRANSFER: "Transfer",
};

export function isActiveMovement(movement: InventoryMovement): boolean {
  return movement.status !== "COMPLETED";
}

/** Quantity yang sedang dalam perjalanan menuju tiap location (kapasitasnya sudah "dipesan"). */
export function getIncomingByLocation(movements: InventoryMovement[]): Map<string, number> {
  const incoming = new Map<string, number>();
  for (const m of movements) {
    if (!isActiveMovement(m)) continue;
    incoming.set(m.toLocationId, (incoming.get(m.toLocationId) ?? 0) + m.quantity);
  }
  return incoming;
}

/** Sisa kapasitas setelah dikurangi stock dan barang yang sedang menuju ke sini. */
export function getFreeCapacity(location: WarehouseLocation, stock: number, incoming: number): number {
  return location.capacity - stock - incoming;
}

/** Location bisa jadi tujuan kalau bukan location asal dan sisa kapasitasnya cukup. */
export function canReceive(
  location: WarehouseLocation,
  item: Inventory,
  stock: number,
  incoming: number,
): boolean {
  return location.id !== item.locationId && getFreeCapacity(location, stock, incoming) >= item.quantity;
}

// ---------------------------------------------------------------------------
// Rute forklift
//
// Pose forklift = titik tengah pallet di atas fork. Sudut `heading` 0 berarti fork
// menghadap -z (menghadap sisi depan rack yang menghadap +z). Forklift hanya bergerak di:
// - "travel line" tiap rack: garis sejajar rack, di aisle depan rack,
// - "corridor": jalur sepanjang z di ujung kanan semua rack,
// - lajur akses (`rack.accessZ`) dari corridor ke travel line rack yang menghadap barat/timur.
// ---------------------------------------------------------------------------

export interface ForkliftPose {
  x: number;
  z: number;
  heading: number;
  /** Tinggi fork dari lantai. */
  lift: number;
}

/** pick/drop = ambil/taruh pallet; hold = pallet let-down sudah ditahan rendah, siap diambil picker. */
export type ForkliftEvent = "pick" | "drop" | "hold";

export interface ForkliftKeyframe extends ForkliftPose {
  /** Detik untuk bergerak dari keyframe sebelumnya ke keyframe ini. */
  duration: number;
  /** Dipicu saat keyframe ini tercapai. */
  event?: ForkliftEvent;
}

const SPEED = {
  drive: 3.5, // m/s
  approach: 1, // m/s, saat masuk/keluar rack
  lift: 1.2, // m/s
  turn: Math.PI / 1.5, // rad/s
};

/** Heading forklift yang fork-nya menghadap sisi depan rack (fork menghadap (-sin h, -cos h)). */
function faceRack(rack: Rack): number {
  const [fx, fz] = getRackAxes(rack).front;
  return Math.atan2(fx, fz);
}

/** Arah hadap picker ke sisi depan rack saat mengambil barang (rotasi worker, menghadap (sin h, cos h)). */
export function getPickerRackHeading(rack: Rack): number {
  const [fx, fz] = getRackAxes(rack).front;
  return Math.atan2(-fx, -fz);
}

type Point = { x: number; z: number };

/** Titik di depan slot sejauh `distance` dari garis tengah rack, searah sisi depan rack. */
function inFrontOf(rack: Rack, location: WarehouseLocation, distance: number): Point {
  const [x, , z] = getSlotWorldPosition(rack, location);
  const [fx, fz] = getRackAxes(rack).front;
  return { x: x + fx * distance, z: z + fz * distance };
}

/** Rack memanjang searah z (menghadap barat/timur): aisle depannya dicapai lewat lajur akses. */
const isSideFacing = (rack: Rack) => rack.facing === "WEST" || rack.facing === "EAST";

/** Fork sedikit di atas papan supaya masuk ke celah pallet. */
export const FORK_ENTRY = 0.05;
/** Ketinggian ekstra saat pallet terangkat. */
const FORK_RAISE = 0.15;
export const FORK_REST = 0.1;
const FORK_CARRY = FORK_ENTRY + FORK_RAISE;

/** Jarak travel line dari tengah rack. Body forklift (1,85 m di belakang fork) harus muat di aisle. */
const TRAVEL_OFFSET = RACK_DIMENSIONS.depth / 2 + 0.65;
const CORRIDOR_MARGIN = 1.5;
/** Aisle utama di antara Zone A dan Zone B, lurus dari corridor ke sisi barat gudang. */
const CENTRAL_AISLE_Z = 0;
/** Jarak pose forklift dari tengah pallet di lantai sebelum fork masuk. */
const FLOOR_APPROACH = 1.3;

export function getCorridorX(racks: Rack[]): number {
  return Math.max(...racks.map((r) => getRackFootprint(r).east)) + CORRIDOR_MARGIN;
}

/** Jarak lajur parkir utara dari sisi belakang rack paling utara. */
const BACK_PARKING_GAP = 1.5;
/** Jarak lajur parkir selatan dari sisi depan rack paling selatan: di luar lajur forklift & picker aisle itu. */
const SOUTH_PARKING_GAP = 4.35;

/**
 * Parkir forklift ke-`index` di ujung lajur yang lurus dari corridor, satu lajur per forklift supaya
 * tidak saling menghalangi. Bukan di aisle tengah, karena itu lajur picker ke Zone C.
 * - lorong di belakang (utara) Zone A, di barat ujung rack: di selatan lorong hand pallet ke Shipping;
 * - lorong di selatan Zone B, di sisi timur (ujung fork 0,5 m di depan pose) masih di dalam blok
 *   Zone A/B, jauh dari tangga timur mezzanine & tempat standby picker.
 * Fork menghadap corridor (timur) supaya langsung bisa keluar; masuknya mundur dari corridor.
 */
export function getHomePose(racks: Rack[], index = 0): ForkliftPose {
  // Blok rack yang ujung timurnya di corridor (Zone A/B).
  const corridorX = getCorridorX(racks);
  const main = racks.map(getRackFootprint).filter((f) => f.east + CORRIDOR_MARGIN >= corridorX - 1e-6);
  const westMost = Math.min(...main.map((f) => f.west));
  const backMost = Math.min(...main.map((f) => f.north));
  const frontMost = Math.max(...main.map((f) => f.south));
  const lanes = [
    { x: westMost - 1.5, z: backMost - BACK_PARKING_GAP },
    { x: westMost + 3.5, z: frontMost + SOUTH_PARKING_GAP },
  ];
  const lane = lanes[index % lanes.length];
  return {
    ...lane,
    heading: -Math.PI / 2, // fork menghadap +x (corridor)
    lift: FORK_REST,
  };
}

// ---------------------------------------------------------------------------
// Rute pejalan kaki (picker). Dipisah dari jalur forklift sebisa mungkin:
// - walkway sejajar corridor forklift, di sisi timurnya;
// - di aisle lewat sisi seberang dari rack yang diambil (lajur forklift ada di dekat rack),
//   baru mendekat ke rack saat mengambil barang.
// Di titik persilangan, siapa yang mengalah diatur lib/traffic.ts.
// ---------------------------------------------------------------------------

const WALKWAY_OFFSET = 1.4;
/** Lajur pejalan kaki di aisle, diukur dari tengah rack (forklift di ±1,2 m, rack berikutnya mulai 3,25 m). */
const PICKER_FAR_OFFSET = RACK_DIMENSIONS.depth / 2 + 1.95;
/** Titik berdiri saat mengambil barang: tepat di depan rack. */
const PICKER_PICK_OFFSET = RACK_DIMENSIONS.depth / 2 + 0.35;
/** Lajur picker ke rack yang menghadap barat/timur: sejajar lajur akses forklift, di selatannya. */
const PICKER_ACCESS_OFFSET = PICKER_FAR_OFFSET - TRAVEL_OFFSET;

/**
 * Titik-titik dari walkway ke lajur jauh aisle depan rack di titik `far`: rack menghadap utara/selatan
 * langsung sepanjang aisle; rack menghadap barat/timur lewat lajur picker di samping lajur akses.
 */
function walkwayToAisle(rack: Rack, walkwayX: number, far: Point): Point[] {
  if (!isSideFacing(rack)) return [{ x: walkwayX, z: far.z }];
  const laneZ = rack.accessZ! + PICKER_ACCESS_OFFSET;
  return [
    { x: walkwayX, z: laneZ },
    { x: far.x, z: laneZ },
  ];
}

export function getWalkwayX(racks: Rack[]): number {
  return getCorridorX(racks) + WALKWAY_OFFSET;
}

/** Jarak baris standby picker dari dinding selatan, dan jarak antar picker di baris itu. */
const PICKER_STANDBY_WALL_GAP = 1.2;
const PICKER_STANDBY_SPACING = 0.9;

/**
 * Tempat standby picker (orang inventory): berjajar di pinggir, ujung selatan walkway dekat dinding
 * selatan (`depth` = kedalaman gudang), supaya tidak menghalangi walkway & aisle tengah.
 */
export function getPickerHomes(racks: Rack[], depth: number, count: number): { x: number; z: number }[] {
  const walkwayX = getWalkwayX(racks);
  const z = depth / 2 - PICKER_STANDBY_WALL_GAP;
  return Array.from({ length: count }, (_, i) => ({ x: walkwayX + i * PICKER_STANDBY_SPACING, z }));
}

/**
 * Rute dari `from` ke `to` lewat walkway: ke walkway di z `from`, sepanjang walkway, lalu ke `to`.
 * `via` = titik-titik tambahan sebelum `to` (mis. lajur masuk station).
 */
export function buildWalkwayRoute(
  racks: Rack[],
  from: { x: number; z: number },
  to: { x: number; z: number },
  via: { x: number; z: number }[] = [],
): { x: number; z: number }[] {
  const walkwayX = getWalkwayX(racks);
  const firstVia = via[0] ?? to;
  return [from, { x: walkwayX, z: from.z }, { x: walkwayX, z: firstVia.z }, ...via, to];
}

/**
 * Rute jalan kaki picker (koordinat dunia x/z) dari `exit` ke depan slot rack:
 * ke walkway, sepanjang walkway ke aisle, sepanjang sisi seberang aisle, lalu maju ke depan slot.
 */
export function buildPickerRoute(
  racks: Rack[],
  exit: { x: number; z: number },
  rack: Rack,
  location: WarehouseLocation,
): { x: number; z: number }[] {
  const walkwayX = getWalkwayX(racks);
  const far = inFrontOf(rack, location, PICKER_FAR_OFFSET);
  return [
    exit,
    { x: walkwayX, z: exit.z },
    ...walkwayToAisle(rack, walkwayX, far),
    far,
    inFrontOf(rack, location, PICKER_PICK_OFFSET),
  ];
}

/** Selisih sudut terpendek dari `from` ke `to`, dalam rentang [-π, π]. */
export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** Asal/tujuan movement: slot di rack, atau slot di lantai (staging Receiving / packing station). */
export type MovementEndpoint =
  | { kind: "rack"; rack: Rack; location: WarehouseLocation }
  | { kind: "floor"; slot: FloorSlot };

/** Tinggi fork saat menahan pallet let-down: tumpukan box setinggi pinggang picker. */
const FORK_LET_DOWN = 0.3;

/** Kumpulan langkah forklift yang dirangkai jadi keyframe, mulai dari pose `start`. */
function createTimeline(start: ForkliftPose, racks: Rack[]) {
  const corridorX = getCorridorX(racks);
  const keyframes: ForkliftKeyframe[] = [];
  let current = { ...start };

  const push = (next: Partial<ForkliftPose>, options: { speed?: number; event?: ForkliftEvent } = {}) => {
    const pose = { ...current, ...next };
    const distance = Math.hypot(pose.x - current.x, pose.z - current.z);
    const duration = Math.max(
      distance / (options.speed ?? SPEED.drive),
      Math.abs(angleDelta(current.heading, pose.heading)) / SPEED.turn,
      Math.abs(pose.lift - current.lift) / SPEED.lift,
      0.1,
    );
    keyframes.push({ ...pose, duration, event: options.event });
    current = pose;
  };

  /** Heading tujuan, dinyatakan relatif ke heading sekarang supaya berputar lewat sisi terpendek. */
  const turnTo = (heading: number) => current.heading + angleDelta(current.heading, heading);

  /** Putar menghadap tujuan, lalu jalan lurus. */
  const driveTo = (x: number, z: number) => {
    if (Math.hypot(x - current.x, z - current.z) < 0.01) return;
    push({ heading: turnTo(Math.atan2(-(x - current.x), -(z - current.z))) });
    push({ x, z });
  };

  /**
   * Ambil/taruh pallet di lantai. Fork masuk sejajar sumbu x:
   * - slot di timur corridor (staging Receiving & slot Return): didekati langsung dari corridor,
   *   forklift menghadap +x;
   * - slot di barat rack: didekati dari timur lewat aisle tengah, menghadap -x.
   */
  const serviceFloorSlot = (slot: FloorSlot, event: ForkliftEvent) => {
    const [slotX, slotZ] = slot.position;
    const fromWest = slotX > corridorX;
    const approachX = fromWest ? slotX - FLOOR_APPROACH : slotX + FLOOR_APPROACH;

    if (fromWest) {
      driveTo(corridorX, slotZ);
    } else {
      driveTo(corridorX, CENTRAL_AISLE_Z);
      driveTo(approachX, CENTRAL_AISLE_Z);
    }
    driveTo(approachX, slotZ);
    push({ heading: turnTo(fromWest ? -Math.PI / 2 : Math.PI / 2) });

    if (event === "pick") {
      push({ lift: FORK_ENTRY });
      push({ x: slotX }, { speed: SPEED.approach, event: "pick" });
      push({ lift: FORK_CARRY });
      push({ x: approachX }, { speed: SPEED.approach });
    } else {
      push({ lift: FORK_CARRY });
      push({ x: slotX }, { speed: SPEED.approach });
      push({ lift: FORK_ENTRY }, { event: "drop" });
      push({ x: approachX }, { speed: SPEED.approach });
      push({ lift: FORK_REST });
    }

    if (fromWest) {
      driveTo(corridorX, slotZ);
    } else {
      driveTo(approachX, CENTRAL_AISLE_Z);
      driveTo(corridorX, CENTRAL_AISLE_Z);
    }
  };

  /** Dari corridor ke titik travel line di depan slot (lewat lajur akses untuk rack menghadap barat/timur). */
  const toTravel = (rack: Rack, travel: Point) => {
    if (isSideFacing(rack)) {
      driveTo(corridorX, rack.accessZ!);
      driveTo(travel.x, rack.accessZ!);
    } else {
      driveTo(corridorX, travel.z);
    }
    driveTo(travel.x, travel.z);
  };

  /** Kebalikan toTravel: dari travel line kembali ke corridor. */
  const fromTravel = (rack: Rack, travel: Point) => {
    if (isSideFacing(rack)) {
      driveTo(travel.x, rack.accessZ!);
      driveTo(corridorX, rack.accessZ!);
    } else {
      driveTo(corridorX, travel.z);
    }
  };

  const serviceSlot = (rack: Rack, location: WarehouseLocation, event: ForkliftEvent) => {
    const [slotX, , slotZ] = getSlotWorldPosition(rack, location);
    const floorY = getLevelFloorY(location.level);
    const travel = inFrontOf(rack, location, TRAVEL_OFFSET);

    toTravel(rack, travel);
    push({ heading: turnTo(faceRack(rack)) }); // menghadap rack

    if (event === "pick") {
      push({ lift: floorY + FORK_ENTRY });
      push({ x: slotX, z: slotZ }, { speed: SPEED.approach, event: "pick" });
      push({ lift: floorY + FORK_CARRY });
      push(travel, { speed: SPEED.approach }); // mundur keluar rack
      push({ lift: FORK_CARRY });
    } else {
      push({ lift: floorY + FORK_CARRY });
      push({ x: slotX, z: slotZ }, { speed: SPEED.approach });
      push({ lift: floorY + FORK_ENTRY }, { event: "drop" });
      push(travel, { speed: SPEED.approach });
      push({ lift: FORK_REST });
    }

    fromTravel(rack, travel);
  };

  const service = (endpoint: MovementEndpoint, event: ForkliftEvent) => {
    if (endpoint.kind === "floor") serviceFloorSlot(endpoint.slot, event);
    else serviceSlot(endpoint.rack, endpoint.location, event);
  };

  /**
   * Let-down: ambil pallet dari rack, mundur ke travel line, lalu turunkan fork setinggi pinggang
   * dan tahan di aisle depan rack. Berakhir dengan event "hold"; forklift diam sampai picker selesai.
   */
  const letDown = (rack: Rack, location: WarehouseLocation) => {
    const [slotX, , slotZ] = getSlotWorldPosition(rack, location);
    const floorY = getLevelFloorY(location.level);
    const travel = inFrontOf(rack, location, TRAVEL_OFFSET);

    toTravel(rack, travel);
    push({ heading: turnTo(faceRack(rack)) }); // menghadap rack
    push({ lift: floorY + FORK_ENTRY });
    push({ x: slotX, z: slotZ }, { speed: SPEED.approach, event: "pick" });
    push({ lift: floorY + FORK_CARRY });
    push(travel, { speed: SPEED.approach }); // mundur keluar rack
    push({ lift: FORK_LET_DOWN }, { event: "hold" });
  };

  /** Lanjutan let-down: naikkan lagi pallet yang sedang ditahan, kembalikan ke slot-nya, ke corridor. */
  const putBack = (rack: Rack, location: WarehouseLocation) => {
    const [slotX, , slotZ] = getSlotWorldPosition(rack, location);
    const floorY = getLevelFloorY(location.level);
    const travel = inFrontOf(rack, location, TRAVEL_OFFSET);

    push({ lift: floorY + FORK_CARRY });
    push({ x: slotX, z: slotZ }, { speed: SPEED.approach });
    push({ lift: floorY + FORK_ENTRY }, { event: "drop" });
    push(travel, { speed: SPEED.approach });
    push({ lift: FORK_REST });
    fromTravel(rack, travel);
  };

  /** Pulang: putar di titik yang lega, lalu mundur lurus ke parkir (fork menghadap ke dalam gudang). */
  /** Pulang: lewat corridor ke baris parkirnya, putar menghadap corridor, lalu mundur lurus ke parkir. */
  const goHome = (home: ForkliftPose) => {
    driveTo(corridorX, home.z);
    push({ heading: turnTo(home.heading) });
    push({ x: home.x, z: home.z });
  };

  /** Dari parkir (di belakang rack) maju lurus ke corridor dulu, supaya tidak memotong ujung rack. */
  const leaveHome = () => driveTo(corridorX, current.z);

  return { keyframes, service, letDown, putBack, goHome, leaveHome };
}

/** Pindahkan satu pallet dari `source` ke `target`, lalu pulang ke `home`. */
export function buildMovementTimeline(
  start: ForkliftPose,
  racks: Rack[],
  source: MovementEndpoint,
  target: MovementEndpoint,
  home: ForkliftPose,
): ForkliftKeyframe[] {
  const timeline = createTimeline(start, racks);
  // Setiap service mulai dan berakhir di corridor, jadi bisa dirangkai bebas.
  timeline.leaveHome();
  timeline.service(source, "pick");
  timeline.service(target, "drop");
  timeline.goHome(home);
  return timeline.keyframes;
}

/** Let-down tahap 1: ambil pallet di rack level atas dan tahan rendah di aisle (berakhir di event "hold"). */
export function buildLetDownTimeline(
  start: ForkliftPose,
  racks: Rack[],
  rack: Rack,
  location: WarehouseLocation,
): ForkliftKeyframe[] {
  const timeline = createTimeline(start, racks);
  timeline.leaveHome();
  timeline.letDown(rack, location);
  return timeline.keyframes;
}

/** Let-down tahap 2: kembalikan pallet yang ditahan ke rack, lalu pulang ke `home`. */
export function buildPutBackTimeline(
  start: ForkliftPose,
  racks: Rack[],
  rack: Rack,
  location: WarehouseLocation,
  home: ForkliftPose,
): ForkliftKeyframe[] {
  const timeline = createTimeline(start, racks);
  timeline.putBack(rack, location);
  timeline.goHome(home);
  return timeline.keyframes;
}

/**
 * Picker berdiri di samping pallet let-down yang ditahan forklift, bergeser searah urutan slot (ke sisi
 * corridor / lajur akses), menghadap pallet.
 */
const LET_DOWN_PICKER_OFFSET = 0.95;

/** Arah hadap picker ke pallet let-down yang ditahan forklift (rotasi worker). */
export function getLetDownPickHeading(rack: Rack): number {
  const [ax, az] = getRackAxes(rack).along;
  return Math.atan2(-ax, -az);
}
/**
 * Titik tunggu picker di timur walkway, sejajar lajur jauh aisle: di luar jarak aman forklift yang
 * berbelok dari corridor ke aisle, supaya forklift tidak berhenti mengalah ke picker yang menunggu.
 */
const LET_DOWN_WAIT_OFFSET_X = 1.5;

/**
 * Rute picker untuk let-down (koordinat dunia x/z), dua bagian:
 * - `toWait`: dari `exit` lewat walkway ke titik tunggu di depan aisle, sampai forklift menahan pallet;
 * - `toPick`: dari titik tunggu, sepanjang sisi seberang aisle, lalu ke samping pallet yang ditahan.
 */
export function buildLetDownPickerRoute(
  racks: Rack[],
  exit: { x: number; z: number },
  rack: Rack,
  location: WarehouseLocation,
): { toWait: { x: number; z: number }[]; toPick: { x: number; z: number }[] } {
  const walkwayX = getWalkwayX(racks);
  const [ax, az] = getRackAxes(rack).along;
  const shift = (p: Point): Point => ({ x: p.x + ax * LET_DOWN_PICKER_OFFSET, z: p.z + az * LET_DOWN_PICKER_OFFSET });
  const far = shift(inFrontOf(rack, location, PICKER_FAR_OFFSET));
  const pick = shift(inFrontOf(rack, location, TRAVEL_OFFSET));
  // Titik tunggu di timur walkway, sejajar lajur yang menuju aisle.
  const [toAisle, ...inAisle] = walkwayToAisle(rack, walkwayX, far);
  const wait = { x: walkwayX + LET_DOWN_WAIT_OFFSET_X, z: toAisle.z };
  return {
    toWait: [exit, { x: walkwayX, z: exit.z }, toAisle, wait],
    toPick: [wait, ...inAisle, far, pick],
  };
}
