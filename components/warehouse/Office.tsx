import { useRef, type RefObject } from "react";
import { OFFICE_DOOR, warehouseLayout } from "@/data/warehouse";
import { useWarehouseStore } from "@/store/warehouseStore";
import WarehouseLogo from "./WarehouseLogo";
import Worker, { type WorkerMotion } from "./Worker";

// Semua koordinat di file ini koordinat dunia.
//
// Mezzanine (lantai 2) di pojok barat daya: Pantry di barat, Office di timur (ke arah Zone B), tangga
// di sela keduanya. Lantai bawahnya dibiarkan kosong. Pegawai masuk lewat pintu di dinding selatan
// (menghadap trotoar & parkiran); dari situ lurus masuk ke gudang, atau belok kiri ke kaki tangga.
// Tangga naik ke utara sampai landing; dari landing belok kiri (barat) ke Pantry, belok kanan (timur)
// ke Office. Turun ke gudang lewat tangga yang sama, atau lewat tangga timur Office: dari pintu di
// pojok tenggara Office turun ke utara, langsung ke aisle Zone B.
// Dinding kaca semi-transparan dan tanpa atap, supaya isi ruangan & area di belakangnya tetap terlihat;
// seluruh lantai 2 bisa disembunyikan lewat tombol "Lt. 2".

type Bounds = { west: number; east: number; north: number; south: number };

function getBounds(type: "OFFICE" | "PANTRY"): Bounds & { x: number; z: number } {
  const area = warehouseLayout.areas.find((a) => a.type === type)!;
  const [x, z] = area.position;
  const [w, d] = area.size;
  return { x, z, west: x - w / 2, east: x + w / 2, north: z - d / 2, south: z + d / 2 };
}

const OFFICE = getBounds("OFFICE");
const PANTRY = getBounds("PANTRY");

/** Tinggi permukaan lantai mezzanine. */
const FLOOR_Y = 3;
const SLAB_THICKNESS = 0.2;
const WALL_HEIGHT = 2.6;
const FRAME = 0.06;

const WALL_Z = warehouseLayout.depth / 2;

/**
 * Tangga lurus di sela Pantry & Office, naik ke utara sampai sejajar lantai mezzanine. Kakinya
 * dimundurkan dari dinding selatan & ada di barat pintu masuk, jadi pintu tidak tertutup tangga:
 * dari pintu bisa lurus masuk ke gudang, atau belok kiri ke tangga.
 */
const STAIR = { x: (PANTRY.east + OFFICE.west) / 2, width: 0.9, rise: 0.15, tread: 0.3 };
const STEP_COUNT = Math.round(FLOOR_Y / STAIR.rise);
const STAIR_BOTTOM_Z = WALL_Z - 1;
const STAIR_TOP_Z = STAIR_BOTTOM_Z - STEP_COUNT * STAIR.tread;
/** Landing di ujung atas tangga, menyambung Pantry & Office. */
const LANDING: Bounds = { west: PANTRY.east, east: OFFICE.west, north: OFFICE.north, south: STAIR_TOP_Z };
/** Pintu kaca Pantry (dinding timur) & Office (dinding barat), saling berhadapan di landing. */
const DOOR = { north: STAIR_TOP_Z - 1, south: STAIR_TOP_Z };

/**
 * Tangga timur menempel di luar dinding timur Office, turun ke utara: ujung atas di pojok tenggara
 * (landing + pintu kaca), kaki tangga di aisle di belakang rack Zone B paling selatan.
 */
const EAST_STAIR_X = OFFICE.east + 0.5;
const EAST_STAIR_TOP_Z = OFFICE.south - 1.2;
const EAST_STAIR_BOTTOM_Z = EAST_STAIR_TOP_Z - STEP_COUNT * STAIR.tread;
const EAST_LANDING: Bounds = { west: OFFICE.east, east: OFFICE.east + 1, north: EAST_STAIR_TOP_Z, south: OFFICE.south };
const EAST_DOOR = { north: EAST_STAIR_TOP_Z + 0.1, south: OFFICE.south - 0.1 };

const STEEL_COLOR = "#475569";
const GLASS_COLOR = "#bae6fd";

type Segment = { from: [x: number, z: number]; to: [x: number, z: number] };

/**
 * Dinding kaca keliling mezzanine: dinding utara menerus menutup Pantry, landing & Office; dinding
 * Pantry & Office yang menghadap tangga terpotong pintu di landing.
 */
const GLASS_WALLS: Segment[] = [
  { from: [PANTRY.west, PANTRY.north], to: [OFFICE.east, OFFICE.north] },
  { from: [PANTRY.west, PANTRY.north], to: [PANTRY.west, PANTRY.south] },
  { from: [PANTRY.west, PANTRY.south], to: [PANTRY.east, PANTRY.south] },
  { from: [PANTRY.east, PANTRY.north], to: [PANTRY.east, DOOR.north] },
  { from: [PANTRY.east, DOOR.south], to: [PANTRY.east, PANTRY.south] },
  { from: [OFFICE.west, OFFICE.north], to: [OFFICE.west, DOOR.north] },
  { from: [OFFICE.west, DOOR.south], to: [OFFICE.west, OFFICE.south] },
  { from: [OFFICE.west, OFFICE.south], to: [EAST_LANDING.east, OFFICE.south] },
  { from: [OFFICE.east, OFFICE.north], to: [OFFICE.east, EAST_DOOR.north] },
  { from: [OFFICE.east, EAST_DOOR.south], to: [OFFICE.east, OFFICE.south] },
  // Pagar kaca sisi timur landing tangga timur.
  { from: [EAST_LANDING.east, EAST_LANDING.north], to: [EAST_LANDING.east, EAST_LANDING.south] },
];

/** Kolom baja penyangga tiap ruangan: tiap sudut + tengah sisi utara & selatan. */
const COLUMNS: [x: number, z: number][] = [PANTRY, OFFICE].flatMap((b) =>
  [b.west + 0.15, b.x, b.east - 0.15].flatMap((x): [number, number][] => [
    [x, b.north + 0.15],
    [x, b.south - 0.15],
  ]),
);

const DESK = { width: 1.3, depth: 0.7, height: 0.75 };
/** Kursi kantor: `seatY` = tinggi permukaan dudukan. */
const CHAIR = { seatY: 0.45, size: 0.45, backHeight: 0.45 };

/**
 * Meja kerja berpasangan saling berhadapan (monitor saling membelakangi di tengah), 2 × 2 pasang.
 * Rotasi = arah sisi staf: π/2 → staf di timur meja menghadap barat, -π/2 → sebaliknya.
 */
const DESKS: { x: number; z: number; rotation: number }[] = [OFFICE.x - 1.8, OFFICE.x + 1.8].flatMap((cx) =>
  [OFFICE.z - 1.6, OFFICE.z + 1.4].flatMap((z) => [
    { x: cx + DESK.depth / 2, z, rotation: Math.PI / 2 },
    { x: cx - DESK.depth / 2, z, rotation: -Math.PI / 2 },
  ]),
);
const STAFF_SHIRT = "#e2e8f0";

/** Lantai mezzanine: satu slab per ruangan + landing (lubang tangga dibiarkan terbuka). */
const SLABS: Bounds[] = [PANTRY, OFFICE, LANDING, EAST_LANDING];

export default function Office() {
  const show = useWarehouseStore((s) => s.showUpperFloor);
  // Staf kantor diam di meja (tidak berjalan).
  const motion = useRef<WorkerMotion>({ walking: false, holding: true });

  return (
    <group>
      {/* Pintu masuk di lantai gudang selalu terlihat; hanya lantai 2 yang bisa disembunyikan. */}
      <EntranceDoor />
      <group visible={show}>
        {COLUMNS.map(([x, z]) => (
          <mesh
            key={`${x}-${z}`}
            position={[x, (FLOOR_Y - SLAB_THICKNESS) / 2, z]}
            castShadow
          >
            <boxGeometry args={[0.2, FLOOR_Y - SLAB_THICKNESS, 0.2]} />
            <meshStandardMaterial color={STEEL_COLOR} />
          </mesh>
        ))}

        {SLABS.map((b, i) => (
          <mesh
            key={i}
            position={[(b.west + b.east) / 2, FLOOR_Y - SLAB_THICKNESS / 2, (b.north + b.south) / 2]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[b.east - b.west, SLAB_THICKNESS, b.south - b.north]} />
            <meshStandardMaterial color="#cbd5e1" />
          </mesh>
        ))}

        {GLASS_WALLS.map((wall, i) => (
          <GlassWall key={i} {...wall} />
        ))}

        {/* Papan logo di kaca selatan Office, menghadap ke selatan (halaman depan & kamera awal) */}
        <WarehouseLogo
          position={[OFFICE.x, FLOOR_Y + 1.9, OFFICE.south + 0.05]}
          maxWidth={3.2}
          maxHeight={0.6}
        />

        {DESKS.map(({ x, z, rotation }, i) => (
          <group key={i} position={[x, FLOOR_Y, z]} rotation={[0, rotation, 0]}>
            <OfficeDesk />
            {/* Staf duduk di sisi depan meja, menghadap meja & rekan di seberangnya. */}
            <group position={[0, 0, DESK.depth / 2 + 0.45]} rotation={[0, Math.PI, 0]}>
              <OfficeChair />
              <Worker ref={null} motion={motion} vestColor={STAFF_SHIRT} seatHeight={CHAIR.seatY + 0.03} />
            </group>
          </group>
        ))}

        <Pantry motion={motion} />
        <Stairs x={STAIR.x} bottomZ={STAIR_BOTTOM_Z} up={-1} />
        <Stairs x={EAST_STAIR_X} bottomZ={EAST_STAIR_BOTTOM_Z} up={1} />
      </group>
    </group>
  );
}

const PANTRY_COUNTER = { depth: 0.6, length: 3, height: 0.9 };
const FRIDGE = { width: 0.7, depth: 0.7, height: 1.8 };
const DINING_TABLE = { width: 0.8, length: 1.4, height: 0.75 };
const STOOL = { radius: 0.18, height: 0.45 };

/**
 * Isi Pantry: kulkas & kitchen counter (dengan wastafel) di sepanjang dinding barat, meja makan
 * dengan bangku di tengah, dispenser air di pojok tenggara. Satu staf sedang di kitchen counter.
 */
function Pantry({ motion }: { motion: RefObject<WorkerMotion> }) {
  const counterX = PANTRY.west + PANTRY_COUNTER.depth / 2 + 0.05;
  const fridgeZ = PANTRY.north + FRIDGE.depth / 2 + 0.3;
  const counterZ = fridgeZ + FRIDGE.depth / 2 + 0.1 + PANTRY_COUNTER.length / 2;
  const table = { x: PANTRY.x + 0.6, z: PANTRY.z + 0.8 };

  return (
    <group position={[0, FLOOR_Y, 0]}>
      {/* Kulkas */}
      <mesh position={[PANTRY.west + FRIDGE.width / 2 + 0.05, FRIDGE.height / 2, fridgeZ]} castShadow>
        <boxGeometry args={[FRIDGE.width, FRIDGE.height, FRIDGE.depth]} />
        <meshStandardMaterial color="#e5e7eb" metalness={0.3} roughness={0.4} />
      </mesh>

      {/* Kitchen counter + wastafel */}
      <group position={[counterX, 0, counterZ]}>
        <mesh position={[0, PANTRY_COUNTER.height / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[PANTRY_COUNTER.depth, PANTRY_COUNTER.height, PANTRY_COUNTER.length]} />
          <meshStandardMaterial color="#78716c" />
        </mesh>
        <mesh position={[0, PANTRY_COUNTER.height + 0.015, 0]} receiveShadow>
          <boxGeometry args={[PANTRY_COUNTER.depth + 0.02, 0.03, PANTRY_COUNTER.length + 0.02]} />
          <meshStandardMaterial color="#f5f5f4" />
        </mesh>
        <mesh position={[0, PANTRY_COUNTER.height + 0.032, -0.6]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.4, 0.5]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.3} />
        </mesh>
        {/* Microwave & teko di atas counter */}
        <mesh position={[-0.05, PANTRY_COUNTER.height + 0.17, 0.8]} castShadow>
          <boxGeometry args={[0.4, 0.3, 0.5]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
        <mesh position={[0, PANTRY_COUNTER.height + 0.12, 0.1]} castShadow>
          <cylinderGeometry args={[0.08, 0.09, 0.2, 16]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
        {/* Staf membuat kopi, menghadap counter (barat). */}
        <group position={[PANTRY_COUNTER.depth / 2 + 0.35, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <Worker ref={null} motion={motion} vestColor={STAFF_SHIRT} />
        </group>
      </group>

      {/* Meja makan + bangku di kedua sisi panjangnya */}
      <group position={[table.x, 0, table.z]}>
        <mesh position={[0, DINING_TABLE.height, 0]} castShadow receiveShadow>
          <boxGeometry args={[DINING_TABLE.width, 0.05, DINING_TABLE.length]} />
          <meshStandardMaterial color="#d6a96b" />
        </mesh>
        <mesh position={[0, DINING_TABLE.height / 2, 0]}>
          <cylinderGeometry args={[0.05, 0.05, DINING_TABLE.height, 12]} />
          <meshStandardMaterial color={STEEL_COLOR} />
        </mesh>
        {[-1, 1].flatMap((side) =>
          [-0.35, 0.35].map((dz) => (
            <mesh
              key={`${side}-${dz}`}
              position={[side * (DINING_TABLE.width / 2 + 0.3), STOOL.height / 2, dz]}
              castShadow
            >
              <cylinderGeometry args={[STOOL.radius, STOOL.radius, STOOL.height, 16]} />
              <meshStandardMaterial color="#0f766e" />
            </mesh>
          )),
        )}
      </group>

      {/* Dispenser air di pojok tenggara */}
      <group position={[PANTRY.east - 0.35, 0, PANTRY.south - 0.35]}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <boxGeometry args={[0.35, 1, 0.35]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
        <mesh position={[0, 1.18, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.13, 0.36, 16]} />
          <meshStandardMaterial color="#38bdf8" transparent opacity={0.7} />
        </mesh>
      </group>
    </group>
  );
}

const DOOR_HEIGHT = 2.3;

/** Pintu masuk kantor di bukaan dinding selatan: kusen, kanopi kecil, daun pintu kaca terbuka ke dalam. */
function EntranceDoor() {
  const { x, width } = OFFICE_DOOR;
  return (
    <group position={[x, 0, WALL_Z]}>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[(side * (width + 0.12)) / 2, DOOR_HEIGHT / 2, 0]}
          castShadow
        >
          <boxGeometry args={[0.12, DOOR_HEIGHT, 0.25]} />
          <meshStandardMaterial color={STEEL_COLOR} />
        </mesh>
      ))}
      <mesh position={[0, DOOR_HEIGHT + 0.08, 0]} castShadow>
        <boxGeometry args={[width + 0.24, 0.16, 0.25]} />
        <meshStandardMaterial color={STEEL_COLOR} />
      </mesh>
      {/* Kanopi di luar pintu */}
      <mesh position={[0, DOOR_HEIGHT + 0.25, 0.55]} castShadow>
        <boxGeometry args={[width + 0.8, 0.06, 1]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      {/* Daun pintu kaca, terbuka 90° ke dalam dengan engsel di sisi timur (sisi barat ke arah tangga) */}
      <group position={[width / 2, 0, -0.06]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh position={[-width / 2, DOOR_HEIGHT / 2, 0]}>
          <boxGeometry args={[width, DOOR_HEIGHT - 0.05, 0.04]} />
          <meshStandardMaterial
            color={GLASS_COLOR}
            transparent
            opacity={0.35}
            depthWrite={false}
          />
        </mesh>
      </group>
    </group>
  );
}

/** Satu panel kaca lurus di atas lantai mezzanine, dengan rangka atas & tiang di ujungnya. */
function GlassWall({ from, to }: Segment) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const alongX = Math.abs(to[0] - from[0]) > Math.abs(to[1] - from[1]);
  const center: [number, number] = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
  ];
  const size = (
    along: number,
    height: number,
    across: number,
  ): [number, number, number] =>
    alongX ? [along, height, across] : [across, height, along];

  return (
    <group position={[center[0], FLOOR_Y, center[1]]}>
      <mesh position={[0, WALL_HEIGHT / 2, 0]}>
        <boxGeometry args={size(length, WALL_HEIGHT, 0.03)} />
        <meshStandardMaterial
          color={GLASS_COLOR}
          transparent
          opacity={0.22}
          depthWrite={false}
        />
      </mesh>
      {[FRAME / 2, WALL_HEIGHT - FRAME / 2].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={size(length, FRAME, FRAME)} />
          <meshStandardMaterial color={STEEL_COLOR} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={
            alongX
              ? [(side * length) / 2, WALL_HEIGHT / 2, 0]
              : [0, WALL_HEIGHT / 2, (side * length) / 2]
          }
        >
          <boxGeometry args={[FRAME, WALL_HEIGHT, FRAME]} />
          <meshStandardMaterial color={STEEL_COLOR} />
        </mesh>
      ))}
    </group>
  );
}

/** Meja kantor dengan monitor & keyboard. Origin = tengah-bawah meja di lantai mezzanine. */
function OfficeDesk() {
  return (
    <group>
      <mesh position={[0, DESK.height, 0]} castShadow receiveShadow>
        <boxGeometry args={[DESK.width, 0.05, DESK.depth]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[(side * (DESK.width - 0.1)) / 2, DESK.height / 2, 0]}
        >
          <boxGeometry args={[0.05, DESK.height, DESK.depth - 0.1]} />
          <meshStandardMaterial color={STEEL_COLOR} />
        </mesh>
      ))}
      <mesh position={[0, DESK.height + 0.25, -0.15]} castShadow>
        <boxGeometry args={[0.6, 0.36, 0.04]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      {/* Layar menyala, menghadap staf (+z) */}
      <mesh position={[0, DESK.height + 0.25, -0.125]}>
        <planeGeometry args={[0.54, 0.3]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
      <mesh position={[0, DESK.height + 0.035, 0.12]}>
        <boxGeometry args={[0.45, 0.02, 0.15]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
    </group>
  );
}

/** Kursi kantor beroda. Origin = tengah dudukan di lantai, staf menghadap +z (sandaran di -z). */
function OfficeChair() {
  const { seatY, size, backHeight } = CHAIR;
  return (
    <group>
      <mesh position={[0, seatY - 0.04, 0]} castShadow>
        <boxGeometry args={[size, 0.08, size]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      <mesh position={[0, seatY + backHeight / 2, -size / 2 + 0.03]} castShadow>
        <boxGeometry args={[size, backHeight, 0.06]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      <mesh position={[0, (seatY - 0.08) / 2, 0]}>
        <cylinderGeometry args={[0.03, 0.03, seatY - 0.08, 8]} />
        <meshStandardMaterial color={STEEL_COLOR} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.25, 0.25, 0.04, 5]} />
        <meshStandardMaterial color={STEEL_COLOR} />
      </mesh>
    </group>
  );
}

/**
 * Tangga baja lurus searah z dari lantai gudang ke lantai mezzanine, dengan pegangan di kedua sisi.
 * Kaki tangga di `bottomZ`; `up` = arah naik (-1 = ke utara, 1 = ke selatan).
 */
function Stairs({ x, bottomZ, up }: { x: number; bottomZ: number; up: -1 | 1 }) {
  const run = STEP_COUNT * STAIR.tread;
  const railLength = Math.hypot(run, FLOOR_Y);
  // Naik ke arah -z: diputar positif di sumbu x supaya ujung -z lebih tinggi; naik ke +z sebaliknya.
  const slope = -up * Math.atan2(FLOOR_Y, run);

  return (
    <group>
      {Array.from({ length: STEP_COUNT }, (_, i) => {
        const top = (i + 1) * STAIR.rise;
        return (
          <mesh
            key={i}
            position={[x, top - STAIR.rise / 2, bottomZ + up * (i + 0.5) * STAIR.tread]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[STAIR.width, STAIR.rise, STAIR.tread]} />
            <meshStandardMaterial color="#94a3b8" />
          </mesh>
        );
      })}
      {/* Rangka bawah miring di kedua sisi tangga */}
      {[-1, 1].map((side) => (
        <group
          key={side}
          position={[x + (side * (STAIR.width + 0.05)) / 2, 0, bottomZ + (up * run) / 2]}
        >
          <mesh
            position={[0, FLOOR_Y / 2, 0]}
            rotation={[slope, 0, 0]}
            castShadow
          >
            <boxGeometry args={[0.05, 0.2, railLength]} />
            <meshStandardMaterial color={STEEL_COLOR} />
          </mesh>
          {/* Pegangan tangan, sejajar kemiringan tangga */}
          <mesh position={[0, FLOOR_Y / 2 + 0.95, 0]} rotation={[slope, 0, 0]}>
            <boxGeometry args={[0.04, 0.04, railLength]} />
            <meshStandardMaterial color="#facc15" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
