import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import type { PackingOrder } from "@/types/warehouse";
import { SAMEDAY_COUNTER, SAMEDAY_COUNTER_SLOTS, warehouseLayout } from "@/data/warehouse";
import { pathLength, pointAlong, type Vec3 } from "@/lib/path";
import { useActiveSamedayOrders, useWarehouseStore } from "@/store/warehouseStore";
import { OUTSIDE_ROAD_LENGTH, getFrontRoad } from "./FrontYard";
import { YARD_WIDTH } from "./WarehouseFloor";
import { PARCEL_COLOR } from "./Pallets";
import Motorbike, { GOJEK_GREEN } from "./Motorbike";
import Worker, { type WorkerMotion } from "./Worker";

// Semua koordinat di file ini koordinat dunia.
//
// Loket Sameday di dinding utara (jauh dari parkiran mobil di depan gudang), di ujung barat conveyor:
// paket order sameday didorong dari belt ke meja loket (satu tumpukan per order). Setelah semua paket order itu sampai,
// driver Gojek datang naik motor: masuk gerbang → jalan depan → naik lewat sisi timur yard truk →
// jalan belakang di utara gudang → berhenti di depan loket, menerima paket → lurus terus → belok kiri
// lewat sisi barat yard truk → keluar gerbang.

const { width: WAREHOUSE_WIDTH, depth: WAREHOUSE_DEPTH } = warehouseLayout;
const WALL_Z = -WAREHOUSE_DEPTH / 2;
/** Meja loket mengisi bukaan dinding, separuh di dalam & separuh di luar gudang. */
export const COUNTER_DESK = { y: 0.8, depth: 0.6 };
const PARCEL = { size: 0.26, height: 0.18, spacing: 0.3 };
const PILE_WIDTH = SAMEDAY_COUNTER.width / SAMEDAY_COUNTER_SLOTS;

/** Tepi selatan (dalam gudang) meja loket; belt conveyor lewat menempel di sini (lihat CONVEYOR_Z). */
const COUNTER_INNER_Z = WALL_Z + COUNTER_DESK.depth / 2;

/** Titik tengah paket ke-n di tumpukan ke-`slot` meja loket (2 × 2 per lapis). */
export function getCounterParcelPoint(slot: number, n: number): Vec3 {
  const pileX = SAMEDAY_COUNTER.x - SAMEDAY_COUNTER.width / 2 + PILE_WIDTH * (slot + 0.5);
  const cell = n % 4;
  const layer = Math.floor(n / 4);
  return [
    pileX + ((cell % 2) - 0.5) * PARCEL.spacing,
    COUNTER_DESK.y + PARCEL.height / 2 + layer * PARCEL.height,
    WALL_Z + (Math.floor(cell / 2) - 0.5) * PARCEL.spacing,
  ];
}

/** Petugas loket berdiri di dalam gudang di barat ujung belt (belt menutup sisi dalam meja), menghadap meja. */
const STAFF = { x: SAMEDAY_COUNTER.x - SAMEDAY_COUNTER.width / 2 - 0.45, z: COUNTER_INNER_Z + 0.3 };
const FACE_DESK = Math.PI / 2; // menghadap +x

/** Jalan belakang di utara gudang, sepanjang dinding utara, menyambung yard truk barat & timur. */
const BACK_ROAD = {
  west: -WAREHOUSE_WIDTH / 2,
  east: WAREHOUSE_WIDTH / 2,
  north: WALL_Z - 0.1 - 4.4,
  south: WALL_Z - 0.1,
};

const road = getFrontRoad(WAREHOUSE_WIDTH, WAREHOUSE_DEPTH);
const yardOuterX = WAREHOUSE_WIDTH / 2 + YARD_WIDTH;
/**
 * Lajur motor, searah keliling gudang (berlawanan jarum jam dilihat dari atas): masuk gerbang → jalan
 * depan ke timur → yard timur ke utara → jalan belakang ke barat (berhenti di loket) → lurus terus →
 * yard barat ke selatan → keluar gerbang. Di kedua yard motor lewat jauh di luar lajur truk & truk
 * yang sedang menempel di dock.
 */
const LANE = {
  // Di tepi jalan, di luar lajur truk masuk (utara) & keluar (selatan); searah lajur truk di sisinya.
  frontIn: road.northZ + 0.6,
  frontOut: road.southZ - 0.6,
  yardEast: yardOuterX - 5,
  yardWest: -yardOuterX + 5,
  back: BACK_ROAD.south - 1.5,
};
const STOP: [number, number] = [SAMEDAY_COUNTER.x, LANE.back];
const OUTSIDE_X = road.gateX - OUTSIDE_ROAD_LENGTH + 1.5;

/** Datang sampai mulut jalan belakang; dari sini motor maju ke posisi antreannya di depan loket. */
const ARRIVE_PATH: Vec3[] = [
  [OUTSIDE_X, 0, LANE.frontIn],
  [LANE.yardEast, 0, LANE.frontIn],
  [LANE.yardEast, 0, LANE.back],
];
/** Dari loket lurus terus ke barat, belok kiri ke selatan lewat yard barat, lalu keluar gerbang. */
const LEAVE_PATH: Vec3[] = [
  [STOP[0], 0, STOP[1]],
  [LANE.yardWest, 0, LANE.back],
  [LANE.yardWest, 0, LANE.frontOut],
  [OUTSIDE_X, 0, LANE.frontOut],
];

const BIKE_SPEED = 6; // m/s
/** Lama serah terima paket di loket (detik); paket pindah ke box motor di tengahnya. */
const HANDOVER_TIME = 1.6;
/** Jarak sampling arah hadap motor supaya belokan mulus. */
const HEADING_WINDOW = 0.8;

const STAFF_VEST = "#00aa13";

/** Driver dipanggil begitu order sameday dibuat; paling banyak satu per tumpukan meja loket. */
const MAX_RIDERS = SAMEDAY_COUNTER_SLOTS;
/** Jeda antar driver masuk gerbang supaya tidak bertumpuk di jalan. */
const SPAWN_INTERVAL = 3;
/** Jarak antar motor yang antre di jalan belakang (ke timur dari loket). */
const QUEUE_SPACING = 2.4;
const QUEUE_SPEED = 3; // m/s, maju di antrean
const FACE_WEST = -Math.PI / 2;

/**
 * arriving: dari luar gerbang ke mulut jalan belakang; queueing: maju ke posisi antrean (paling depan =
 * di depan loket), menunggu paketnya lengkap; handover: menerima paket; leaving: lurus, belok kiri, keluar.
 */
type Phase = "arriving" | "queueing" | "handover" | "leaving";

interface Rider {
  orderId: string;
  /** Indeks motor di pool yang digambar. */
  slot: number;
  phase: Phase;
  t: number;
  /** Posisi x di jalan belakang selama antre. */
  x: number;
}

const ease = (t: number) => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

/** Posisi & arah hadap motor setelah `t` detik di sepanjang `path` (dengan percepatan/perlambatan). */
function getBikePose(path: Vec3[], t: number) {
  const length = pathLength(path);
  const duration = length / BIKE_SPEED + 1;
  const along = ease(t / duration) * length;
  const point = pointAlong(path, along).point;
  const a = pointAlong(path, Math.max(along - HEADING_WINDOW, 0)).point;
  const b = pointAlong(path, Math.min(along + HEADING_WINDOW, length)).point;
  return { point, heading: Math.atan2(b[0] - a[0], b[2] - a[2]), done: t >= duration };
}

export default function SamedayCounter() {
  const orders = useActiveSamedayOrders();
  const staffRef = useRef<Group>(null);
  const staffMotion = useRef<WorkerMotion>({ walking: false, holding: false });
  const bikeRefs = useRef<(Group | null)[]>([]);
  const bikeParcelRefs = useRef<(Group | null)[]>([]);
  const riders = useRef<Rider[]>([]);
  /** Sisa jeda sebelum driver berikutnya boleh masuk gerbang. */
  const spawnCooldown = useRef(0);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const store = useWarehouseStore.getState();

    // Panggil driver untuk order sameday yang belum punya driver (urutan order), berselang beberapa detik.
    spawnCooldown.current -= dt;
    if (spawnCooldown.current <= 0 && riders.current.length < MAX_RIDERS) {
      const served = new Set(riders.current.map((r) => r.orderId));
      const next = store.packingOrders.find(
        (o) => o.destination.kind === "SAMEDAY" && o.status !== "CLOSED" && !served.has(o.id),
      );
      const usedSlots = new Set(riders.current.map((r) => r.slot));
      const slot = Array.from({ length: MAX_RIDERS }, (_, i) => i).find((i) => !usedSlots.has(i));
      if (next && slot !== undefined) {
        riders.current.push({ orderId: next.id, slot, phase: "arriving", t: 0, x: LANE.yardEast });
        spawnCooldown.current = SPAWN_INTERVAL;
      }
    }

    // Urutan antrean = urutan driver datang; driver yang sudah pergi tidak dihitung.
    let queueIndex = 0;
    for (const r of riders.current) {
      r.t += dt;
      const bike = bikeRefs.current[r.slot];
      let point: Vec3 = [r.x, 0, LANE.back];
      let heading = FACE_WEST;

      switch (r.phase) {
        case "arriving": {
          const pose = getBikePose(ARRIVE_PATH, r.t);
          point = pose.point;
          heading = pose.heading;
          if (pose.done) Object.assign(r, { phase: "queueing", t: 0, x: LANE.yardEast });
          queueIndex++;
          break;
        }
        case "queueing": {
          // Maju ke posisi antrean; paling depan berhenti di depan loket.
          const target = STOP[0] + queueIndex * QUEUE_SPACING;
          r.x = Math.max(target, r.x - QUEUE_SPEED * dt);
          point = [r.x, 0, LANE.back];
          const order = store.packingOrders.find((o) => o.id === r.orderId);
          if (queueIndex === 0 && r.x <= STOP[0] + 0.01 && order?.status === "AT_COUNTER") {
            Object.assign(r, { phase: "handover", t: 0 });
          }
          queueIndex++;
          break;
        }
        case "handover":
          point = [STOP[0], 0, STOP[1]];
          if (r.t >= HANDOVER_TIME) {
            store.handOverToGojek(r.orderId);
            Object.assign(r, { phase: "leaving", t: 0 });
          }
          queueIndex++;
          break;
        case "leaving": {
          const pose = getBikePose(LEAVE_PATH, r.t);
          point = pose.point;
          heading = pose.heading;
          break;
        }
      }

      if (bike) {
        bike.visible = true;
        bike.position.set(...point);
        bike.rotation.y = heading;
      }
      // Paket terlihat di atas box motor setelah diserahkan.
      const parcels = bikeParcelRefs.current[r.slot];
      if (parcels) parcels.visible = r.phase === "leaving" || (r.phase === "handover" && r.t >= HANDOVER_TIME / 2);
    }

    // Driver yang sudah keluar gerbang, atau ordernya hilang, dilepas dari pool.
    riders.current = riders.current.filter((r) => {
      const gone =
        (r.phase === "leaving" && getBikePose(LEAVE_PATH, r.t).done) ||
        !store.packingOrders.some((o) => o.id === r.orderId);
      if (gone && bikeRefs.current[r.slot]) bikeRefs.current[r.slot]!.visible = false;
      return !gone;
    });
    staffMotion.current.holding = riders.current.some((r) => r.phase === "handover");
  });

  return (
    <group>
      {/* Jalan belakang (aspal) di utara gudang */}
      <mesh
        position={[(BACK_ROAD.west + BACK_ROAD.east) / 2, -0.01, (BACK_ROAD.north + BACK_ROAD.south) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[BACK_ROAD.east - BACK_ROAD.west, BACK_ROAD.south - BACK_ROAD.north]} />
        <meshStandardMaterial color="#52525b" roughness={1} />
      </mesh>
      <CounterDesk />
      {orders.map((order) => (
        <CounterPile key={order.id} order={order} />
      ))}
      <group position={[STAFF.x, 0, STAFF.z]} rotation={[0, FACE_DESK, 0]}>
        <Worker ref={staffRef} motion={staffMotion} vestColor={STAFF_VEST} />
      </group>
      {Array.from({ length: MAX_RIDERS }, (_, i) => (
        <group
          key={i}
          ref={(el) => {
            bikeRefs.current[i] = el;
          }}
          visible={false}
        >
          <Motorbike gojek />
          <group
            ref={(el) => {
              bikeParcelRefs.current[i] = el;
            }}
            position={[0, 1.22, -0.62]}
            visible={false}
          >
            <mesh castShadow>
              <boxGeometry args={[PARCEL.size, PARCEL.height, PARCEL.size]} />
              <meshStandardMaterial color={PARCEL_COLOR} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

/** Meja loket di bukaan dinding utara. */
function CounterDesk() {
  const { x, width } = SAMEDAY_COUNTER;
  return (
    <group position={[x, 0, WALL_Z]}>
      <mesh position={[0, COUNTER_DESK.y - 0.025, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.05, COUNTER_DESK.depth]} />
        <meshStandardMaterial color="#f1f5f9" />
      </mesh>
      {/* Badan meja tertutup, berwarna hijau Gojek di sisi luar */}
      <mesh position={[0, (COUNTER_DESK.y - 0.05) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, COUNTER_DESK.y - 0.05, COUNTER_DESK.depth - 0.1]} />
        <meshStandardMaterial color={GOJEK_GREEN} />
      </mesh>
    </group>
  );
}

/** Tumpukan paket satu order sameday di meja loket; bertambah tiap paket sampai dari conveyor. */
function CounterPile({ order }: { order: PackingOrder }) {
  if (order.destination.kind !== "SAMEDAY") return null;
  const { counterSlot } = order.destination;
  return (
    <group>
      {Array.from({ length: order.conveyedQuantity }, (_, n) => (
        <mesh key={n} position={getCounterParcelPoint(counterSlot, n)} castShadow>
          <boxGeometry args={[PARCEL.size, PARCEL.height, PARCEL.size]} />
          <meshStandardMaterial color={PARCEL_COLOR} />
        </mesh>
      ))}
    </group>
  );
}
