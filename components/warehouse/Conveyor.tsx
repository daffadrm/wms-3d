import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BoxGeometry, MeshStandardMaterial, Object3D, type InstancedMesh } from "three";
import type { FloorSlot, PackingDestination } from "@/types/warehouse";
import { CONVEYOR_Z, SAMEDAY_COUNTER, floorSlotById, packingById, packingStations, shippingSlots } from "@/data/warehouse";
import { pathLength, pointAlong, type Vec3 } from "@/lib/path";
import { useWarehouseStore } from "@/store/warehouseStore";
import { FLOOR_PALLET_ROTATION, PARCEL_COLOR, getParcelOffset } from "./Pallets";
import { COUNTER_DESK, getCounterParcelPoint } from "./SamedayCounter";

// Semua koordinat di file ini koordinat dunia.
//
// Conveyor paket setinggi meja, satu belt lurus di sepanjang dinding utara (z = CONVEYOR_Z), mengalir
// dari timur ke barat:
// - packing station di selatan belt; packer menaruh paket langsung di belt;
// - slot Shipping di selatan belt; di tiap slot ada transfer dari belt ke pallet;
// - ujung barat belt menempel di tepi dalam meja loket Sameday (paket order sameday, diambil Gojek).
// Check-in Area ada di timur awal belt, jadi picker & checker tidak menyeberangi conveyor;
// hand pallet outbound mengambil pallet dari sisi selatan slot.

const BELT_WIDTH = 0.5;
/** Awal belt (timur) sedikit melewati packing station paling timur. */
const LINE_START_X = Math.max(...packingStations.map((s) => s.position[0])) + 0.5;
/** Ujung belt (barat) di ujung barat meja loket Sameday. */
const LINE_END_X = SAMEDAY_COUNTER.x - SAMEDAY_COUNTER.width / 2 + BELT_WIDTH / 2;

/** Tinggi permukaan belt (setinggi meja packing, mudah dijangkau packer; sama dengan meja loket). */
const BELT_Y = COUNTER_DESK.y;
const BELT_THICKNESS = 0.1;
const LEG_SPACING = 1.6;
/** Pallet di slot Shipping sepanjang ±0,6 m searah z; transfer berakhir di tepi utaranya. */
const PALLET_EDGE = 0.6;
const PARCEL_HALF_HEIGHT = 0.09;
const SPEED = 2; // m/s

const FRAME_COLOR = "#475569";
const BELT_COLOR = "#1f2937";
const ROLLER_COLOR = "#94a3b8";

/** Kapasitas instanced mesh paket yang sedang di conveyor (semua station sekaligus). */
const MAX_PARCELS = 200;
const parcelGeometry = new BoxGeometry(0.26, PARCEL_HALF_HEIGHT * 2, 0.26);
const parcelMaterial = new MeshStandardMaterial({ color: PARCEL_COLOR, roughness: 0.85 });

interface Parcel {
  orderId: string;
  path: Vec3[];
  length: number;
  along: number;
}

/** Titik akhir paket ke-n: posisinya di tumpukan pallet slot Shipping (pallet diputar FLOOR_PALLET_ROTATION). */
function getStackPoint(slot: FloorSlot, n: number): Vec3 {
  const [ox, oy, oz] = getParcelOffset(n);
  const [cos, sin] = [Math.cos(FLOOR_PALLET_ROTATION), Math.sin(FLOOR_PALLET_ROTATION)];
  return [slot.position[0] + ox * cos + oz * sin, oy, slot.position[1] - ox * sin + oz * cos];
}

/**
 * Belt di depan packer → lurus ke barat sepanjang belt, lalu:
 * - SHIPPING: transfer di slot tujuan (ke selatan) → tumpukan pallet;
 * - SAMEDAY: sampai di depan tumpukan order → didorong ke meja loket (ke utara).
 */
function buildParcelPath(station: FloorSlot, destination: PackingDestination, n: number): Vec3[] | undefined {
  const y = BELT_Y + PARCEL_HALF_HEIGHT;
  const start: Vec3 = [station.position[0], y, CONVEYOR_Z];
  if (destination.kind === "SAMEDAY") {
    const pile = getCounterParcelPoint(destination.counterSlot, n);
    return [start, [pile[0], y, CONVEYOR_Z], pile];
  }
  const slot = floorSlotById.get(destination.slotId);
  if (!slot) return undefined;
  const [tx, tz] = slot.position;
  return [start, [tx, y, CONVEYOR_Z], [tx, y, tz - PALLET_EDGE], getStackPoint(slot, n)];
}

type Point2 = [x: number, z: number];

type Segment = {
  from: Point2;
  to: Point2;
  /** Arah ruas-ruas yang masuk ke awal ruas ini / keluar dari ujungnya; kosong = ujung bebas. */
  prev: Point2[];
  next: Point2[];
};

const direction = (a: Point2, b: Point2): Point2 => {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
};

/** Titik-titik garis tengah belt, urut arah aliran paket. */
const LINE_POINTS: Point2[] = [
  [LINE_START_X, CONVEYOR_Z],
  [LINE_END_X, CONVEYOR_Z],
];

/** Ruas belt beserta arah ruas tetangganya (untuk sambungan pagar di belokan). */
const SEGMENTS: Segment[] = LINE_POINTS.slice(1).map((to, i) => {
  const from = LINE_POINTS[i];
  return {
    from,
    to,
    prev: i > 0 ? [direction(LINE_POINTS[i - 1], from)] : [],
    next: i + 2 < LINE_POINTS.length ? [direction(to, LINE_POINTS[i + 2])] : [],
  };
});

export default function Conveyor() {
  const parcelsRef = useRef<InstancedMesh>(null);
  const parcels = useRef<Parcel[]>([]);
  /** Jumlah paket per order yang sudah masuk conveyor. */
  const spawned = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    if (parcelsRef.current) parcelsRef.current.count = 0;
  }, []);

  useFrame((_, delta) => {
    const mesh = parcelsRef.current;
    if (!mesh) return;
    const dt = Math.min(delta, 0.1);
    const store = useWarehouseStore.getState();

    // Paket baru: tiap PCS yang selesai dikemas langsung ditaruh packer di belt.
    for (const order of store.packingOrders) {
      if (order.status === "CLOSED") {
        spawned.current.delete(order.id);
        continue;
      }
      const station = packingById.get(order.stationId);
      if (!station) continue;
      let count = spawned.current.get(order.id) ?? order.conveyedQuantity;
      while (count < order.packedQuantity) {
        const path = buildParcelPath(station, order.destination, count);
        if (!path) break;
        parcels.current.push({ orderId: order.id, path, length: pathLength(path), along: 0 });
        count++;
      }
      spawned.current.set(order.id, count);
    }

    // Jalankan paket; yang sampai di tumpukan pallet dilaporkan ke store (pallet bertambah satu paket).
    const moving: Parcel[] = [];
    for (const parcel of parcels.current) {
      parcel.along += dt * SPEED;
      if (parcel.along >= parcel.length) store.conveyOnePiece(parcel.orderId);
      else moving.push(parcel);
    }
    parcels.current = moving;

    const dummy = new Object3D();
    const visible = Math.min(moving.length, MAX_PARCELS);
    for (let i = 0; i < visible; i++) {
      dummy.position.set(...pointAlong(moving[i].path, moving[i].along).point);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.count = visible;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {SEGMENTS.map((segment, i) => (
        <BeltSegment key={i} {...segment} />
      ))}
      {shippingSlots.map((slot) => (
        <Transfer key={slot.id} slot={slot} />
      ))}
      {/*
        frustumCulled off: bounding sphere instanced mesh hanya dihitung sekali (saat paket pertama),
        jadi tanpa ini seluruh paket ikut di-cull begitu titik itu keluar layar, padahal paket lain
        terlihat; yang tersisa hanya bayangannya (kotak hitam di belt).
      */}
      <instancedMesh
        ref={parcelsRef}
        args={[parcelGeometry, parcelMaterial, MAX_PARCELS]}
        castShadow
        frustumCulled={false}
      />
    </group>
  );
}

const RAIL_THICKNESS = 0.04;
/** Jarak garis tengah pagar samping dari garis tengah belt. */
const RAIL_OFFSET = (BELT_WIDTH + RAIL_THICKNESS) / 2;

/**
 * Perpanjangan pagar sisi `side` di sebuah ujung ruas, diukur dari titik ujung garis tengah.
 * `turns` = arah ruas-ruas tetangga di ujung itu, dilihat dari ujung tersebut.
 * Ujung bebas: sampai ujung belt. Belokan/persimpangan: pagar di sisi tempat ruas tetangga berada
 * (sisi dalam) berhenti di pagar ruas tetangga; pagar sisi luar menerus sampai sudut luar.
 * Dengan begitu pagar bertemu rapi tanpa bersilangan, dan persimpangan tetap terbuka ke tiap cabang.
 */
function railExtension(side: Point2, turns: Point2[]): number {
  if (turns.length === 0) return BELT_WIDTH / 2;
  const inner = turns.some((turn) => side[0] * turn[0] + side[1] * turn[1] > 0);
  return inner ? -RAIL_OFFSET + RAIL_THICKNESS / 2 : RAIL_OFFSET + RAIL_THICKNESS / 2;
}

/** Satu ruas belt lurus (sejajar sumbu x atau z) dengan pagar samping & kaki-kaki penyangga. */
function BeltSegment({ from, to, prev, next }: Segment) {
  const alongX = Math.abs(to[0] - from[0]) > Math.abs(to[1] - from[1]);
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) + BELT_WIDTH;
  const center: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const size = (along: number, across: number, height: number): [number, number, number] =>
    alongX ? [along, height, across] : [across, height, along];
  const legs = Math.max(2, Math.round(length / LEG_SPACING) + 1);
  const dir = direction(from, to);
  const across: [number, number] = alongX ? [0, 1] : [1, 0];

  return (
    <group position={[center[0], 0, center[1]]}>
      <mesh position={[0, BELT_Y - BELT_THICKNESS / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={size(length, BELT_WIDTH, BELT_THICKNESS)} />
        <meshStandardMaterial color={BELT_COLOR} />
      </mesh>
      {/* Pagar samping rendah supaya paket tidak jatuh */}
      {[-1, 1].map((sign) => {
        const side: [number, number] = [across[0] * sign, across[1] * sign];
        // Belokan di awal ruas dilihat dari ruas ini: ruas sebelumnya datang dari arah -prev.
        const startExt = railExtension(
          side,
          prev.map(([dx, dz]): Point2 => [-dx, -dz]),
        );
        const endExt = railExtension(side, next);
        const start = [from[0] - dir[0] * startExt, from[1] - dir[1] * startExt];
        const end = [to[0] + dir[0] * endExt, to[1] + dir[1] * endExt];
        const railLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
        const x = (start[0] + end[0]) / 2 + side[0] * RAIL_OFFSET - center[0];
        const z = (start[1] + end[1]) / 2 + side[1] * RAIL_OFFSET - center[1];
        return (
          <mesh key={sign} position={[x, BELT_Y + 0.03, z]}>
            <boxGeometry args={size(railLength, RAIL_THICKNESS, 0.12)} />
            <meshStandardMaterial color={FRAME_COLOR} />
          </mesh>
        );
      })}
      {Array.from({ length: legs }, (_, i) => {
        const t = -length / 2 + 0.15 + ((length - 0.3) * i) / (legs - 1);
        return [-1, 1].map((side) => {
          const across = (side * (BELT_WIDTH - 0.08)) / 2;
          return (
            <mesh
              key={`${i}-${side}`}
              position={alongX ? [t, (BELT_Y - BELT_THICKNESS) / 2, across] : [across, (BELT_Y - BELT_THICKNESS) / 2, t]}
            >
              <boxGeometry args={[0.05, BELT_Y - BELT_THICKNESS, 0.05]} />
              <meshStandardMaterial color={FRAME_COLOR} />
            </mesh>
          );
        });
      })}
    </group>
  );
}

/** Meja roller dari sisi selatan belt ke tepi utara pallet di slot Shipping. */
function Transfer({ slot }: { slot: FloorSlot }) {
  const [x, z] = slot.position;
  const start = CONVEYOR_Z + BELT_WIDTH / 2;
  const end = z - PALLET_EDGE;
  const length = end - start;
  return (
    <group position={[x, 0, (start + end) / 2]}>
      <mesh position={[0, BELT_Y - 0.03, 0]} receiveShadow>
        <boxGeometry args={[BELT_WIDTH, 0.05, length]} />
        <meshStandardMaterial color={ROLLER_COLOR} metalness={0.4} roughness={0.4} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, (BELT_Y - 0.05) / 2, (side * (length - 0.05)) / 2]}>
          <boxGeometry args={[0.05, BELT_Y - 0.05, 0.05]} />
          <meshStandardMaterial color={FRAME_COLOR} />
        </mesh>
      ))}
    </group>
  );
}
