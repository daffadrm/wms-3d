import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { locationById, rackById, racks } from "@/data/warehouse";
import {
  buildLetDownPickerRoute,
  buildPickerRoute,
  buildWalkwayRoute,
  getLetDownPickHeading,
  getPickerRackHeading,
} from "@/lib/movement";
import { pathLength, pointAlong, type Vec3 } from "@/lib/path";
import { pedestrianShouldWait, traffic } from "@/lib/traffic";
import { useWarehouseStore } from "@/store/warehouseStore";
import { CHECKIN_DROP_HEADING, getCheckinDropPoint } from "./CheckinArea";
import { Tote } from "./PackingStation";
import Worker, { WORKER_WALK_SPEED, type WorkerMotion } from "./Worker";

const VEST_COLOR = "#16a34a";
const WALK_SPEED = WORKER_WALK_SPEED;
/** Lama mengambil barang di depan rack (detik). */
const PICK_TIME = 1.5;
/** Lama meletakkan tote di meja check-in (detik). */
const DROP_TIME = 0.8;
const FACE_STANDBY = Math.PI;
/** Menunggu let-down di timur walkway, menghadap ke dalam gudang (-x). */
const FACE_WAIT = -Math.PI / 2; // standby di dinding selatan, menghadap ke dalam gudang (-z)

type Point = { x: number; z: number };
/** Tote di tangan picker: tidak ada, kosong (berangkat), atau berisi barang hasil pick. */
type ToteState = "none" | "empty" | "full";
/** toWait & waitLetDown hanya untuk let-down: menunggu forklift menurunkan pallet dari rack level atas. */
type Stage = "toWait" | "waitLetDown" | "toRack" | "picking" | "toCheckin" | "dropping" | "returning";

interface PickerTask {
  orderId: string;
  stage: Stage;
  t: number;
  /** Rute stage yang sedang berjalan (koordinat dunia, y = 0). */
  path: Vec3[];
  /** Let-down untuk order ini, plus rute dari titik tunggu ke samping pallet yang ditahan forklift. */
  letDown?: { id: string; toPick: Vec3[] };
}

const toPath = (points: Point[]): Vec3[] => points.map((p) => [p.x, 0, p.z]);

interface PickerProps {
  /** Id unik untuk koordinasi lalu lintas dengan forklift. */
  id: string;
  /** Tempat standby. */
  home: Point;
}

/**
 * Picker / orang inventory. Mengambil order pick & pack QUEUED berikutnya (beberapa picker berbagi
 * antrean yang sama): jalan ke rack, ambil barang ke tote, antar ke meja check-in, lalu kembali standby.
 */
export default function Picker({ id, home }: PickerProps) {
  const workerRef = useRef<Group>(null);
  const emptyToteRef = useRef<Group>(null);
  const fullToteRef = useRef<Group>(null);
  const motion = useRef<WorkerMotion>({ walking: false, holding: false });
  const task = useRef<PickerTask | null>(null);

  useEffect(() => () => void traffic.pedestrians.delete(id), [id]);

  useFrame((_, delta) => {
    const worker = workerRef.current;
    if (!worker) return;
    const dt = Math.min(delta, 0.1);
    const store = useWarehouseStore.getState();

    const place = (p: Point, heading: number, walking: boolean, holding: boolean, tote: ToteState) => {
      worker.position.set(p.x, 0, p.z);
      worker.rotation.y = heading;
      motion.current.walking = walking;
      motion.current.holding = holding;
      if (emptyToteRef.current) emptyToteRef.current.visible = tote === "empty";
      if (fullToteRef.current) fullToteRef.current.visible = tote === "full";
      traffic.pedestrians.set(id, p);
    };

    // Standby: ambil order berikutnya dari antrean.
    if (!task.current) {
      const order = store.packingOrders.find((o) => o.status === "QUEUED");
      const location = order && locationById.get(order.fromLocationId);
      const rack = location && rackById.get(location.rackId);
      if (!order || !location || !rack) {
        place(home, FACE_STANDBY, false, false, "none");
        return;
      }
      store.startPicking(order.id);
      const letDown = store.letDowns.find((l) => l.orderId === order.id && l.status !== "DONE");
      if (letDown) {
        // Rack level atas: tunggu di depan aisle sampai forklift menahan pallet di bawah.
        const route = buildLetDownPickerRoute(racks, home, rack, location);
        task.current = {
          orderId: order.id,
          stage: "toWait",
          t: 0,
          path: toPath(route.toWait),
          letDown: { id: letDown.id, toPick: toPath(route.toPick) },
        };
      } else {
        task.current = { orderId: order.id, stage: "toRack", t: 0, path: toPath(buildPickerRoute(racks, home, rack, location)) };
      }
    }

    const t = task.current;
    const order = store.packingOrders.find((o) => o.id === t.orderId);
    if (!order) {
      task.current = null;
      return;
    }

    // Berangkat membawa tote kosong, barang masuk tote saat diambil di rack, pulang tangan kosong.
    const beforePick = t.stage === "toWait" || t.stage === "waitLetDown" || t.stage === "toRack";
    const tote: ToteState = beforePick ? "empty" : t.stage === "returning" ? "none" : "full";
    const carrying = tote !== "none";
    switch (t.stage) {
      case "waitLetDown": {
        const end = t.path[t.path.length - 1];
        place({ x: end[0], z: end[2] }, FACE_WAIT, false, true, "empty");
        const status = store.letDowns.find((l) => l.id === t.letDown?.id)?.status;
        if (status === "HOLDING" && t.letDown) Object.assign(t, { stage: "toRack", t: 0, path: t.letDown.toPick });
        break;
      }

      case "toWait":
      case "toRack":
      case "toCheckin":
      case "returning": {
        // Tunggu di tempat kalau langkah berikutnya mendekati forklift (forklift punya prioritas).
        const now = pointAlong(t.path, t.t * WALK_SPEED).point;
        const next = pointAlong(t.path, (t.t + dt) * WALK_SPEED).point;
        const waiting = pedestrianShouldWait({ x: now[0], z: now[2] }, { x: next[0], z: next[2] });
        if (!waiting) t.t += dt;

        const along = t.t * WALK_SPEED;
        const { point, direction } = pointAlong(t.path, along);
        place({ x: point[0], z: point[2] }, Math.atan2(direction[0], direction[1]), !waiting, carrying, tote);
        if (along < pathLength(t.path)) break;

        if (t.stage === "toWait") {
          Object.assign(t, { stage: "waitLetDown", t: 0 });
        } else if (t.stage === "toRack") {
          Object.assign(t, { stage: "picking", t: 0 });
        } else if (t.stage === "toCheckin") {
          Object.assign(t, { stage: "dropping", t: 0 });
        } else {
          task.current = null;
        }
        break;
      }

      case "picking": {
        t.t += dt;
        const end = t.path[t.path.length - 1];
        // Tote terisi di tengah proses pengambilan. Let-down: menghadap pallet di fork, bukan rack.
        const rack = rackById.get(locationById.get(order.fromLocationId)?.rackId ?? "");
        const heading = !rack ? FACE_WAIT : t.letDown ? getLetDownPickHeading(rack) : getPickerRackHeading(rack);
        place({ x: end[0], z: end[2] }, heading, false, true, t.t < PICK_TIME / 2 ? "empty" : "full");
        if (t.t < PICK_TIME) break;

        store.pickOrderItems(t.orderId);
        // Forklift boleh mengembalikan pallet ke rack.
        if (t.letDown) store.setLetDownStatus(t.letDown.id, "PICKED");
        // Kembali ke lajur aisle (titik sebelum depan rack), lalu lewat walkway ke meja check-in.
        const [pick, aisle] = [t.path[t.path.length - 1], t.path[t.path.length - 2]];
        const aislePoint = { x: aisle[0], z: aisle[2] };
        const deliver = buildWalkwayRoute(racks, aislePoint, getCheckinDropPoint(order.stationId));
        Object.assign(t, { stage: "toCheckin", t: 0, path: [pick, ...toPath(deliver)] });
        break;
      }

      case "dropping": {
        t.t += dt;
        // Tote diletakkan di meja check-in di tengah gerakan.
        const end = t.path[t.path.length - 1];
        place({ x: end[0], z: end[2] }, CHECKIN_DROP_HEADING, false, true, t.t < DROP_TIME / 2 ? "full" : "none");
        if (t.t < DROP_TIME) break;

        store.arriveCheckin(t.orderId);
        Object.assign(t, {
          stage: "returning",
          t: 0,
          path: toPath(buildWalkwayRoute(racks, { x: end[0], z: end[2] }, home)),
        });
        break;
      }
    }
  });

  return (
    <Worker ref={workerRef} motion={motion} vestColor={VEST_COLOR}>
      <group ref={emptyToteRef} position={[0, 0.95, 0.42]} visible={false}>
        <Tote fill={0} />
      </group>
      <group ref={fullToteRef} position={[0, 0.95, 0.42]} visible={false}>
        <Tote fill={1} />
      </group>
    </Worker>
  );
}
