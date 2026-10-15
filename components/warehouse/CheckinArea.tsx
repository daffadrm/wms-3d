import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import type { PackingOrder } from "@/types/warehouse";
import { packingById, packingStations, warehouseLayout } from "@/data/warehouse";
import { pathLength, pointAlong, type Vec3 } from "@/lib/path";
import { useWarehouseStore } from "@/store/warehouseStore";
import {
  HANDOVER_HEADING,
  HANDOVER_TIME,
  TOTE,
  Tote,
  getHandoverPoint,
  getStationEntry,
} from "./PackingStation";
import Worker, { WORKER_WALK_SPEED, type WorkerMotion } from "./Worker";

// Semua koordinat di file ini koordinat dunia x/z.

const area = warehouseLayout.areas.find((a) => a.type === "CHECKIN")!;
const [AREA_X, AREA_Z] = area.position;

/** Meja check-in memanjang searah z, tepat di barat ujung utara walkway picker. */
const DESK = { x: AREA_X - 0.5, z: AREA_Z, length: 3.2, depth: 0.5, height: 0.9 };
/** Satu tempat tote di meja per packing station (urutan sama dengan packingStations). */
const DESK_SLOT_SPACING = 1;
const TOTE_Y = DESK.height + 0.025 + TOTE.height / 2;
/**
 * Picker datang dari walkway di sisi timur meja, checker berdiri di sisi barat (ke arah Packing),
 * jadi keduanya tidak berpapasan.
 */
const PICKER_SIDE_X = DESK.x + 0.55;
const CHECKER_SIDE_X = DESK.x - 0.65;
const CHECKER_HOME = { x: CHECKER_SIDE_X, z: DESK.z };
/** Checker ke packing station lewat lajur di selatan meja-meja packing. */
const PACKING_LANE_Z = AREA_Z + 0.35;

const FACE_EAST = Math.PI / 2; // menghadap +x
const FACE_WEST = -Math.PI / 2; // menghadap -x

const WALK_SPEED = WORKER_WALK_SPEED;
/** Lama scan satu PCS (detik); lampu scanner menyala di awal tiap scan. */
const CHECK_PIECE_TIME = 0.25;
const SCAN_FLASH_SHARE = 0.35;

const CHECKER_VEST = "#7c3aed";

/** Z tempat tote di meja untuk order yang memakai packing station `stationId`. */
function getDeskSlotZ(stationId: string): number {
  const index = Math.max(packingStations.findIndex((s) => s.id === stationId), 0);
  return DESK.z + (index - (packingStations.length - 1) / 2) * DESK_SLOT_SPACING;
}

/** Titik picker berdiri saat menaruh tote di meja check-in. */
export function getCheckinDropPoint(stationId: string) {
  return { x: PICKER_SIDE_X, z: getDeskSlotZ(stationId) };
}
export const CHECKIN_DROP_HEADING = FACE_WEST;

type Point = { x: number; z: number };
const toPath = (points: Point[]): Vec3[] => points.map((p) => [p.x, 0, p.z]);

interface CheckerTask {
  orderId: string;
  stage: "toDesk" | "checking" | "toPacking" | "handover" | "returning";
  t: number;
  path: Vec3[];
  checked: number;
}

/**
 * Check-in Area: meja + checker. Picker menaruh tote berisi barang hasil pick di meja; checker
 * scan per PCS, lalu mengantar tote ke packing station dan menyerahkannya ke packer.
 */
export default function CheckinArea() {
  const packingOrders = useWarehouseStore((s) => s.packingOrders);
  const workerRef = useRef<Group>(null);
  const toteRef = useRef<Group>(null);
  const scannerRef = useRef<Group>(null);
  const flashRef = useRef<Mesh>(null);
  const motion = useRef<WorkerMotion>({ walking: false, holding: false });
  const task = useRef<CheckerTask | null>(null);

  useFrame((_, delta) => {
    const worker = workerRef.current;
    if (!worker) return;
    const dt = Math.min(delta, 0.1);
    const store = useWarehouseStore.getState();

    const place = (p: Point, heading: number, walking: boolean, tote: boolean, scanning: boolean, flash = false) => {
      worker.position.set(p.x, 0, p.z);
      worker.rotation.y = heading;
      motion.current.walking = walking;
      motion.current.holding = tote || scanning;
      if (toteRef.current) toteRef.current.visible = tote;
      if (scannerRef.current) scannerRef.current.visible = scanning;
      if (flashRef.current) flashRef.current.visible = flash;
    };
    /** Jalan sepanjang path; true kalau sudah sampai. */
    const walk = (t: CheckerTask, tote: boolean) => {
      t.t += dt;
      const along = t.t * WALK_SPEED;
      const { point, direction } = pointAlong(t.path, along);
      place({ x: point[0], z: point[2] }, Math.atan2(direction[0], direction[1]), true, tote, false);
      return along >= pathLength(t.path);
    };

    // Standby: ambil tote berikutnya yang menunggu di meja (urutan order masuk).
    if (!task.current) {
      const order = store.packingOrders.find((o) => o.status === "AT_CHECKIN");
      if (!order) {
        place(CHECKER_HOME, FACE_EAST, false, false, false);
        return;
      }
      store.startChecking(order.id);
      const slot = { x: CHECKER_SIDE_X, z: getDeskSlotZ(order.stationId) };
      task.current = { orderId: order.id, stage: "toDesk", t: 0, path: toPath([CHECKER_HOME, slot]), checked: 0 };
    }

    const t = task.current;
    const order = store.packingOrders.find((o) => o.id === t.orderId);
    const station = order && packingById.get(order.stationId);
    if (!order || !station) {
      task.current = null;
      return;
    }

    switch (t.stage) {
      case "toDesk":
        if (walk(t, false)) Object.assign(t, { stage: "checking", t: 0 });
        break;

      case "checking": {
        t.t += dt;
        const end = t.path[t.path.length - 1];
        place({ x: end[0], z: end[2] }, FACE_EAST, false, false, true, t.t < CHECK_PIECE_TIME * SCAN_FLASH_SHARE);
        if (t.t < CHECK_PIECE_TIME) break;

        t.t -= CHECK_PIECE_TIME;
        t.checked++;
        store.checkOnePiece(t.orderId);
        if (t.checked < order.quantity) break;

        // Semua PCS cocok: bawa tote ke packing station lewat lajur di selatan meja packing.
        store.startToPacking(t.orderId);
        const entry = getStationEntry(station);
        const route = [
          { x: end[0], z: end[2] },
          { x: end[0], z: PACKING_LANE_Z },
          { x: entry.x, z: PACKING_LANE_Z },
          entry,
          getHandoverPoint(station),
        ];
        Object.assign(t, { stage: "toPacking", t: 0, path: toPath(route) });
        break;
      }

      case "toPacking":
        if (walk(t, true)) {
          store.startHandover(t.orderId);
          Object.assign(t, { stage: "handover", t: 0 });
        }
        break;

      case "handover": {
        t.t += dt;
        const end = t.path[t.path.length - 1];
        // Tote pindah ke tangan packer di tengah serah terima.
        place({ x: end[0], z: end[2] }, HANDOVER_HEADING, false, t.t < HANDOVER_TIME / 2, false);
        if (t.t < HANDOVER_TIME) break;

        store.deliverPackingOrder(t.orderId);
        Object.assign(t, { stage: "returning", t: 0, path: [...t.path].reverse().concat(toPath([CHECKER_HOME])) });
        break;
      }

      case "returning":
        if (walk(t, false)) task.current = null;
        break;
    }
  });

  // Tote yang sedang menunggu / sedang di-scan ada di atas meja.
  const totesOnDesk = packingOrders.filter((o) => o.status === "AT_CHECKIN" || o.status === "CHECKING");

  return (
    <group>
      {/* Meja check-in */}
      <mesh position={[DESK.x, DESK.height, DESK.z]} castShadow receiveShadow>
        <boxGeometry args={[DESK.depth, 0.05, DESK.length]} />
        <meshStandardMaterial color="#64748b" />
      </mesh>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}-${sz}`}
            position={[DESK.x + (sx * (DESK.depth - 0.1)) / 2, DESK.height / 2, DESK.z + (sz * (DESK.length - 0.1)) / 2]}
          >
            <boxGeometry args={[0.05, DESK.height, 0.05]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
        )),
      )}

      {totesOnDesk.map((o: PackingOrder) => (
        <group key={o.id} position={[DESK.x, TOTE_Y, getDeskSlotZ(o.stationId)]}>
          <Tote fill={1} />
        </group>
      ))}

      <Worker ref={workerRef} motion={motion} vestColor={CHECKER_VEST}>
        <group ref={toteRef} position={[0, 0.95, 0.42]} visible={false}>
          <Tote fill={1} />
        </group>
        {/* Scanner genggam di tangan kanan; lampunya menyala tiap PCS di-scan. */}
        <group ref={scannerRef} position={[0.2, 1.1, 0.5]} visible={false}>
          <mesh>
            <boxGeometry args={[0.07, 0.05, 0.16]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          <mesh ref={flashRef} position={[0, 0, 0.085]}>
            <boxGeometry args={[0.05, 0.02, 0.01]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={2} />
          </mesh>
        </group>
      </Worker>
    </group>
  );
}
