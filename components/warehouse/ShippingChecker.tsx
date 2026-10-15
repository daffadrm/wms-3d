import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import { floorSlotById, shippingSlots, warehouseLayout } from "@/data/warehouse";
import { pathLength, pointAlong, type Vec3 } from "@/lib/path";
import { useWarehouseStore } from "@/store/warehouseStore";
import Worker, { WORKER_WALK_SPEED, type WorkerMotion } from "./Worker";

// Semua koordinat di file ini koordinat dunia x/z.
//
// Shipping checker: mengecek pallet paket yang sudah lengkap di slot Shipping (scan per paket)
// sebelum pallet boleh diserahkan ke transporter (dimuat ke truk outbound).

const area = warehouseLayout.areas.find((a) => a.type === "SHIPPING")!;
const SLOT_Z = shippingSlots[0].position[1];

/** Lajur jalan sepanjang sisi selatan pallet; checker berdiri di sini saat scan. */
const LANE_Z = SLOT_Z + 0.95;
/**
 * Standby di ujung timur lajur, di timur slot Shipping paling timur: di luar lorong hand pallet dari
 * dock (lebih ke selatan) dan di barat meja packing.
 */
const HOME = { x: area.position[0] + area.size[0] / 2 - 0.6, z: LANE_Z };

const FACE_WEST = -Math.PI / 2; // menghadap -x, ke arah slot
const FACE_PALLET = Math.PI; // menghadap -z

const WALK_SPEED = WORKER_WALK_SPEED;
/** Lama scan satu paket (detik); lampu scanner menyala di awal tiap scan. */
const CHECK_PIECE_TIME = 0.15;
const SCAN_FLASH_SHARE = 0.4;

const VEST_COLOR = "#0d9488";

type Point = { x: number; z: number };
const toPath = (points: Point[]): Vec3[] => points.map((p) => [p.x, 0, p.z]);

interface CheckTask {
  inventoryId: string;
  stage: "toPallet" | "scanning" | "returning";
  t: number;
  path: Vec3[];
  checked: number;
}

export default function ShippingChecker() {
  const workerRef = useRef<Group>(null);
  const scannerRef = useRef<Group>(null);
  const flashRef = useRef<Mesh>(null);
  const motion = useRef<WorkerMotion>({ walking: false, holding: false });
  const task = useRef<CheckTask | null>(null);

  useFrame((_, delta) => {
    const worker = workerRef.current;
    if (!worker) return;
    const dt = Math.min(delta, 0.1);
    const store = useWarehouseStore.getState();

    const place = (p: Point, heading: number, walking: boolean, scanning: boolean, flash = false) => {
      worker.position.set(p.x, 0, p.z);
      worker.rotation.y = heading;
      motion.current.walking = walking;
      motion.current.holding = scanning;
      if (scannerRef.current) scannerRef.current.visible = scanning;
      if (flashRef.current) flashRef.current.visible = flash;
    };
    /** Jalan sepanjang path; true kalau sudah sampai. */
    const walk = (t: CheckTask) => {
      t.t += dt;
      const along = t.t * WALK_SPEED;
      const { point, direction } = pointAlong(t.path, along);
      place({ x: point[0], z: point[2] }, Math.atan2(direction[0], direction[1]), true, false);
      return along >= pathLength(t.path);
    };

    // Standby: ambil pallet berikutnya yang menunggu dicek (urutan pallet selesai).
    if (!task.current) {
      const check = store.shippingChecks.find(
        (c) => c.status === "PENDING" && store.inventory.some((i) => i.id === c.inventoryId),
      );
      const slot = check && floorSlotById.get(check.slotId);
      if (!check || !slot) {
        place(HOME, FACE_WEST, false, false);
        return;
      }
      store.startShippingCheck(check.inventoryId);
      const route = [HOME, { x: slot.position[0], z: LANE_Z }];
      task.current = { inventoryId: check.inventoryId, stage: "toPallet", t: 0, path: toPath(route), checked: 0 };
    }

    const t = task.current;
    const check = store.shippingChecks.find((c) => c.inventoryId === t.inventoryId);
    if (!check) {
      task.current = null;
      return;
    }

    switch (t.stage) {
      case "toPallet":
        if (walk(t)) Object.assign(t, { stage: "scanning", t: 0 });
        break;

      case "scanning": {
        t.t += dt;
        const end = t.path[t.path.length - 1];
        place({ x: end[0], z: end[2] }, FACE_PALLET, false, true, t.t < CHECK_PIECE_TIME * SCAN_FLASH_SHARE);
        if (t.t < CHECK_PIECE_TIME) break;

        t.t -= CHECK_PIECE_TIME;
        t.checked++;
        store.checkShippingPiece(t.inventoryId);
        if (t.checked >= check.quantity) Object.assign(t, { stage: "returning", t: 0, path: [...t.path].reverse() });
        break;
      }

      case "returning":
        if (walk(t)) task.current = null;
        break;
    }
  });

  return (
    <Worker ref={workerRef} motion={motion} vestColor={VEST_COLOR}>
      {/* Scanner genggam; lampunya menyala tiap paket di-scan. */}
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
  );
}
