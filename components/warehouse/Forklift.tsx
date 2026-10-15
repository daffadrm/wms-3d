import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { PALLET_CAPACITY, floorSlotById, locationById, rackById, racks } from "@/data/warehouse";
import {
  FORK_ENTRY,
  angleDelta,
  buildLetDownTimeline,
  buildMovementTimeline,
  buildPutBackTimeline,
  getHomePose,
  type ForkliftKeyframe,
  type ForkliftPose,
  type MovementEndpoint,
} from "@/lib/movement";
import { forkliftShouldYield, getForkliftBodyCenter, traffic } from "@/lib/traffic";
import { useWarehouseStore } from "@/store/warehouseStore";
import { PalletModel, getBoxCount } from "./Pallets";
import { Line } from "@react-three/drei";
import FloorLabel from "./FloorLabel";

const BODY_COLOR = "#facc15";
const FRAME_COLOR = "#27272a";
const MAST_HEIGHT = 2.2;
/** Fork bisa naik setinggi ini sebelum inner mast ikut terangkat. */
const MAST_FREE_LIFT = 1;
/** Langkah waktu maksimum per frame, supaya tidak "lompat" setelah tab tidak aktif. */
const MAX_DELTA = 0.1;

/** Pekerjaan forklift: movement pallet, atau let-down (tahap turun / tahap kembali ke rack). */
type Job = { kind: "movement"; id: string } | { kind: "letDown"; id: string; stage: "down" | "up" };

interface Animation {
  job: Job;
  keyframes: ForkliftKeyframe[];
  index: number;
  elapsed: number;
  from: ForkliftPose;
}

/** Seberapa jauh ke depan (detik) forklift memeriksa pejalan kaki & forklift lain di jalurnya. */
const LOOKAHEAD = 0.8;
/** Batas lama forklift menunggu sebelum jalan lagi (cegah saling tunggu). */
const MAX_YIELD_TIME = 4;

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Pose di antara `from` dan `to` pada progres `progress` (0–1), dengan easing. */
function interpolatePose(from: ForkliftPose, to: ForkliftPose, progress: number): ForkliftPose {
  const t = smoothstep(Math.min(Math.max(progress, 0), 1));
  return {
    x: from.x + (to.x - from.x) * t,
    z: from.z + (to.z - from.z) * t,
    heading: from.heading + angleDelta(from.heading, to.heading) * t,
    lift: from.lift + (to.lift - from.lift) * t,
  };
}

/** Asal/tujuan movement bisa slot rack atau slot lantai (staging / slot Return). */
function resolveEndpoint(locationId: string): MovementEndpoint | undefined {
  const slot = floorSlotById.get(locationId);
  if (slot) return { kind: "floor", slot };
  const location = locationById.get(locationId);
  const rack = location && rackById.get(location.rackId);
  return location && rack ? { kind: "rack", rack, location } : undefined;
}

/** Jumlah box pallet di sebuah location, dari stok sekarang. */
function getLocationBoxCount(locationId: string): number {
  const quantity = useWarehouseStore
    .getState()
    .inventory.filter((i) => i.locationId === locationId)
    .reduce((total, i) => total + i.quantity, 0);
  return getBoxCount(quantity, PALLET_CAPACITY);
}

const PARKING_COLOR = "#ca8a04";
/** Area parkir: menutupi fork (0,5 m di depan pose) sampai ujung belakang badan (1,85 m di belakang). */
const PARKING_SIZE = { width: 1.4, length: 2.8 };

/** Tanda area parkir forklift ke-`index` di lantai, di posisi home-nya. */
export function ForkliftParking({ index }: { index: number }) {
  const home = getHomePose(racks, index);
  const hw = PARKING_SIZE.width / 2;
  const hl = PARKING_SIZE.length / 2;
  // Tengah area = tengah badan forklift, di belakang pose (arah belakang = (sin h, cos h)).
  const center = getForkliftBodyCenter(home);
  return (
    // Kotak digambar memanjang searah z untuk heading π; diputar mengikuti heading parkir.
    <group position={[center.x, 0.015, center.z]} rotation={[0, home.heading - Math.PI, 0]}>
      <Line
        points={[
          [-hw, 0, -hl],
          [hw, 0, -hl],
          [hw, 0, hl],
          [-hw, 0, hl],
          [-hw, 0, -hl],
        ]}
        color={PARKING_COLOR}
        lineWidth={2}
      />
      <FloorLabel text={`P${index + 1}`} color={PARKING_COLOR} position={[-0.4, 0.01, hl - 0.2]} height={0.6} />
    </group>
  );
}

interface ForkliftProps {
  /** Id unik untuk koordinasi lalu lintas. */
  id: string;
  /** Urutan forklift; menentukan tempat parkirnya. */
  index: number;
}

/**
 * Forklift sederhana. Origin = titik tengah pallet di atas fork, menghadap -z.
 * Beberapa forklift berbagi antrean yang sama. Prioritas let-down (picker sedang menunggu),
 * lalu movement PENDING: angkat di asal, turunkan di tujuan, kembali parkir.
 * Let-down: ambil pallet di rack level atas, tahan rendah di aisle sampai picker selesai,
 * lalu kembalikan ke rack.
 */
export default function Forklift({ id, index }: ForkliftProps) {
  const movements = useWarehouseStore((s) => s.movements);
  const letDowns = useWarehouseStore((s) => s.letDowns);
  const bodyRef = useRef<Group>(null);
  const forkRef = useRef<Group>(null);
  const innerMastRef = useRef<Group>(null);

  const home = useMemo(() => getHomePose(racks, index), [index]);
  const pose = useRef<ForkliftPose>(home);
  const animation = useRef<Animation | null>(null);
  /** Let-down yang palletnya sedang ditahan di aisle, menunggu picker selesai. */
  const holding = useRef<string | null>(null);
  /** Lama forklift sudah berhenti mengalah. */
  const yieldTime = useRef(0);
  /** Jumlah box di pallet yang sedang dibawa; 0 = tidak membawa apa-apa. */
  const [carried, setCarried] = useState(0);

  const applyPose = useCallback((p: ForkliftPose) => {
    bodyRef.current?.position.set(p.x, 0, p.z);
    bodyRef.current?.rotation.set(0, p.heading, 0);
    forkRef.current?.position.setY(p.lift);
    innerMastRef.current?.position.setY(Math.max(0, p.lift - MAST_FREE_LIFT));
  }, []);

  const startNext = useCallback(() => {
    if (animation.current || holding.current) return;
    const store = useWarehouseStore.getState();
    const start = (job: Job, keyframes: ForkliftKeyframe[]) => {
      animation.current = { job, keyframes, index: 0, elapsed: 0, from: pose.current };
    };

    // Let-down dulu: picker sudah menunggu di ujung aisle.
    const letDown = store.letDowns.find((l) => l.status === "PENDING");
    const location = letDown && locationById.get(letDown.locationId);
    const rack = location && rackById.get(location.rackId);
    if (letDown && location && rack) {
      start({ kind: "letDown", id: letDown.id, stage: "down" }, buildLetDownTimeline(pose.current, racks, rack, location));
      store.setLetDownStatus(letDown.id, "FETCHING");
      return;
    }

    const next = store.movements.find((m) => m.status === "PENDING");
    const source = next && resolveEndpoint(next.fromLocationId);
    const target = next && resolveEndpoint(next.toLocationId);
    if (!next || !source || !target) return;
    start({ kind: "movement", id: next.id }, buildMovementTimeline(pose.current, racks, source, target, home));
    store.startMovement(next.id);
  }, [home]);

  useLayoutEffect(() => applyPose(pose.current), [applyPose]);
  useEffect(() => startNext(), [movements, letDowns, startNext]);

  const fireEvent = (keyframe: ForkliftKeyframe, job: Job) => {
    const store = useWarehouseStore.getState();
    if (job.kind === "movement") {
      const movement = store.movements.find((m) => m.id === job.id);
      if (keyframe.event === "pick" && movement) {
        setCarried(getBoxCount(movement.quantity, PALLET_CAPACITY));
        store.pickUpMovement(job.id);
      } else if (keyframe.event === "drop") {
        setCarried(0);
        store.completeMovement(job.id);
      }
      return;
    }

    const letDown = store.letDowns.find((l) => l.id === job.id);
    if (!letDown) return;
    if (keyframe.event === "pick") {
      setCarried(getLocationBoxCount(letDown.locationId));
      store.setLetDownStatus(job.id, "LOWERING");
    } else if (keyframe.event === "hold") {
      store.setLetDownStatus(job.id, "HOLDING");
    } else if (keyframe.event === "drop") {
      setCarried(0);
      store.setLetDownStatus(job.id, "DONE");
    }
  };

  useEffect(() => () => void traffic.forklifts.delete(id), [id]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, MAX_DELTA);
    const body = getForkliftBodyCenter(pose.current);
    traffic.forklifts.set(id, { body, look: body, yielding: false, holding: holding.current !== null });

    // Menahan pallet let-down: tunggu picker selesai, lalu kembalikan pallet ke rack.
    if (holding.current) {
      const store = useWarehouseStore.getState();
      const letDown = store.letDowns.find((l) => l.id === holding.current);
      const location = letDown && locationById.get(letDown.locationId);
      const rack = location && rackById.get(location.rackId);
      if (letDown?.status !== "PICKED" || !location || !rack) return;
      // Box yang tersisa setelah diambil picker.
      setCarried(getLocationBoxCount(location.id));
      animation.current = {
        job: { kind: "letDown", id: letDown.id, stage: "up" },
        keyframes: buildPutBackTimeline(pose.current, racks, rack, location, home),
        index: 0,
        elapsed: 0,
        from: pose.current,
      };
      holding.current = null;
      store.setLetDownStatus(letDown.id, "RETURNING");
    }

    const anim = animation.current;
    if (!anim) return;

    // Lihat sedikit ke depan di keyframe sekarang; kalau gerakan itu mendekati orang/forklift lain, tunggu.
    const current = anim.keyframes[anim.index];
    const look = getForkliftBodyCenter(
      interpolatePose(anim.from, current, Math.min((anim.elapsed + LOOKAHEAD) / current.duration, 1)),
    );
    const self = traffic.forklifts.get(id)!;
    self.look = look;
    if (forkliftShouldYield(id, body, look)) {
      yieldTime.current += dt;
      // Pengaman supaya tidak saling tunggu selamanya.
      if (yieldTime.current < MAX_YIELD_TIME) {
        self.yielding = true;
        return;
      }
    } else {
      yieldTime.current = 0;
    }

    anim.elapsed += dt;
    while (anim.index < anim.keyframes.length && anim.elapsed >= anim.keyframes[anim.index].duration) {
      const reached = anim.keyframes[anim.index];
      anim.elapsed -= reached.duration;
      anim.from = reached;
      anim.index++;
      fireEvent(reached, anim.job);
    }

    if (anim.index >= anim.keyframes.length) {
      pose.current = anim.from;
      applyPose(pose.current);
      animation.current = null;
      if (anim.job.kind === "letDown" && anim.job.stage === "down") holding.current = anim.job.id;
      else startNext();
      return;
    }

    const target = anim.keyframes[anim.index];
    pose.current = interpolatePose(anim.from, target, anim.elapsed / target.duration);
    applyPose(pose.current);
  });

  return (
    <group ref={bodyRef}>
      {/* Fork + pallet yang dibawa; naik-turun mengikuti lift. */}
      <group ref={forkRef}>
        {[-0.25, 0.25].map((x) => (
          <mesh key={x} position={[x, 0, 0]} castShadow>
            <boxGeometry args={[0.12, 0.05, 1]} />
            <meshStandardMaterial color={FRAME_COLOR} />
          </mesh>
        ))}
        <mesh position={[0, 0.3, 0.52]} castShadow>
          <boxGeometry args={[0.9, 0.6, 0.05]} />
          <meshStandardMaterial color={FRAME_COLOR} />
        </mesh>
        {carried > 0 && (
          <group position={[0, -FORK_ENTRY, 0]}>
            <PalletModel boxCount={carried} />
          </group>
        )}
      </group>

      {/* Mast: bagian luar tetap, bagian dalam ikut naik saat fork tinggi. */}
      {[-0.4, 0.4].map((x) => (
        <mesh key={x} position={[x, MAST_HEIGHT / 2, 0.6]} castShadow>
          <boxGeometry args={[0.08, MAST_HEIGHT, 0.08]} />
          <meshStandardMaterial color={FRAME_COLOR} />
        </mesh>
      ))}
      <group ref={innerMastRef}>
        {[-0.32, 0.32].map((x) => (
          <mesh key={x} position={[x, MAST_HEIGHT / 2, 0.62]} castShadow>
            <boxGeometry args={[0.07, MAST_HEIGHT, 0.07]} />
            <meshStandardMaterial color="#3f3f46" />
          </mesh>
        ))}
      </group>

      {/* Body + counterweight */}
      <mesh position={[0, 0.55, 1.25]} castShadow>
        <boxGeometry args={[1, 0.8, 1.2]} />
        <meshStandardMaterial color={BODY_COLOR} />
      </mesh>
      <mesh position={[0, 0.65, 1.78]} castShadow>
        <boxGeometry args={[1, 0.6, 0.14]} />
        <meshStandardMaterial color={FRAME_COLOR} />
      </mesh>

      {/* Overhead guard */}
      {[0.75, 1.7].flatMap((z) =>
        [-0.45, 0.45].map((x) => (
          <mesh key={`${x}-${z}`} position={[x, 1.55, z]}>
            <boxGeometry args={[0.05, 1.2, 0.05]} />
            <meshStandardMaterial color={FRAME_COLOR} />
          </mesh>
        )),
      )}
      <mesh position={[0, 2.15, 1.22]} castShadow>
        <boxGeometry args={[1, 0.05, 1.05]} />
        <meshStandardMaterial color={FRAME_COLOR} />
      </mesh>

      {/* Roda */}
      {[0.8, 1.65].flatMap((z) =>
        [-0.5, 0.5].map((x) => (
          <mesh key={`${x}-${z}`} position={[x, 0.2, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.2, 0.2, 0.15, 16]} />
            <meshStandardMaterial color="#18181b" />
          </mesh>
        )),
      )}
    </group>
  );
}
