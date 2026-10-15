import { useRef } from "react";
import WarehouseLogo from "./WarehouseLogo";
import Motorbike from "./Motorbike";
import FloorLabel from "./FloorLabel";
import Worker, { type WorkerMotion } from "./Worker";
import { WALL_THICKNESS, YARD_WIDTH } from "./WarehouseFloor";

// Halaman depan di selatan gudang (z > depth/2). Masuk lewat gerbang di sisi barat,
// jalan lurus ke timur: gudang di kiri (utara), smoking area & parkiran mobil di kanan (selatan).
// Jalan ini tersambung ke yard truk barat & timur; truk dock keluar-masuk lewat gerbang.

const ASPHALT_COLOR = "#52525b";
const FENCE_COLOR = "#475569";

/** Trotoar di depan dinding gudang. */
const SIDEWALK_DEPTH = 1;
/** Dua lajur truk (masuk & keluar) + ruang motor di kedua tepi. */
const ROAD_WIDTH = 8;
const SLOT = { width: 2.6, length: 5 };
const SLOT_COUNT = 12;
/** Jarak ujung slot parkir ke pagar selatan. */
const BACK_MARGIN = 1.5;
/** Kedalaman halaman depan dari dinding selatan sampai pagar. */
export const FRONT_YARD_DEPTH = SIDEWALK_DEPTH + ROAD_WIDTH + SLOT.length + BACK_MARGIN;

/** Panjang jalan umum di luar gerbang (tempat truk muncul & menghilang). */
export const OUTSIDE_ROAD_LENGTH = 24;

const FENCE_HEIGHT = 1.1;
const FENCE_POST_SPACING = 2;
const GATE_HEIGHT = 4;

/** Slot yang terisi mobil, deterministik supaya tampilan sama setiap reload. */
const PARKED_PATTERN = [1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1];
const CAR_COLORS = ["#dc2626", "#f8fafc", "#1e293b", "#2563eb", "#a1a1aa", "#16a34a", "#f59e0b"];

/** Parkiran motor di timur parkiran mobil, juga di selatan jalan, moncong menghadap jalan. */
const MOTOR_SLOT = { width: 1, length: 2.2 };
const MOTOR_SLOT_COUNT = 14;
/** Jarak parkiran motor dari ujung timur parkiran mobil. */
const MOTOR_PARK_GAP = 1.5;
const PARKED_MOTOR_PATTERN = [1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1];
const MOTOR_COLORS = ["#1e293b", "#dc2626", "#f8fafc", "#2563eb", "#71717a", "#0f766e"];

/** Smoking area beratap di selatan jalan, di barat parkiran mobil. */
const SMOKING = { width: 4, depth: 3.5, roofHeight: 2.5 };
/** Jarak smoking area dari ujung barat parkiran mobil. */
const SMOKING_GAP = 6;
/** Tebal lantai beton smoking area & tinggi permukaan dudukan bangku dari lantai itu. */
const PAD_HEIGHT = 0.1;
const BENCH_SEAT_Y = 0.45;

interface FrontYardProps {
  /** Lebar & kedalaman lantai gudang. */
  width: number;
  depth: number;
}

type Box = { position: [number, number, number]; size: [number, number, number] };

/** Pagar lurus dari `from` ke `to` (koordinat x/z), berupa tiang + dua rel. */
function buildFence(from: [number, number], to: [number, number]): Box[] {
  const [x1, z1] = from;
  const [x2, z2] = to;
  const length = Math.hypot(x2 - x1, z2 - z1);
  const alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
  const mid: [number, number] = [(x1 + x2) / 2, (z1 + z2) / 2];
  const railSize = (h: number): [number, number, number] => (alongX ? [length, h, 0.06] : [0.06, h, length]);

  const posts = Math.max(1, Math.round(length / FENCE_POST_SPACING));
  return [
    ...Array.from({ length: posts + 1 }, (_, i): Box => {
      const t = i / posts;
      return {
        position: [x1 + (x2 - x1) * t, FENCE_HEIGHT / 2, z1 + (z2 - z1) * t],
        size: [0.12, FENCE_HEIGHT, 0.12],
      };
    }),
    { position: [mid[0], FENCE_HEIGHT - 0.1, mid[1]], size: railSize(0.08) },
    { position: [mid[0], 0.35, mid[1]], size: railSize(0.08) },
  ];
}

/**
 * Posisi gerbang (x), garis tengah jalan masuk (z), serta tepi utara (sisi trotoar gudang) & selatan jalan (z);
 * dipakai juga untuk rute truk & motor Gojek.
 */
export function getFrontRoad(width: number, depth: number) {
  const roadStart = depth / 2 + WALL_THICKNESS / 2 + SIDEWALK_DEPTH;
  return {
    gateX: -(width / 2 + YARD_WIDTH),
    centerZ: roadStart + ROAD_WIDTH / 2,
    northZ: roadStart,
    southZ: roadStart + ROAD_WIDTH,
  };
}

export default function FrontYard({ width, depth }: FrontYardProps) {
  const { gateX, centerZ: roadCenter } = getFrontRoad(width, depth);
  const halfX = -gateX;
  const wallZ = depth / 2 + WALL_THICKNESS / 2;
  const roadStart = roadCenter - ROAD_WIDTH / 2;
  const roadEnd = roadStart + ROAD_WIDTH;
  const slotCenterZ = roadEnd + SLOT.length / 2;
  const fenceZ = wallZ + FRONT_YARD_DEPTH;
  const slotsStartX = (-SLOT_COUNT * SLOT.width) / 2;
  const motorStartX = -slotsStartX + MOTOR_PARK_GAP;
  const motorCenterZ = roadEnd + MOTOR_SLOT.length / 2;

  const fences = [
    ...buildFence([-halfX, fenceZ], [halfX, fenceZ]),
    ...buildFence([halfX, wallZ], [halfX, fenceZ]),
    // Sisi barat terbuka selebar jalan untuk gerbang.
    ...buildFence([-halfX, wallZ], [-halfX, roadStart - 0.5]),
    ...buildFence([-halfX, roadEnd + 0.5], [-halfX, fenceZ]),
  ];

  const dashStartX = -halfX - OUTSIDE_ROAD_LENGTH;
  const dashCount = Math.floor((halfX * 2 + OUTSIDE_ROAD_LENGTH) / 4);

  return (
    <group>
      {/* Aspal seluruh halaman depan */}
      <mesh position={[0, -0.01, (wallZ + fenceZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[halfX * 2, FRONT_YARD_DEPTH]} />
        <meshStandardMaterial color={ASPHALT_COLOR} roughness={1} />
      </mesh>

      {/* Jalan umum di luar gerbang */}
      <mesh
        position={[-halfX - OUTSIDE_ROAD_LENGTH / 2, -0.01, roadCenter]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[OUTSIDE_ROAD_LENGTH, ROAD_WIDTH]} />
        <meshStandardMaterial color={ASPHALT_COLOR} roughness={1} />
      </mesh>

      {/* Trotoar di depan dinding gudang */}
      <mesh position={[0, 0.04, wallZ + SIDEWALK_DEPTH / 2]} receiveShadow>
        <boxGeometry args={[width, 0.08, SIDEWALK_DEPTH]} />
        <meshStandardMaterial color="#d4d4d8" />
      </mesh>

      {/* Marka putus-putus di tengah jalan */}
      {Array.from({ length: dashCount }, (_, i) => (
        <mesh key={i} position={[dashStartX + 2 + i * 4, 0.005, roadCenter]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2, 0.15]} />
          <meshStandardMaterial color="#facc15" />
        </mesh>
      ))}

      {/* Garis slot parkir */}
      {Array.from({ length: SLOT_COUNT + 1 }, (_, i) => (
        <mesh key={i} position={[slotsStartX + i * SLOT.width, 0.005, slotCenterZ]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.1, SLOT.length]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
      ))}
      <mesh position={[0, 0.005, roadEnd + SLOT.length]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[SLOT_COUNT * SLOT.width, 0.1]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>

      {/* Mobil parkir, moncong menghadap jalan */}
      {PARKED_PATTERN.map((parked, i) =>
        parked ? (
          <Car
            key={i}
            position={[slotsStartX + (i + 0.5) * SLOT.width, slotCenterZ]}
            color={CAR_COLORS[i % CAR_COLORS.length]}
          />
        ) : null,
      )}

      {/* Parkiran motor: garis slot + motor parkir */}
      {Array.from({ length: MOTOR_SLOT_COUNT + 1 }, (_, i) => (
        <mesh
          key={`motor-line-${i}`}
          position={[motorStartX + i * MOTOR_SLOT.width, 0.005, motorCenterZ]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[0.08, MOTOR_SLOT.length]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
      ))}
      <mesh
        position={[motorStartX + (MOTOR_SLOT_COUNT * MOTOR_SLOT.width) / 2, 0.005, roadEnd + MOTOR_SLOT.length]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[MOTOR_SLOT_COUNT * MOTOR_SLOT.width, 0.08]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <FloorLabel
        text="PARKIR MOTOR"
        color="#f8fafc"
        position={[motorStartX + 0.1, 0.006, roadEnd + MOTOR_SLOT.length + 0.9]}
        height={0.6}
      />
      {PARKED_MOTOR_PATTERN.map((parked, i) =>
        parked ? (
          // Moncong menghadap jalan (-z).
          <group
            key={`motor-${i}`}
            position={[motorStartX + (i + 0.5) * MOTOR_SLOT.width, 0, motorCenterZ]}
            rotation={[0, Math.PI, 0]}
          >
            <Motorbike color={MOTOR_COLORS[i % MOTOR_COLORS.length]} />
          </group>
        ) : null,
      )}

      {fences.map((box, i) => (
        <mesh key={i} position={box.position} castShadow>
          <boxGeometry args={box.size} />
          <meshStandardMaterial color={FENCE_COLOR} />
        </mesh>
      ))}

      <SmokingArea x={slotsStartX - SMOKING_GAP - SMOKING.width / 2} z={roadEnd + 0.5 + SMOKING.depth / 2} />

      <Gate x={-halfX} zStart={roadStart} zEnd={roadEnd} />
      <GuardPost position={[-halfX + 4, roadEnd + 2]} />
    </group>
  );
}

/** Gerbang masuk: dua pilar + balok atas berlogo, pintu geser dalam posisi terbuka. */
function Gate({ x, zStart, zEnd }: { x: number; zStart: number; zEnd: number }) {
  const span = zEnd - zStart + 1;
  const center = (zStart + zEnd) / 2;
  const beamY = GATE_HEIGHT - 0.6;

  return (
    <group>
      {[zStart - 0.5, zEnd + 0.5].map((z) => (
        <mesh key={z} position={[x, GATE_HEIGHT / 2, z]} castShadow>
          <boxGeometry args={[0.5, GATE_HEIGHT, 0.5]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
      ))}
      <mesh position={[x, beamY, center]} castShadow>
        <boxGeometry args={[0.3, 1.2, span]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      {/* Logo di kedua sisi balok: menghadap luar (-x) dan ke dalam halaman (+x). */}
      <WarehouseLogo position={[x - 0.15, beamY, center]} rotationY={-Math.PI / 2} maxWidth={span - 1.5} maxHeight={0.9} />
      <WarehouseLogo position={[x + 0.15, beamY, center]} rotationY={Math.PI / 2} maxWidth={span - 1.5} maxHeight={0.9} />

      {/* Pintu geser terbuka, terparkir di sisi dalam pagar selatan gerbang */}
      <group position={[x + 0.4, 0, zEnd + 0.5 + (zEnd - zStart) / 2]}>
        {[0.15, 1.35].map((y) => (
          <mesh key={y} position={[0, y, 0]} castShadow>
            <boxGeometry args={[0.08, 0.1, zEnd - zStart]} />
            <meshStandardMaterial color={FENCE_COLOR} />
          </mesh>
        ))}
        {Array.from({ length: Math.floor((zEnd - zStart) / 0.4) + 1 }, (_, i) => (
          <mesh key={i} position={[0, 0.75, -(zEnd - zStart) / 2 + i * 0.4]} castShadow>
            <boxGeometry args={[0.04, 1.2, 0.04]} />
            <meshStandardMaterial color={FENCE_COLOR} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/**
 * Smoking area: lantai beton, atap kanopi di 4 tiang, bangku di sisi belakang (selatan), asbak berdiri,
 * label di lantai, dan satu pegawai sedang merokok. Origin (`x`, `z`) = tengah lantai.
 */
function SmokingArea({ x, z }: { x: number; z: number }) {
  const { width: w, depth: d, roofHeight } = SMOKING;
  const motion = useRef<WorkerMotion>({ walking: false, holding: false });
  const benchZ = d / 2 - 0.45;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, PAD_HEIGHT / 2, 0]} receiveShadow>
        <boxGeometry args={[w, PAD_HEIGHT, d]} />
        <meshStandardMaterial color="#a8a29e" />
      </mesh>

      {/* Tiang + atap kanopi */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}-${sz}`} position={[(sx * (w - 0.2)) / 2, roofHeight / 2, (sz * (d - 0.2)) / 2]} castShadow>
            <boxGeometry args={[0.1, roofHeight, 0.1]} />
            <meshStandardMaterial color={FENCE_COLOR} />
          </mesh>
        )),
      )}
      <mesh position={[0, roofHeight + 0.05, 0]} castShadow>
        <boxGeometry args={[w + 0.4, 0.1, d + 0.4]} />
        <meshStandardMaterial color="#15803d" />
      </mesh>

      {/* Bangku di sisi belakang */}
      <group position={[0, PAD_HEIGHT, benchZ]}>
        <mesh position={[0, BENCH_SEAT_Y - 0.03, 0]} castShadow>
          <boxGeometry args={[w - 0.8, 0.06, 0.4]} />
          <meshStandardMaterial color="#a16207" />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[(side * (w - 1.2)) / 2, 0.2, 0]}>
            <boxGeometry args={[0.06, 0.4, 0.35]} />
            <meshStandardMaterial color={FENCE_COLOR} />
          </mesh>
        ))}
      </group>

      {/* Asbak berdiri di depan bangku */}
      <group position={[1.4, PAD_HEIGHT, benchZ - 0.9]}>
        <mesh position={[0, 0.4, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.8, 8]} />
          <meshStandardMaterial color="#27272a" />
        </mesh>
        <mesh position={[0, 0.85, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.12, 0.1, 16]} />
          <meshStandardMaterial color="#71717a" metalness={0.6} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.18, 0.18, 0.04, 16]} />
          <meshStandardMaterial color="#27272a" />
        </mesh>
      </group>

      {/* Pegawai merokok, duduk di bangku menghadap jalan (-z) */}
      <group position={[0.8, PAD_HEIGHT, benchZ]} rotation={[0, Math.PI, 0]}>
        <Worker ref={null} motion={motion} vestColor="#e2e8f0" seatHeight={BENCH_SEAT_Y + 0.03} />
      </group>

      <FloorLabel text="SMOKING AREA" color="#f8fafc" position={[-w / 2 + 0.2, 0.11, -d / 2 + 0.25]} height={0.4} />
    </group>
  );
}

/** Pos satpam kecil di samping gerbang. */
function GuardPost({ position: [x, z] }: { position: [x: number, z: number] }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[2, 2.2, 2]} />
        <meshStandardMaterial color="#f1f5f9" />
      </mesh>
      <mesh position={[0, 2.3, 0]} castShadow>
        <boxGeometry args={[2.5, 0.2, 2.5]} />
        <meshStandardMaterial color="#1d4ed8" />
      </mesh>
      {/* Jendela menghadap jalan (-z) dan gerbang (-x) */}
      <mesh position={[0, 1.4, -1.01]}>
        <planeGeometry args={[1.4, 0.7]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[-1.01, 1.4, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[1.2, 0.7]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
    </group>
  );
}

/** Mobil sederhana. Origin = tengah-bawah, moncong ke -z. */
function Car({ position: [x, z], color }: { position: [x: number, z: number]; color: string }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.6, 0]} castShadow>
        <boxGeometry args={[1.8, 0.6, 4.2]} />
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} />
      </mesh>
      {/* Kabin kaca gelap */}
      <mesh position={[0, 1.15, 0.2]} castShadow>
        <boxGeometry args={[1.6, 0.55, 2.2]} />
        <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.2} />
      </mesh>
      {[-1.35, 1.35].flatMap((wz) =>
        [-1, 1].map((side) => (
          <mesh key={`${wz}-${side}`} position={[side * 0.85, 0.35, wz]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.35, 0.35, 0.25, 16]} />
            <meshStandardMaterial color="#18181b" />
          </mesh>
        )),
      )}
      {/* Lampu depan */}
      {[-0.6, 0.6].map((lx) => (
        <mesh key={lx} position={[lx, 0.7, -2.11]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[0.35, 0.15]} />
          <meshBasicMaterial color="#fef9c3" />
        </mesh>
      ))}
    </group>
  );
}
