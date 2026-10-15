import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import type { FloorSlot, PackingOrder } from "@/types/warehouse";
import { PACKER_OFFSET_Z } from "@/data/warehouse";
import { useWarehouseStore } from "@/store/warehouseStore";
import FloorSlotMarker from "./FloorSlotMarker";
import { PARCEL_COLOR } from "./Pallets";
import Worker, { type WorkerMotion } from "./Worker";

// Koordinat lokal station: origin = belt conveyor tempat paket ditaruh (-x = arah belt). Station diputar
// STATION_ROTATION sehingga belt di utara, lokal -z = timur; posisi slot (dunia) = tempat packer berdiri (HOME).
//
// Meja memanjang tegak lurus belt (searah z dunia, seperti meja check-in) dengan ujung menempel di belt.
// Seperti checker check-in, packer berdiri di sisi barat meja dekat belt, menghadap meja (timur); lalu
// menoleh ke kiri menaruh paket di belt (utara), tidak pernah membelakangi conveyor. Checker menyerahkan
// tote dari sisi barat packer.

export const PACKING_COLOR = "#d97706";

/** `length` searah lokal x (tegak lurus belt), `width` searah lokal z. */
const TABLE = { length: 1.6, width: 0.8, height: 0.9 };
/** Ujung meja menempel di tepi belt (belt selebar 0,5 m). */
const TABLE_OFFSET_X = 0.25 + 0.05 + TABLE.length / 2;
/** Meja di sisi -z lokal (timur) packer. */
const TABLE_OFFSET_Z = -(0.35 + TABLE.width / 2);
export const TOTE = { width: 0.45, height: 0.22, depth: 0.32 };
/** Posisi tote di atas meja, di ujung yang jauh dari belt. */
const TOTE_ON_TABLE: [number, number, number] = [
  TABLE_OFFSET_X + 0.45,
  TABLE.height + 0.025 + TOTE.height / 2,
  TABLE_OFFSET_Z,
];

/** Packer berdiri di samping meja, dekat ujung belt. */
const HOME = { x: PACKER_OFFSET_Z, z: 0 };
const FACE_TABLE = Math.PI; // menghadap -z
const FACE_CONVEYOR = -Math.PI / 2; // menghadap -x
const FACE_PICKER = 0; // menghadap +z, checker datang dari sana
/** Checker berdiri sejauh ini dari packer (ke +z lokal) saat serah terima tote. */
const HANDOVER_DISTANCE = 1;
/** Titik masuk station dari lajur checker, di sela packer dan meja station tetangga. */
const ENTRY_DISTANCE = 1.3;

/** Lokal → dunia diputar -90°: lokal -x (belt) = utara, lokal -z (meja) = timur, lokal +z (checker) = barat. */
const STATION_ROTATION = -Math.PI / 2;

/** Titik lokal station (x, z) dalam koordinat dunia. */
function toWorld(station: FloorSlot, x: number, z: number) {
  // Rotasi -90°: lokal (x, z) → (-z, x), relatif terhadap origin belt (HOME.x di utara packer).
  return { x: station.position[0] - z, z: station.position[1] - HOME.x + x };
}

/** Lama serah terima tote dari picker ke packer (detik); tote pindah tangan di tengahnya. */
export const HANDOVER_TIME = 1.2;

/** Titik checker berdiri saat serah terima (koordinat dunia), di barat packer. */
export function getHandoverPoint(station: FloorSlot) {
  return toWorld(station, HOME.x, HOME.z + HANDOVER_DISTANCE);
}

/** Titik masuk station, di barat titik serah terima (koordinat dunia). */
export function getStationEntry(station: FloorSlot) {
  return toWorld(station, HOME.x, HOME.z + ENTRY_DISTANCE);
}

/** Arah hadap checker saat serah terima: ke packer (timur). */
export const HANDOVER_HEADING = Math.PI / 2;

/** Lama mengemas satu PCS: bungkus di meja lalu taruh paket di belt conveyor (detik). */
const PIECE_TIME = 0.5;
/** Porsi PIECE_TIME untuk membungkus di meja; sisanya menaruh paket di conveyor. */
const WRAP_SHARE = 0.6;

type PackerTask =
  | { kind: "handover"; orderId: string; t: number }
  | { kind: "packing"; orderId: string; t: number; packed: number }
  /** Packing order ini sudah dilaporkan selesai ke store; tunggu status berikutnya. */
  | { kind: "done"; orderId: string };

interface PackingStationProps {
  station: FloorSlot;
  /** Order pick & pack yang sedang memakai station ini. */
  order: PackingOrder | undefined;
}

/**
 * Packing station: meja tegak lurus belt conveyor + packer di sampingnya. Packer menerima tote dari
 * checker, menaruhnya di meja, lalu mengemas per PCS: bungkus di meja (1 PCS = 1 paket) dan taruh paket
 * di belt conveyor, yang membawanya ke pallet di Shipping Area (lihat Conveyor.tsx).
 */
export default function PackingStation({ station, order }: PackingStationProps) {
  const workerRef = useRef<Group>(null);
  const handToteRef = useRef<Group>(null);
  const handParcelRef = useRef<Mesh>(null);
  const motion = useRef<WorkerMotion>({ walking: false, holding: false });
  const task = useRef<PackerTask | null>(null);

  useFrame((_, delta) => {
    const worker = workerRef.current;
    if (!worker) return;
    const dt = Math.min(delta, 0.1);

    const pose = (heading: number, holding: boolean, tote: boolean, parcel: boolean) => {
      worker.position.set(HOME.x, 0, HOME.z);
      worker.rotation.y = heading;
      motion.current.walking = false;
      motion.current.holding = holding;
      if (handToteRef.current) handToteRef.current.visible = tote;
      if (handParcelRef.current) handParcelRef.current.visible = parcel;
    };

    // Tugas packer mengikuti status order.
    const current = order && task.current?.orderId === order.id ? task.current : null;
    if (order?.status === "HANDOVER" && current?.kind !== "handover") {
      task.current = { kind: "handover", orderId: order.id, t: 0 };
    } else if (order?.status === "PACKING" && (!current || current.kind === "handover")) {
      // Serah terima selesai: langsung mulai mengemas.
      task.current = { kind: "packing", orderId: order.id, t: 0, packed: order.packedQuantity };
    } else if (order?.status !== "HANDOVER" && order?.status !== "PACKING") {
      task.current = null;
    }

    const t = task.current;
    if (!t || t.kind === "done") {
      pose(FACE_TABLE, false, false, false);
      return;
    }

    if (t.kind === "handover") {
      // Menghadap picker, tangan menerima; tote pindah ke tangan packer di tengah serah terima.
      t.t += dt;
      pose(FACE_PICKER, true, t.t >= HANDOVER_TIME / 2, false);
      return;
    }

    // Packing: bungkus menghadap meja, lalu menoleh ke kiri menaruh paket di belt conveyor.
    t.t += dt;
    const wrapping = t.t < PIECE_TIME * WRAP_SHARE;
    pose(wrapping ? FACE_TABLE : FACE_CONVEYOR, true, false, !wrapping);
    if (t.t >= PIECE_TIME) {
      t.t -= PIECE_TIME;
      t.packed++;
      useWarehouseStore.getState().packOnePiece(t.orderId);
      if (order && t.packed >= order.quantity) task.current = { kind: "done", orderId: t.orderId };
    }
  });

  const status = order?.status;
  const remaining = order ? order.quantity - order.packedQuantity : 0;
  const toteOnTable = status === "PACKING";

  return (
    <FloorSlotMarker slot={station} color={PACKING_COLOR} occupied={!!order} labelPosition={[-0.55, 0.02, 1.2]}>
      <group position={[0, 0, -HOME.x]} rotation={[0, STATION_ROTATION, 0]}>
        <Worker ref={workerRef} motion={motion}>
          {/* Tote yang diterima dari picker */}
          <group ref={handToteRef} position={[0, 0.95, 0.42]} visible={false}>
            <Tote fill={1} />
          </group>
          {/* Paket yang baru dibungkus, dibawa ke belt conveyor */}
          <mesh ref={handParcelRef} position={[0, 1.05, 0.45]} visible={false}>
            <boxGeometry args={[0.26, 0.18, 0.26]} />
            <meshStandardMaterial color={PARCEL_COLOR} />
          </mesh>
        </Worker>

        {/* Meja packing tegak lurus belt, ujungnya menempel di belt */}
        <group position={[TABLE_OFFSET_X, 0, TABLE_OFFSET_Z]}>
          <mesh position={[0, TABLE.height, 0]} castShadow receiveShadow>
            <boxGeometry args={[TABLE.length, 0.05, TABLE.width]} />
            <meshStandardMaterial color="#a16207" />
          </mesh>
          {[-1, 1].flatMap((sx) =>
            [-1, 1].map((sz) => (
              <mesh
                key={`${sx}-${sz}`}
                position={[(sx * (TABLE.length - 0.08)) / 2, TABLE.height / 2, (sz * (TABLE.width - 0.08)) / 2]}
              >
                <boxGeometry args={[0.05, TABLE.height, 0.05]} />
                <meshStandardMaterial color="#44403c" />
              </mesh>
            )),
          )}
          {/* Tumpukan karton/plastik pembungkus (di depan packer) + lakban */}
          <mesh position={[-0.45, TABLE.height + 0.06, 0]}>
            <boxGeometry args={[0.5, 0.08, 0.5]} />
            <meshStandardMaterial color="#c8a165" />
          </mesh>
          <mesh position={[0, TABLE.height + 0.06, -0.2]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 0.05, 16]} />
            <meshStandardMaterial color="#78716c" />
          </mesh>
        </group>

        {/* Tote berisi barang hasil pick; isinya berkurang tiap PCS dikemas. */}
        {toteOnTable && order && (
          <group position={TOTE_ON_TABLE}>
            <Tote fill={remaining / order.quantity} />
          </group>
        )}
      </group>
    </FloorSlotMarker>
  );
}

/** Warna tote dibuat kontras dengan baju pekerja (navy) supaya tetap terlihat saat kosong. */
const TOTE_COLOR = "#22d3ee";
const TOTE_WALL = 0.02;

/** Tote (keranjang plastik terbuka di atas) dengan isi setinggi `fill` (0–1). Origin = tengah tote. */
export function Tote({ fill }: { fill: number }) {
  const { width: w, height: h, depth: d } = TOTE;
  const inner = (h - TOTE_WALL) * 0.9 * Math.max(fill, 0);
  const walls: { position: [number, number, number]; size: [number, number, number] }[] = [
    { position: [0, -h / 2 + TOTE_WALL / 2, 0], size: [w, TOTE_WALL, d] }, // dasar
    { position: [0, 0, d / 2 - TOTE_WALL / 2], size: [w, h, TOTE_WALL] },
    { position: [0, 0, -d / 2 + TOTE_WALL / 2], size: [w, h, TOTE_WALL] },
    { position: [w / 2 - TOTE_WALL / 2, 0, 0], size: [TOTE_WALL, h, d] },
    { position: [-w / 2 + TOTE_WALL / 2, 0, 0], size: [TOTE_WALL, h, d] },
  ];
  return (
    <group>
      {walls.map((wall, i) => (
        <mesh key={i} position={wall.position} castShadow>
          <boxGeometry args={wall.size} />
          <meshStandardMaterial color={TOTE_COLOR} />
        </mesh>
      ))}
      {inner > 0 && (
        <mesh position={[0, -h / 2 + TOTE_WALL + inner / 2, 0]}>
          <boxGeometry args={[w - 2 * TOTE_WALL - 0.01, inner, d - 2 * TOTE_WALL - 0.01]} />
          <meshStandardMaterial color="#d6a96b" />
        </mesh>
      )}
    </group>
  );
}
