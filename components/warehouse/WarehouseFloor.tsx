import { Grid } from "@react-three/drei";
import type { DockDoor } from "@/types/warehouse";
import { OFFICE_DOOR, SAMEDAY_COUNTER } from "@/data/warehouse";
import WarehouseLogo from "./WarehouseLogo";

interface WarehouseFloorProps {
  width: number;
  depth: number;
  wallHeight: number;
  /** Pintu dock; dinding barat/timur dibuat berlubang di posisi ini. */
  docks: DockDoor[];
}

export const WALL_THICKNESS = 0.2;
/** Lebar yard (area truk) di luar dinding yang punya dock; cukup untuk truk berbelok & mundur ke dock. */
export const YARD_WIDTH = 22;
/** Yard diperpanjang ke utara melewati gudang, ruang truk maju sebelum mundur ke dock. */
const YARD_NORTH_EXTRA = 8;

type Wall = { position: [number, number, number]; size: [number, number, number] };

/** Dinding sepanjang z di posisi x, dipotong menjadi beberapa segmen di antara pintu dock. */
function buildSideWall(x: number, depth: number, wallHeight: number, docks: DockDoor[]): Wall[] {
  const segments: Wall[] = [];
  const addSegment = (from: number, to: number) => {
    if (to > from) {
      segments.push({ position: [x, wallHeight / 2, (from + to) / 2], size: [WALL_THICKNESS, wallHeight, to - from] });
    }
  };

  let start = -depth / 2;
  for (const dock of [...docks].sort((a, b) => a.z - b.z)) {
    addSegment(start, dock.z - dock.width / 2);
    start = dock.z + dock.width / 2;
  }
  addSegment(start, depth / 2);
  return segments;
}

export default function WarehouseFloor({ width, depth, wallHeight, docks }: WarehouseFloorProps) {
  const westDocks = docks.filter((d) => d.wall === "WEST");
  const eastDocks = docks.filter((d) => d.wall === "EAST");
  // Dinding utara berlubang di loket Sameday (lubangnya diisi meja loket, lihat SamedayCounter).
  const loketWest = SAMEDAY_COUNTER.x - SAMEDAY_COUNTER.width / 2;
  const loketEast = SAMEDAY_COUNTER.x + SAMEDAY_COUNTER.width / 2;
  const northWall = (from: number, to: number): Wall => ({
    position: [(from + to) / 2, wallHeight / 2, -depth / 2],
    size: [to - from, wallHeight, WALL_THICKNESS],
  });
  // Dinding selatan berlubang di pintu masuk kantor (lihat Office).
  const doorWest = OFFICE_DOOR.x - OFFICE_DOOR.width / 2;
  const doorEast = OFFICE_DOOR.x + OFFICE_DOOR.width / 2;
  const southWall = (from: number, to: number): Wall => ({
    position: [(from + to) / 2, wallHeight / 2, depth / 2],
    size: [to - from, wallHeight, WALL_THICKNESS],
  });
  const walls: Wall[] = [
    northWall(-width / 2, loketWest),
    northWall(loketEast, width / 2),
    southWall(-width / 2, doorWest),
    southWall(doorEast, width / 2),
    ...buildSideWall(-width / 2, depth, wallHeight, westDocks),
    ...buildSideWall(width / 2, depth, wallHeight, eastDocks),
  ];
  // Yard aspal di luar dinding yang punya dock, tempat truk parkir.
  const yardXs = [
    ...(westDocks.length ? [-width / 2 - YARD_WIDTH / 2] : []),
    ...(eastDocks.length ? [width / 2 + YARD_WIDTH / 2] : []),
  ];

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#d4d4d8" roughness={0.9} />
      </mesh>

      {yardXs.map((x) => (
        <mesh key={x} position={[x, -0.01, -YARD_NORTH_EXTRA / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[YARD_WIDTH, depth + YARD_NORTH_EXTRA]} />
          <meshStandardMaterial color="#52525b" roughness={1} />
        </mesh>
      ))}

      <Grid
        position={[0, 0.005, 0]}
        args={[width, depth]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#a1a1aa"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#71717a"
        fadeDistance={120}
      />

      {walls.map((wall, i) => (
        <mesh key={i} position={wall.position} castShadow receiveShadow>
          <boxGeometry args={wall.size} />
          <meshStandardMaterial color="#94a3b8" />
        </mesh>
      ))}

      {/* Logo gudang di sisi luar dinding selatan, yang menghadap kamera awal. */}
      <WarehouseLogo
        position={[0, wallHeight / 2, depth / 2 + WALL_THICKNESS / 2]}
        maxWidth={width / 4}
        maxHeight={wallHeight * 0.75}
      />
    </group>
  );
}
