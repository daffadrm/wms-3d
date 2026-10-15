import { Line } from "@react-three/drei";
import type { AreaType, WarehouseArea as WarehouseAreaData } from "@/types/warehouse";
import FloorLabel from "./FloorLabel";

const AREA_COLORS: Record<AreaType, string> = {
  ZONE: "#3b82f6",
  RECEIVING: "#16a34a",
  RETURN: "#e11d48",
  CHECKIN: "#0891b2",
  PACKING: "#d97706",
  SHIPPING: "#9333ea",
  SAMEDAY: "#00aa13",
  OFFICE: "#64748b",
  PANTRY: "#a16207",
};

// Sedikit di atas lantai/grid supaya tidak z-fighting.
const AREA_Y = 0.01;

export default function WarehouseArea({ area }: { area: WarehouseAreaData }) {
  const [x, z] = area.position;
  const [width, depth] = area.size;
  const color = AREA_COLORS[area.type];
  const hw = width / 2;
  const hd = depth / 2;

  return (
    <group position={[x, AREA_Y, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={color} transparent opacity={0.18} depthWrite={false} />
      </mesh>

      <Line
        points={[
          [-hw, 0.001, -hd],
          [hw, 0.001, -hd],
          [hw, 0.001, hd],
          [-hw, 0.001, hd],
          [-hw, 0.001, -hd],
        ]}
        color={color}
        lineWidth={2}
      />

      {/* Label di pojok depan-kiri area. */}
      <FloorLabel
        text={area.name}
        color={color}
        position={[-hw + 0.3, 0.01, hd - 0.15]}
        height={0.7}
      />
    </group>
  );
}
