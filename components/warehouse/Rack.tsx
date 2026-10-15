import { MeshStandardMaterial } from "three";
import type { Rack as RackData, WarehouseLocation } from "@/types/warehouse";
import { RACK_DIMENSIONS, getRackRotation, getRackSize } from "@/lib/warehouse";
import { unitBox } from "./sharedGeometry";
import FloorLabel from "./FloorLabel";
import Location, { type MoveTargetState } from "./Location";

const frameMaterial = new MeshStandardMaterial({ color: "#1e40af", metalness: 0.3, roughness: 0.6 });
const shelfMaterial = new MeshStandardMaterial({ color: "#f97316", roughness: 0.7 });

interface RackProps {
  rack: RackData;
  locations: WarehouseLocation[];
  stockByLocation: Map<string, number>;
  /** Hanya ada saat mode "pilih tujuan movement". */
  moveTargets?: Map<string, MoveTargetState>;
}

export default function Rack({ rack, locations, stockByLocation, moveTargets }: RackProps) {
  const { width, height, depth } = getRackSize(rack);
  const { slotWidth, levelHeight, postSize, shelfThickness } = RACK_DIMENSIONS;

  // Tiang di setiap batas slot, depan dan belakang.
  const postXs = Array.from({ length: rack.slotsPerLevel + 1 }, (_, i) => -width / 2 + i * slotWidth);
  // Papan di dasar tiap level, ditambah satu papan penutup di atas.
  const shelfYs = Array.from({ length: rack.levels + 1 }, (_, i) => i * levelHeight);

  return (
    // Model lokal: slot searah +x, sisi depan menghadap +z; diputar sesuai arah hadap rack.
    <group position={[rack.position[0], 0, rack.position[1]]} rotation={[0, getRackRotation(rack), 0]}>
      {postXs.flatMap((x) =>
        [-1, 1].map((side) => (
          <mesh
            key={`post-${x}-${side}`}
            geometry={unitBox}
            material={frameMaterial}
            position={[x, height / 2, (side * (depth - postSize)) / 2]}
            scale={[postSize, height, postSize]}
            castShadow
          />
        )),
      )}

      {shelfYs.map((y) => (
        <mesh
          key={`shelf-${y}`}
          geometry={unitBox}
          material={shelfMaterial}
          position={[0, y + shelfThickness / 2, 0]}
          scale={[width + postSize, shelfThickness, depth]}
          castShadow
          receiveShadow
        />
      ))}

      {locations.map((location) => (
        <Location
          key={location.id}
          location={location}
          rack={rack}
          stock={stockByLocation.get(location.id) ?? 0}
          moveTarget={moveTargets?.get(location.id)}
        />
      ))}

      {/* Kode rack di lantai, tepat di depan rack. */}
      <FloorLabel
        text={rack.code}
        color="#1e293b"
        position={[-width / 2, 0.02, depth / 2 + 0.65]}
        height={0.5}
      />
    </group>
  );
}
