import { useMemo, useRef, useState, type Ref } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import type { DockDoor } from "@/types/warehouse";
import {
  PALLET_CAPACITY,
  RETURN_LAYOUT,
  TRUCK_PALLET_CAPACITY,
  floorSlotById,
  warehouseLayout,
} from "@/data/warehouse";
import { pathLength, pointAlong, type Vec3 } from "@/lib/path";
import { useWarehouseStore } from "@/store/warehouseStore";
import { PalletModel, ParcelPallet, getBoxCount } from "./Pallets";
import FloorLabel from "./FloorLabel";
import { OUTSIDE_ROAD_LENGTH, getFrontRoad } from "./FrontYard";
import TruckLogo from "./TruckLogo";
import Worker, { type WorkerMotion } from "./Worker";

// Semua koordinat di file ini lokal terhadap dock: origin = tengah pintu di dinding,
// +x = masuk ke dalam gudang, -x = ke arah yard. Dock di dinding timur diputar 180°.

const DOOR_HEIGHT = 3.2;
const FRAME_COLOR = "#334155";
const SHUTTER_COLOR = "#cbd5e1";

const TRUCK = {
  /** Posisi ujung belakang trailer saat menempel di dock. */
  dockedX: -0.3,
  /** Tinggi lantai trailer (pallet keluar dari sini lalu turun lewat dock leveler). */
  bedY: 0.5,
  trailerLength: 8,
  width: 2.4,
};
/** Panjang kabin (ujung depan truk ada di -trailerLength - CAB_LENGTH). */
const CAB_LENGTH = 2.2;
const TRUCK_HALF_LENGTH = (TRUCK.trailerLength + CAB_LENGTH) / 2;

const TIMING = {
  door: 1.2, // detik
  jackSpeed: 2.2, // m/s
  driveSpeed: 7, // m/s, maju
  reverseSpeed: 2.5, // m/s, mundur ke dock
};

/**
 * Rute truk (koordinat dunia): masuk gerbang → jalan depan → belok ke lajur yard → maju melewati
 * dock → mundur sambil berbelok masuk dock. Pergi: maju keluar dock → belok ke lajur → jalan depan
 * → keluar gerbang. Belokan berupa busur 90° supaya badan truk tetap di atas aspal.
 * Truk datang & pergi memakai lajur terpisah (lajur kiri, seperti di Indonesia), supaya dua truk
 * yang berlawanan arah tidak bertabrakan.
 */
const ROUTE = {
  /**
   * Jarak garis tengah yard (di antara lajur datang & pergi) dari dinding. Lajur yang dekat dinding
   * (12,2 m) masih di luar kabin truk lain yang sedang menempel di dock.
   */
  laneOffset: 13.7,
  /** Jarak tiap lajur yard dari garis tengahnya; truk selebar 2,4 m, jadi tersisa ±0,6 m antar truk. */
  yardLaneSpread: 1.5,
  /** Jarak tiap lajur jalan depan dari garis tengah jalan. */
  roadLaneSpread: 1.6,
  /** Radius belok antara jalan depan dan lajur yard. */
  roadTurnRadius: 5,
  /** Radius belok antara lajur yard dan dock (maju keluar / mundur masuk). */
  dockTurnRadius: 4.5,
  /** Jarak sampling arah hadap truk, supaya transisi antar titik polyline mulus. */
  headingWindow: 1.5,
  arcSteps: 10,
};

/** Ujung dock leveler di dalam gudang. */
const LEVELER_END_X = 1;
/** Jalur hand pallet: sekian meter di sisi dock dari pallet di slot, supaya tidak menabrak pallet lain. */
const LANE_OFFSET = 2.2;

/** Operator hand pallet berdiri di belakang gagang; tangannya (±0,53 m di depan badan) memegang gagang. */
const OPERATOR_OFFSET_X = -1.5;
const OPERATOR_VEST = "#2563eb";

/**
 * Muatan hand pallet: pallet inbound berisi box, pallet outbound berisi paket hasil packing.
 * `turn` = rotasi pallet terhadap fork, supaya sama dengan orientasi pallet di slot saat diambil/ditaruh.
 */
interface Load {
  boxes: number;
  parcels: number;
  turn?: number;
}
const EMPTY_LOAD: Load = { boxes: 0, parcels: 0 };
/** Pallet di slot lantai diputar 90°; didekati sejajar sumbu x berarti pallet melintang di fork. */
const SIDE_TURN = Math.PI / 2;

/** Satu perjalanan hand pallet di sepanjang `path`, membawa `load`; `onEnd` dipanggil saat sampai. */
interface Leg {
  path: Vec3[];
  load: Load;
  onEnd?: () => void;
}

/** Satu gerakan truk sepanjang `path` (koordinat lokal dock) untuk titik tengah truk. */
interface TruckMove {
  path: Vec3[];
  /** Mundur: kabin di belakang arah gerak. */
  reverse: boolean;
  length: number;
  duration: number;
}

interface TruckPose {
  x: number;
  z: number;
  rotationY: number;
}

const DOCKED_POSE: TruckPose = { x: TRUCK.dockedX, z: 0, rotationY: 0 };

type Phase =
  | { kind: "away" }
  | { kind: "arriving"; t: number; move: number }
  | { kind: "opening" | "closing" | "departing"; t: number }
  | { kind: "jack"; t: number; legs: Leg[]; leg: number }
  /** Truk outbound menunggu di dock dengan pintu terbuka sampai ada muatan baru, penuh, atau diberangkatkan. */
  | { kind: "docked" };

const ease = (t: number) => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

function buildMove(points: Point2[], toLocal: (p: Point2) => Vec3, reverse: boolean): TruckMove {
  const path = points.map(toLocal);
  const length = pathLength(path);
  return { path, reverse, length, duration: length / (reverse ? TIMING.reverseSpeed : TIMING.driveSpeed) };
}

type Point2 = [x: number, z: number];

/**
 * Titik-titik busur 90° yang dimulai di `from` dengan arah gerak `d1` dan berakhir dengan arah `d2`
 * (vektor satuan sejajar sumbu). Titik awal tidak ikut, titik akhir ikut.
 */
function arc90(from: Point2, d1: Point2, d2: Point2, radius: number): Point2[] {
  const center: Point2 = [from[0] + d2[0] * radius, from[1] + d2[1] * radius];
  return Array.from({ length: ROUTE.arcSteps }, (_, i) => {
    const phi = ((i + 1) / ROUTE.arcSteps) * (Math.PI / 2);
    const [c, s] = [Math.cos(phi) * radius, Math.sin(phi) * radius];
    return [center[0] - d2[0] * c + d1[0] * s, center[1] - d2[1] * c + d1[1] * s];
  });
}

const EAST: Point2 = [1, 0];
const WEST: Point2 = [-1, 0];
const NORTH: Point2 = [0, -1];
const SOUTH: Point2 = [0, 1];

/** Rute datang (maju lalu mundur) dan pergi untuk truk dock ini, dalam koordinat lokal dock. */
function buildTruckRoutes(dock: DockDoor, wallX: number) {
  const sign = dock.wall === "EAST" ? -1 : 1;
  const toLocal = ([x, z]: Point2): Vec3 => [sign * (x - wallX), 0, sign * (z - dock.z)];
  // Arah x dunia dari dinding menuju yard, dan sebaliknya.
  const outward = -sign;
  const toYard: Point2 = [outward, 0];
  const toWall: Point2 = [-outward, 0];
  const { gateX, centerZ } = getFrontRoad(warehouseLayout.width, warehouseLayout.depth);
  const { roadTurnRadius: rRoad, dockTurnRadius: rDock, yardLaneSpread, roadLaneSpread } = ROUTE;
  // Lajur kiri: di yard, ke utara lewat lajur barat & ke selatan lewat lajur timur; di jalan depan,
  // ke timur (masuk) lewat lajur utara & ke barat (keluar) lewat lajur selatan.
  const yardCenterX = wallX + outward * ROUTE.laneOffset;
  const arriveX = yardCenterX - yardLaneSpread;
  const departX = yardCenterX + yardLaneSpread;
  const arriveZ = centerZ - roadLaneSpread;
  const departZ = centerZ + roadLaneSpread;
  const dockedX = wallX + outward * (TRUCK_HALF_LENGTH - TRUCK.dockedX);
  // Truk muncul/hilang di jalan umum luar gerbang, seluruh badannya masih di atas aspal.
  const outsideX = gateX - OUTSIDE_ROAD_LENGTH + TRUCK_HALF_LENGTH;

  // Datang: lurus ke timur di jalan depan, belok kiri ke lajur yard, maju sampai melewati dock.
  const enterTurn: Point2 = [arriveX - rRoad, arriveZ];
  const reverseStart: Point2 = [arriveX, dock.z - rDock];
  // Mundur: dari arah selatan berbelok menuju dinding, lalu lurus menempel dock.
  const forwardIn = [[outsideX, arriveZ] as Point2, enterTurn, ...arc90(enterTurn, EAST, NORTH, rRoad), reverseStart];
  const reverseIn = [reverseStart, ...arc90(reverseStart, SOUTH, toWall, rDock), [dockedX, dock.z] as Point2];

  // Pergi: maju menjauhi dinding, belok ke selatan di lajur, belok ke barat di jalan depan, keluar gerbang.
  const leaveTurn: Point2 = [departX + toWall[0] * rDock, dock.z];
  const exitTurn: Point2 = [departX, departZ - rRoad];
  const departure = [
    [dockedX, dock.z] as Point2,
    leaveTurn,
    ...arc90(leaveTurn, toYard, SOUTH, rDock),
    exitTurn,
    ...arc90(exitTurn, SOUTH, WEST, rRoad),
    [outsideX, departZ] as Point2,
  ];

  return {
    arrive: [buildMove(forwardIn, toLocal, false), buildMove(reverseIn, toLocal, true)],
    depart: buildMove(departure, toLocal, false),
  };
}

/** Posisi & arah truk di `move` setelah `t` detik. Origin truk = ujung belakang trailer, kabin ke -x lokal. */
function getTruckPose(move: TruckMove, t: number): TruckPose {
  const along = ease(t / move.duration) * move.length;
  const [x, , z] = pointAlong(move.path, along).point;
  // Arah hadap dari dua titik di depan & belakang, bukan segmen saat ini, supaya belokan tidak patah.
  const a = pointAlong(move.path, Math.max(along - ROUTE.headingWindow, 0)).point;
  const b = pointAlong(move.path, Math.min(along + ROUTE.headingWindow, move.length)).point;
  const norm = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
  const direction = move.reverse ? -1 : 1;
  const hx = ((b[0] - a[0]) / norm) * direction;
  const hz = ((b[2] - a[2]) / norm) * direction;
  return { x: x - hx * TRUCK_HALF_LENGTH, z: z - hz * TRUCK_HALF_LENGTH, rotationY: Math.atan2(hz, -hx) };
}

/**
 * Dari dalam trailer → dock leveler → lane di samping titik tujuan → masuk ke titik tujuan
 * (`target` koordinat dunia x/z; hasil dalam koordinat lokal dock). Kalau tujuan segaris dengan
 * pintu, langsung lurus tanpa lane.
 */
function buildTruckToPointPath(dock: DockDoor, wallX: number, target: [x: number, z: number]): Vec3[] {
  const sign = dock.wall === "EAST" ? -1 : 1;
  const slotX = sign * (target[0] - wallX);
  const slotZ = sign * (target[1] - dock.z);
  const start: Vec3[] = [
    [TRUCK.dockedX - 2, TRUCK.bedY, 0],
    [TRUCK.dockedX, TRUCK.bedY, 0],
    [LEVELER_END_X, 0, 0],
  ];
  if (Math.abs(slotZ) < 0.01) return [...start, [slotX, 0, 0]];
  const laneX = slotX - LANE_OFFSET;
  return [...start, [laneX, 0, 0], [laneX, 0, slotZ], [slotX, 0, slotZ]];
}

const buildTruckToSlotPath = (dock: DockDoor, wallX: number, slotId: string) =>
  buildTruckToPointPath(dock, wallX, floorSlotById.get(slotId)!.position);

/** Jarak sumbu jalan masuk dari dinding (lokal x), di dalam pintu setelah dock leveler. */
const ENTRY_LANE_X = LEVELER_END_X + 1;

/**
 * Ke slot Shipping di baris utara (berjajar sepanjang x di selatan conveyor), didekati dari selatan:
 * dari dock leveler → sepanjang dinding ke lorong di selatan slot → sepanjang lorong ke depan slot →
 * masuk ke slot ke utara. Hasil dalam koordinat lokal dock.
 */
function buildTruckToShippingPath(dock: DockDoor, wallX: number, slotId: string): Vec3[] {
  const sign = dock.wall === "EAST" ? -1 : 1;
  const [x, z] = floorSlotById.get(slotId)!.position;
  const slotX = sign * (x - wallX);
  const slotZ = sign * (z - dock.z);
  const aisleZ = slotZ + sign * LANE_OFFSET;
  return [
    [TRUCK.dockedX - 2, TRUCK.bedY, 0],
    [TRUCK.dockedX, TRUCK.bedY, 0],
    [LEVELER_END_X, 0, 0],
    [ENTRY_LANE_X, 0, 0],
    [ENTRY_LANE_X, 0, aisleZ],
    [slotX, 0, aisleZ],
    [slotX, 0, slotZ],
  ];
}

/** Ambil task antrean dock ini berikutnya dan susun perjalanan hand pallet-nya. */
function startNextJob(dock: DockDoor, wallX: number): Leg[] | null {
  const store = useWarehouseStore.getState();

  if (dock.direction === "INBOUND") {
    // Bongkar: bawa pallet dari truk ke staging, lalu kembali kosong.
    const task = store.inboundTasks.find((t) => t.dockId === dock.id && t.status === "QUEUED");
    if (!task) return null;
    store.startUnloading(task.id);
    const path = buildTruckToSlotPath(dock, wallX, task.stagingId);
    return [
      {
        path,
        load: { boxes: getBoxCount(task.quantity, PALLET_CAPACITY), parcels: 0, turn: SIDE_TURN },
        onEnd: () => useWarehouseStore.getState().completeInbound(task.id),
      },
      { path: [...path].reverse(), load: EMPTY_LOAD },
    ];
  }

  if (dock.direction === "RETURN") {
    // Retur: bawa pallet paket retur dari truk ke Return Area, lalu kembali kosong.
    const order = store.returnOrders.find((r) => r.dockId === dock.id && r.status === "QUEUED");
    if (!order) return null;
    store.startReturnUnloading(order.id);
    const path = buildTruckToPointPath(dock, wallX, [RETURN_LAYOUT.sourceX, RETURN_LAYOUT.z]);
    return [
      {
        path,
        load: { boxes: 0, parcels: order.quantity, turn: SIDE_TURN },
        onEnd: () => useWarehouseStore.getState().arriveReturn(order.id),
      },
      { path: [...path].reverse(), load: EMPTY_LOAD },
    ];
  }

  // Muat: jalan kosong ke slot Shipping, ambil pallet paket, bawa masuk ke truk.
  // Slot didekati dari selatan (sejajar z), jadi pallet membujur di fork.
  if (shouldDepart(dock)) return null;
  const task = store.outboundTasks.find((t) => t.dockId === dock.id && t.status === "QUEUED");
  if (!task) return null;
  store.startLoading(task.id);
  const path = buildTruckToShippingPath(dock, wallX, task.slotId);
  return [
    {
      path,
      load: EMPTY_LOAD,
      onEnd: () => useWarehouseStore.getState().pickUpOutbound(task.id),
    },
    {
      path: [...path].reverse(),
      load: { boxes: 0, parcels: task.quantity, turn: 0 },
      onEnd: () => useWarehouseStore.getState().completeOutbound(task.id),
    },
  ];
}

function hasQueuedTask(dock: DockDoor): boolean {
  const { inboundTasks, outboundTasks, returnOrders } = useWarehouseStore.getState();
  const tasks =
    dock.direction === "INBOUND" ? inboundTasks : dock.direction === "RETURN" ? returnOrders : outboundTasks;
  return tasks.some((t) => t.dockId === dock.id && t.status === "QUEUED");
}

/** Truk outbound berangkat kalau diminta (tombol Berangkatkan) atau muatannya sudah penuh. */
function shouldDepart(dock: DockDoor): boolean {
  const { outboundTasks, dispatchingDockIds } = useWarehouseStore.getState();
  const loaded = outboundTasks.filter((t) => t.dockId === dock.id && t.status === "LOADED").length;
  return dispatchingDockIds.includes(dock.id) || loaded >= TRUCK_PALLET_CAPACITY;
}

interface DockProps {
  dock: DockDoor;
  /** Posisi x dinding tempat dock berada. */
  wallX: number;
}

/**
 * Pintu dock + truk + hand pallet. Memproses task (inbound atau outbound) milik dock ini satu per satu:
 * truk datang → shutter buka → hand pallet bongkar/muat per pallet → shutter tutup → truk pergi.
 */
export default function Dock({ dock, wallX }: DockProps) {
  const truckRef = useRef<Group>(null);
  const shutterRef = useRef<Mesh>(null);
  const jackRef = useRef<Group>(null);
  const phase = useRef<Phase>({ kind: "away" });
  const routes = useMemo(() => buildTruckRoutes(dock, wallX), [dock, wallX]);
  /** Pallet yang sedang dibawa hand pallet; boxes 0 = kosong. */
  const [carried, setCarried] = useState(EMPTY_LOAD);
  const operatorRef = useRef<Group>(null);
  /** Operator selalu memegang gagang; hanya langkah kakinya yang berubah. */
  const operatorMotion = useRef<WorkerMotion>({ walking: false, holding: true });
  const leftDoorRef = useRef<Group>(null);
  const rightDoorRef = useRef<Group>(null);
  const rearDoorRefs = [leftDoorRef, rightDoorRef] as const;
  /** Jumlah pallet di dalam trailer: yang masih antre dibongkar, atau yang sudah dimuat (outbound). */
  const cargoCount = useWarehouseStore((s) => {
    if (dock.direction === "OUTBOUND") {
      return s.outboundTasks.filter((t) => t.dockId === dock.id && t.status === "LOADED").length;
    }
    const tasks = dock.direction === "RETURN" ? s.returnOrders : s.inboundTasks;
    return tasks.filter((t) => t.dockId === dock.id && t.status === "QUEUED").length;
  });

  /**
   * Setelah pintu terbuka / perjalanan selesai: kerjakan task berikutnya. Kalau tidak ada,
   * truk inbound langsung pergi; truk outbound menunggu muatan lagi kecuali sudah harus berangkat.
   */
  const nextJobOrClose = (): Phase => {
    const legs = startNextJob(dock, wallX);
    if (legs) {
      setCarried(legs[0].load);
      return { kind: "jack", t: 0, legs, leg: 0 };
    }
    if (dock.direction === "OUTBOUND" && !shouldDepart(dock)) return { kind: "docked" };
    return { kind: "closing", t: 0 };
  };

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const p = phase.current;
    let truck: TruckPose | null = DOCKED_POSE; // null = truk tidak terlihat
    let doorOpen = 1;
    let jackAt: Vec3 | null = null;
    let jackDirection: [dx: number, dz: number] = [1, 0];

    switch (p.kind) {
      case "away":
        truck = null;
        doorOpen = 0;
        if (hasQueuedTask(dock)) phase.current = { kind: "arriving", t: 0, move: 0 };
        break;

      case "arriving": {
        p.t += dt;
        const move = routes.arrive[p.move];
        truck = getTruckPose(move, p.t);
        doorOpen = 0;
        if (p.t >= move.duration) {
          phase.current =
            p.move + 1 < routes.arrive.length ? { kind: "arriving", t: 0, move: p.move + 1 } : { kind: "opening", t: 0 };
        }
        break;
      }

      case "opening":
        p.t += dt;
        doorOpen = ease(p.t / TIMING.door);
        if (p.t >= TIMING.door) phase.current = nextJobOrClose();
        break;

      case "jack": {
        p.t += dt;
        const leg = p.legs[p.leg];
        const distance = p.t * TIMING.jackSpeed;
        const along = pointAlong(leg.path, distance);
        jackAt = along.point;
        jackDirection = along.direction;
        if (distance >= pathLength(leg.path)) {
          leg.onEnd?.();
          const next = p.legs[p.leg + 1];
          if (next) {
            setCarried(next.load);
            phase.current = { ...p, t: 0, leg: p.leg + 1 };
          } else {
            setCarried(EMPTY_LOAD);
            phase.current = nextJobOrClose();
          }
        }
        break;
      }

      case "docked":
        if (shouldDepart(dock)) phase.current = { kind: "closing", t: 0 };
        else if (hasQueuedTask(dock)) phase.current = nextJobOrClose();
        break;

      case "closing":
        p.t += dt;
        doorOpen = 1 - ease(p.t / TIMING.door);
        if (p.t >= TIMING.door) phase.current = { kind: "departing", t: 0 };
        break;

      case "departing":
        p.t += dt;
        truck = getTruckPose(routes.depart, p.t);
        doorOpen = 0;
        if (p.t >= routes.depart.duration) {
          if (dock.direction === "OUTBOUND") useWarehouseStore.getState().completeDispatch(dock.id);
          phase.current = { kind: "away" };
        }
        break;
    }

    if (truckRef.current) {
      truckRef.current.visible = truck !== null;
      if (truck) {
        truckRef.current.position.set(truck.x, 0, truck.z);
        truckRef.current.rotation.y = truck.rotationY;
      }
    }
    if (shutterRef.current) {
      // Shutter tergulung ke atas: tinggi menyusut, sisi atas tetap di header.
      const height = DOOR_HEIGHT * (1 - 0.92 * doorOpen);
      shutterRef.current.scale.y = height;
      shutterRef.current.position.y = DOOR_HEIGHT - height / 2;
    }
    // Pintu belakang trailer terbuka bersamaan dengan shutter dock.
    rearDoorRefs[0].current?.rotation.set(0, -doorOpen * REAR_DOOR_SWING, 0);
    rearDoorRefs[1].current?.rotation.set(0, doorOpen * REAR_DOOR_SWING, 0);
    if (jackRef.current) {
      jackRef.current.visible = jackAt !== null;
      if (jackAt) {
        jackRef.current.position.set(...jackAt);
        // Fork (+x lokal) menghadap arah jalan, gagang & operator di belakang.
        jackRef.current.rotation.y = Math.atan2(-jackDirection[1], jackDirection[0]);
      }
    }
    operatorMotion.current.walking = jackAt !== null;
  });

  const halfWidth = dock.width / 2;

  return (
    <group position={[wallX, 0, dock.z]} rotation={[0, dock.wall === "EAST" ? Math.PI : 0, 0]}>
      {/* Rangka pintu + header */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, DOOR_HEIGHT / 2, side * (halfWidth + 0.1)]} castShadow>
          <boxGeometry args={[0.3, DOOR_HEIGHT, 0.2]} />
          <meshStandardMaterial color={FRAME_COLOR} />
        </mesh>
      ))}
      <mesh position={[0, DOOR_HEIGHT + 0.15, 0]} castShadow>
        <boxGeometry args={[0.3, 0.3, dock.width + 0.4]} />
        <meshStandardMaterial color={FRAME_COLOR} />
      </mesh>

      {/* Roller shutter; tinggi diatur lewat scale.y (geometry tinggi 1). */}
      <mesh ref={shutterRef} position={[0, DOOR_HEIGHT / 2, 0]}>
        <boxGeometry args={[0.08, 1, dock.width]} />
        <meshStandardMaterial color={SHUTTER_COLOR} metalness={0.4} roughness={0.5} />
      </mesh>

      {/* Dock leveler: pelat kuning di lantai dalam pintu */}
      <mesh position={[LEVELER_END_X / 2, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[LEVELER_END_X, dock.width - 0.2]} />
        <meshStandardMaterial color="#eab308" />
      </mesh>
      <FloorLabel text={dock.code} color="#1e293b" position={[0.2, 0.02, -halfWidth - 0.25]} height={0.5} />

      <Truck ref={truckRef} doorRefs={rearDoorRefs} cargo={{ count: cargoCount, parcels: dock.direction !== "INBOUND" }} />

      {/* Hand pallet + pallet yang dibawa + operator yang mendorong. Origin = tengah-bawah pallet. */}
      <group ref={jackRef} visible={false}>
        <PalletJack />
        {/* Operator di belakang gagang (-x), menghadap arah jalan (+x), tangan di gagang. */}
        <group position={[OPERATOR_OFFSET_X, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <Worker ref={operatorRef} motion={operatorMotion} vestColor={OPERATOR_VEST} />
        </group>
        {(carried.boxes > 0 || carried.parcels > 0) && (
          <group rotation={[0, carried.turn ?? SIDE_TURN, 0]}>
            {carried.parcels > 0 ? (
              <ParcelPallet count={carried.parcels} />
            ) : (
              <PalletModel boxCount={carried.boxes} />
            )}
          </group>
        )}
      </group>
    </group>
  );
}

const TRAILER_HEIGHT = 2.6;
const TRAILER_WALL = 0.05;
/** Pintu belakang berayun keluar sampai menempel di sisi trailer (±270°). */
const REAR_DOOR_SWING = Math.PI * 1.45;
/** Muatan di dalam trailer: pallet berjajar ke depan, mulai di belakang titik ambil hand pallet. */
const CARGO_START_X = -3.2;
const CARGO_SPACING = 1.3;
const MAX_CARGO_VISIBLE = 4;

interface TruckProps {
  ref: Ref<Group>;
  /** Pintu belakang kiri (+z) & kanan (-z); rotasinya diatur Dock sesuai buka-tutup shutter. */
  doorRefs: readonly [Ref<Group>, Ref<Group>];
  cargo: { count: number; parcels: boolean };
}

/**
 * Truk dengan trailer berongga dan dua pintu belakang. Origin = ujung belakang trailer,
 * badan memanjang ke -x. Muatan di dalam terlihat saat pintu belakang terbuka.
 */
function Truck({ ref, doorRefs, cargo }: TruckProps) {
  const { trailerLength: L, width: W, bedY } = TRUCK;
  const H = TRAILER_HEIGHT;
  const panels: { position: [number, number, number]; size: [number, number, number] }[] = [
    { position: [-L / 2, bedY - TRAILER_WALL / 2, 0], size: [L, TRAILER_WALL, W] }, // lantai
    { position: [-L / 2, bedY + H - TRAILER_WALL / 2, 0], size: [L, TRAILER_WALL, W] }, // atap
    { position: [-L / 2, bedY + H / 2, W / 2 - TRAILER_WALL / 2], size: [L, H, TRAILER_WALL] },
    { position: [-L / 2, bedY + H / 2, -W / 2 + TRAILER_WALL / 2], size: [L, H, TRAILER_WALL] },
    { position: [-L + TRAILER_WALL / 2, bedY + H / 2, 0], size: [TRAILER_WALL, H, W] }, // dinding depan
  ];

  return (
    <group ref={ref} visible={false}>
      {panels.map((panel, i) => (
        <mesh key={i} position={panel.position} castShadow receiveShadow>
          <boxGeometry args={panel.size} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
      ))}
      {/* Rangka bawah trailer */}
      <mesh position={[-L / 2, bedY - 0.2, 0]}>
        <boxGeometry args={[L, 0.3, W - 0.4]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      {/* Garis warna di kedua sisi luar trailer */}
      {[1, -1].map((side) => (
        <mesh key={side} position={[-L / 2, bedY + 0.5, side * (W / 2 + 0.005)]}>
          <boxGeometry args={[L, 0.25, 0.01]} />
          <meshStandardMaterial color="#2563eb" />
        </mesh>
      ))}

      {/* Pintu belakang: engsel di sudut belakang, daun pintu menutup ke arah tengah. */}
      {[1, -1].map((side, i) => (
        <group key={side} ref={doorRefs[i]} position={[0, bedY + H / 2, side * (W / 2 + 0.03)]}>
          <mesh position={[0, 0, (-side * W) / 4]} castShadow>
            <boxGeometry args={[0.04, H, W / 2]} />
            <meshStandardMaterial color="#e2e8f0" />
          </mesh>
        </group>
      ))}

      {/* Muatan di dalam trailer */}
      {Array.from({ length: Math.min(cargo.count, MAX_CARGO_VISIBLE) }, (_, n) => (
        <group key={n} position={[CARGO_START_X - n * CARGO_SPACING, bedY, 0]} rotation={[0, Math.PI / 2, 0]}>
          {cargo.parcels ? <ParcelPallet count={12} /> : <PalletModel boxCount={4} />}
        </group>
      ))}
      <TruckLogo center={[-L / 2, bedY + 1.65]} halfWidth={W / 2} maxWidth={L - 1} maxHeight={1.4} />
      {/* Kabin */}
      <mesh position={[-L - 1.2, 1.35, 0]} castShadow>
        <boxGeometry args={[2, 2.2, W]} />
        <meshStandardMaterial color="#1d4ed8" />
      </mesh>
      <mesh position={[-L - 2.21, 1.8, 0]}>
        <boxGeometry args={[0.02, 0.8, W - 0.3]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      {/* Roda */}
      {[-1.2, -2.3, -L - 1.6].flatMap((x) =>
        [-1, 1].map((side) => (
          <mesh key={`${x}-${side}`} position={[x, 0.4, side * (W / 2 - 0.1)]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.4, 0.4, 0.3, 16]} />
            <meshStandardMaterial color="#18181b" />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Hand pallet: dua fork masuk ke pallet dari sisi -x, gagang di belakang. */
function PalletJack() {
  return (
    <group>
      {[-0.25, 0.25].map((z) => (
        <mesh key={z} position={[0, 0.05, z]}>
          <boxGeometry args={[1, 0.06, 0.14]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
      ))}
      <mesh position={[-0.6, 0.15, 0]}>
        <boxGeometry args={[0.2, 0.25, 0.6]} />
        <meshStandardMaterial color="#dc2626" />
      </mesh>
      <mesh position={[-0.85, 0.65, 0]} rotation={[0, 0, 0.35]}>
        <cylinderGeometry args={[0.03, 0.03, 1.1, 8]} />
        <meshStandardMaterial color="#27272a" />
      </mesh>
      <mesh position={[-1.04, 1.17, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.4, 8]} />
        <meshStandardMaterial color="#27272a" />
      </mesh>
    </group>
  );
}
