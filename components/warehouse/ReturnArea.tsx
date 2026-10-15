import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import { RETURN_LAYOUT, returnSlots } from "@/data/warehouse";
import { isReturnPieceDamaged } from "@/lib/returns";
import { useStockByLocation, useWarehouseStore } from "@/store/warehouseStore";
import FloorSlotMarker from "./FloorSlotMarker";
import { FLOOR_PALLET_ROTATION, PARCEL_COLOR, ParcelPallet } from "./Pallets";
import Worker, { type WorkerMotion } from "./Worker";

// Koordinat dunia. Semua titik di garis z = RETURN_LAYOUT.z (sejajar dock retur):
// pallet paket retur (sisi dock) → petugas → pallet barang bagus RET-01 (sisi dalam gudang).
// Meja unboxing di utara petugas, bin karantina barang rusak di selatannya.

const { z: Z, sourceX, workerX, goodX, tableOffsetZ, binOffsetZ } = RETURN_LAYOUT;
/** Arah x dari pallet retur ke pallet barang bagus (+1 = ke timur). */
const INWARD = Math.sign(goodX - sourceX);
const RETURN_COLOR = "#e11d48";
const WORKER_VEST = "#e11d48";
const ITEM_COLOR = "#60a5fa";
const DAMAGED_COLOR = "#7f1d1d";

const TABLE = { width: 1, depth: 0.6, height: 0.9 };
const CARTON = { width: 0.4, height: 0.25, depth: 0.35 };
const ITEM = { width: 0.18, height: 0.12, depth: 0.14 };
const BIN = { width: 0.6, height: 0.5, depth: 0.5 };
/** Tumpukan kardus bekas di lantai, di samping ujung meja yang menghadap pallet barang bagus. */
const WASTE_POSITION: [number, number, number] = [workerX + INWARD * 0.85, 0, Z + tableOffsetZ];

const FACE = {
  source: (-INWARD * Math.PI) / 2,
  good: (INWARD * Math.PI) / 2,
  north: Math.PI,
  south: 0,
};

/** Tahapan membuka satu paket (detik). */
const STEP = { grab: 0.45, open: 0.85, inspect: 0.3, place: 0.45 };
const CYCLE = STEP.grab + STEP.open + STEP.inspect + STEP.place;
/** Porsi waktu "open" untuk tutup kardus terbuka; sisanya barang naik keluar dari kardus. */
const LID_SHARE = 0.6;
const LID_OPEN_ANGLE = 2.2;

/**
 * Return Area: pallet paket retur dari truk, petugas yang membuka paket satu per satu di meja,
 * memeriksa barangnya, lalu menaruh barang bagus di pallet RET-01 atau barang rusak di bin karantina.
 */
export default function ReturnArea() {
  const returnOrders = useWarehouseStore((s) => s.returnOrders);
  const stockByLocation = useStockByLocation();
  const order = returnOrders.find((r) => r.status !== "DONE");

  const workerRef = useRef<Group>(null);
  const handParcelRef = useRef<Mesh>(null);
  const handGoodRef = useRef<Mesh>(null);
  const handDamagedRef = useRef<Mesh>(null);
  const tableCartonRef = useRef<Group>(null);
  const lidRefs = [useRef<Group>(null), useRef<Group>(null)];
  const tableItemRef = useRef<Mesh>(null);
  const motion = useRef<WorkerMotion>({ walking: false, holding: false });
  const cycle = useRef<{ orderId: string; index: number; t: number } | null>(null);
  /** Paket yang sedang dipegang/dibuka sudah tidak dihitung di pallet sumber. */
  const [inHand, setInHand] = useState(false);
  const inHandRef = useRef(false);

  useFrame((_, delta) => {
    const worker = workerRef.current;
    if (!worker) return;
    const dt = Math.min(delta, 0.1);

    const setHolding = (value: boolean) => {
      if (inHandRef.current !== value) {
        inHandRef.current = value;
        setInHand(value);
      }
    };
    const show = (parcel: boolean, item: "none" | "good" | "damaged", carton: boolean) => {
      if (handParcelRef.current) handParcelRef.current.visible = parcel;
      if (handGoodRef.current) handGoodRef.current.visible = item === "good";
      if (handDamagedRef.current) handDamagedRef.current.visible = item === "damaged";
      if (tableCartonRef.current) tableCartonRef.current.visible = carton;
    };
    const pose = (heading: number, holding: boolean) => {
      worker.position.set(workerX, 0, Z);
      worker.rotation.y = heading;
      motion.current.walking = false;
      motion.current.holding = holding;
    };

    // Selesai semua paket (status DONE menyusul saat render berikutnya) → kembali diam.
    const finished = cycle.current?.orderId === order?.id && (cycle.current?.index ?? 0) >= (order?.quantity ?? 0);
    if (order?.status !== "UNBOXING" || finished) {
      cycle.current = null;
      setHolding(false);
      pose(FACE.north, false);
      show(false, "none", false);
      return;
    }

    if (cycle.current?.orderId !== order.id) cycle.current = { orderId: order.id, index: order.unboxedQuantity, t: 0 };
    const c = cycle.current;
    c.t += dt;
    const damaged = isReturnPieceDamaged(order, c.index);
    const item = damaged ? "damaged" : "good";
    let t = c.t;

    // 1. Ambil paket dari pallet retur.
    if (t < STEP.grab) {
      const grabbed = t > STEP.grab / 2;
      setHolding(grabbed);
      pose(FACE.source, true);
      show(grabbed, "none", false);
      return;
    }
    t -= STEP.grab;

    // 2. Taruh di meja (utara) dan buka: tutup kardus terbuka, barang naik keluar.
    if (t < STEP.open) {
      const progress = t / STEP.open;
      const lid = Math.min(progress / LID_SHARE, 1) * LID_OPEN_ANGLE;
      lidRefs[0].current?.rotation.set(lid, 0, 0);
      lidRefs[1].current?.rotation.set(-lid, 0, 0);
      const rise = Math.max(0, (progress - LID_SHARE) / (1 - LID_SHARE));
      if (tableItemRef.current) {
        tableItemRef.current.visible = progress > LID_SHARE;
        tableItemRef.current.position.y = CARTON.height * 0.4 + rise * 0.2;
      }
      pose(FACE.north, true);
      show(false, "none", true);
      return;
    }
    t -= STEP.open;
    if (tableItemRef.current) tableItemRef.current.visible = false;

    // 3. Periksa barang di tangan (kardus bekas dibuang ke tumpukan).
    if (t < STEP.inspect) {
      pose(FACE.north, true);
      show(false, item, false);
      return;
    }
    t -= STEP.inspect;

    // 4. Barang bagus ke pallet RET-01, barang rusak ke bin karantina (selatan).
    pose(damaged ? FACE.south : FACE.good, true);
    show(false, item, false);
    if (t < STEP.place) return;

    useWarehouseStore.getState().unboxOne(order.id);
    setHolding(false);
    Object.assign(c, { index: c.index + 1, t: c.t - CYCLE });
  });

  const status = order?.status;
  const sourceCount =
    order && (status === "ARRIVED" || status === "UNBOXING")
      ? order.quantity - order.unboxedQuantity - (inHand ? 1 : 0)
      : 0;
  const goodSlot = returnSlots[0];
  const goodCount = status === "UNBOXING" ? (order?.goodQuantity ?? 0) : (stockByLocation.get(goodSlot.id) ?? 0);
  const lastOrder = order ?? returnOrders[returnOrders.length - 1];
  const wasteCount = Math.min(lastOrder?.unboxedQuantity ?? 0, 12);
  const damagedCount = Math.min(lastOrder?.damagedQuantity ?? 0, 9);

  return (
    <group>
      {/* Pallet paket retur dari truk */}
      {sourceCount > 0 && (
        <group position={[sourceX, 0, Z]} rotation={[0, FLOOR_PALLET_ROTATION, 0]}>
          <ParcelPallet count={sourceCount} />
        </group>
      )}

      {/* Pallet barang bagus (RET-01), bisa di-putaway ke rack setelah unboxing selesai */}
      <FloorSlotMarker slot={goodSlot} color={RETURN_COLOR} occupied={stockByLocation.has(goodSlot.id)}>
        {goodCount > 0 && (
          <group rotation={[0, FLOOR_PALLET_ROTATION, 0]}>
            <ParcelPallet count={goodCount} color={ITEM_COLOR} />
          </group>
        )}
      </FloorSlotMarker>

      {/* Meja unboxing */}
      <group position={[workerX, 0, Z + tableOffsetZ]}>
        <mesh position={[0, TABLE.height, 0]} castShadow receiveShadow>
          <boxGeometry args={[TABLE.width, 0.05, TABLE.depth]} />
          <meshStandardMaterial color="#78716c" />
        </mesh>
        {[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <mesh
              key={`${sx}-${sz}`}
              position={[(sx * (TABLE.width - 0.08)) / 2, TABLE.height / 2, (sz * (TABLE.depth - 0.08)) / 2]}
            >
              <boxGeometry args={[0.05, TABLE.height, 0.05]} />
              <meshStandardMaterial color="#44403c" />
            </mesh>
          )),
        )}
        {/* Kardus yang sedang dibuka: dasar + dua tutup berengsel di sisi utara & selatan */}
        <group ref={tableCartonRef} position={[0, TABLE.height + 0.025, 0]} visible={false}>
          <mesh position={[0, CARTON.height / 2, 0]}>
            <boxGeometry args={[CARTON.width, CARTON.height, CARTON.depth]} />
            <meshStandardMaterial color={PARCEL_COLOR} />
          </mesh>
          {[1, -1].map((side, i) => (
            <group key={side} ref={lidRefs[i]} position={[0, CARTON.height, (side * CARTON.depth) / 2]}>
              <mesh position={[0, 0.005, (-side * CARTON.depth) / 4]}>
                <boxGeometry args={[CARTON.width, 0.01, CARTON.depth / 2]} />
                <meshStandardMaterial color="#c8975a" />
              </mesh>
            </group>
          ))}
          <mesh ref={tableItemRef} visible={false}>
            <boxGeometry args={[ITEM.width, ITEM.height, ITEM.depth]} />
            <meshStandardMaterial color={ITEM_COLOR} />
          </mesh>
        </group>
      </group>

      {/* Bin karantina barang rusak */}
      <group position={[workerX, 0, Z + binOffsetZ]}>
        <OpenBin />
        {Array.from({ length: damagedCount }, (_, n) => (
          <mesh
            key={n}
            position={[((n % 3) - 1) * 0.17, 0.08 + Math.floor(n / 3) * ITEM.height, 0]}
          >
            <boxGeometry args={[ITEM.width * 0.9, ITEM.height, ITEM.depth]} />
            <meshStandardMaterial color={DAMAGED_COLOR} />
          </mesh>
        ))}
      </group>

      {/* Tumpukan kardus bekas yang sudah dibuka (dilipat datar) */}
      <group position={WASTE_POSITION}>
        {Array.from({ length: wasteCount }, (_, n) => (
          <mesh key={n} position={[0, 0.015 + n * 0.03, 0]} rotation={[0, (n % 3) * 0.3, 0]}>
            <boxGeometry args={[0.55, 0.025, 0.45]} />
            <meshStandardMaterial color={n % 2 ? "#c8975a" : PARCEL_COLOR} />
          </mesh>
        ))}
      </group>

      <Worker ref={workerRef} motion={motion} vestColor={WORKER_VEST}>
        <mesh ref={handParcelRef} position={[0, 1.02, 0.45]} visible={false}>
          <boxGeometry args={[CARTON.width, CARTON.height, CARTON.depth]} />
          <meshStandardMaterial color={PARCEL_COLOR} />
        </mesh>
        <mesh ref={handGoodRef} position={[0, 1.1, 0.48]} visible={false}>
          <boxGeometry args={[ITEM.width, ITEM.height, ITEM.depth]} />
          <meshStandardMaterial color={ITEM_COLOR} />
        </mesh>
        <mesh ref={handDamagedRef} position={[0, 1.1, 0.48]} visible={false}>
          <boxGeometry args={[ITEM.width, ITEM.height, ITEM.depth]} />
          <meshStandardMaterial color={DAMAGED_COLOR} />
        </mesh>
      </Worker>
    </group>
  );
}

const BIN_WALL = 0.03;

/** Bin plastik merah tanpa tutup. Origin = tengah dasar bin. */
function OpenBin() {
  const { width: w, height: h, depth: d } = BIN;
  const walls: { position: [number, number, number]; size: [number, number, number] }[] = [
    { position: [0, BIN_WALL / 2, 0], size: [w, BIN_WALL, d] },
    { position: [0, h / 2, d / 2 - BIN_WALL / 2], size: [w, h, BIN_WALL] },
    { position: [0, h / 2, -d / 2 + BIN_WALL / 2], size: [w, h, BIN_WALL] },
    { position: [w / 2 - BIN_WALL / 2, h / 2, 0], size: [BIN_WALL, h, d] },
    { position: [-w / 2 + BIN_WALL / 2, h / 2, 0], size: [BIN_WALL, h, d] },
  ];
  return (
    <group>
      {walls.map((wall, i) => (
        <mesh key={i} position={wall.position} castShadow>
          <boxGeometry args={wall.size} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
      ))}
    </group>
  );
}
