import { Edges, useCursor } from "@react-three/drei";
import { MeshStandardMaterial } from "three";
import type { LocationStatus, Rack, WarehouseLocation } from "@/types/warehouse";
import {
  LOCATION_STATUSES,
  RACK_DIMENSIONS,
  STATUS_COLORS,
  getLevelFloorY,
  getLocationStatus,
  getSlotX,
} from "@/lib/warehouse";
import { useWarehouseStore } from "@/store/warehouseStore";
import { unitBox } from "./sharedGeometry";

function createStatusMaterials(opacity: (status: LocationStatus) => number, emissiveIntensity: number) {
  return Object.fromEntries(
    LOCATION_STATUSES.map((status) => [
      status,
      new MeshStandardMaterial({
        color: STATUS_COLORS[status],
        emissive: STATUS_COLORS[status],
        emissiveIntensity,
        transparent: true,
        opacity: opacity(status),
        depthWrite: false,
      }),
    ]),
  ) as Record<LocationStatus, MeshStandardMaterial>;
}

// Material dipakai bersama semua location: satu set per kondisi (normal/hover/selected).
// Transparan supaya pallet di dalamnya tetap terlihat.
const MATERIALS = {
  normal: createStatusMaterials((s) => (s === "EMPTY" ? 0.12 : 0.35), 0),
  hovered: createStatusMaterials(() => 0.55, 0.35),
  selected: createStatusMaterials(() => 0.7, 0.6),
};
// Saat memilih tujuan movement: tujuan valid berwarna biru, yang tidak bisa menerima dibuat pudar.
const TARGET_COLOR = "#2563eb";
const TARGET_MATERIALS = {
  normal: new MeshStandardMaterial({
    color: TARGET_COLOR,
    emissive: TARGET_COLOR,
    emissiveIntensity: 0.2,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  }),
  hovered: new MeshStandardMaterial({
    color: TARGET_COLOR,
    emissive: TARGET_COLOR,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  }),
};
/** Sorotan hasil search (mis. semua location berisi SKU yang dicari). */
const HIGHLIGHT_COLOR = "#d946ef";
const HIGHLIGHT_MATERIAL = new MeshStandardMaterial({
  color: HIGHLIGHT_COLOR,
  emissive: HIGHLIGHT_COLOR,
  emissiveIntensity: 0.6,
  transparent: true,
  opacity: 0.7,
  depthWrite: false,
});
const DISABLED_MATERIAL = new MeshStandardMaterial({
  color: "#64748b",
  transparent: true,
  opacity: 0.06,
  depthWrite: false,
});

const SELECTED_EDGE_COLOR = "#1d4ed8";

// Jarak kosong antara kotak location dan rangka rack.
const GAP = 0.06;

/** Hanya diisi saat mode "pilih tujuan movement". */
export type MoveTargetState = "valid" | "invalid";

interface LocationProps {
  location: WarehouseLocation;
  rack: Rack;
  stock: number;
  moveTarget?: MoveTargetState;
}

export default function Location({ location, rack, stock, moveTarget }: LocationProps) {
  // Selector boolean: hanya location yang berubah state-nya yang re-render.
  const isSelected = useWarehouseStore((s) => s.selectedLocationId === location.id);
  const isHovered = useWarehouseStore((s) => s.hoveredLocationId === location.id);
  const isHighlighted = useWarehouseStore((s) => s.highlightedLocationIds.includes(location.id));
  const selectLocation = useWarehouseStore((s) => s.selectLocation);
  const hoverLocation = useWarehouseStore((s) => s.hoverLocation);
  const unhoverLocation = useWarehouseStore((s) => s.unhoverLocation);
  const createMovement = useWarehouseStore((s) => s.createMovement);
  useCursor(isHovered, moveTarget === "invalid" ? "not-allowed" : "pointer");

  const { slotWidth, depth, levelHeight, shelfThickness } = RACK_DIMENSIONS;
  const status = getLocationStatus(stock, location.capacity);
  const material = isSelected
    ? MATERIALS.selected[status]
    : moveTarget === "invalid"
      ? DISABLED_MATERIAL
      : moveTarget === "valid"
        ? TARGET_MATERIALS[isHovered ? "hovered" : "normal"]
        : isHighlighted
          ? HIGHLIGHT_MATERIAL
          : isHovered
        ? MATERIALS.hovered[status]
        : MATERIALS.normal[status];

  const height = levelHeight - shelfThickness - GAP * 2;
  const bottom = getLevelFloorY(location.level);

  return (
    <mesh
      geometry={unitBox}
      material={material}
      position={[getSlotX(rack, location.slot), bottom + height / 2, 0]}
      scale={[slotWidth - GAP * 2, height, depth - GAP * 2]}
      // stopPropagation: hanya location terdekat dari kamera yang kena, bukan yang di belakangnya.
      onPointerOver={(e) => {
        e.stopPropagation();
        hoverLocation(location.id);
      }}
      onPointerOut={() => unhoverLocation(location.id)}
      onClick={(e) => {
        e.stopPropagation();
        if (moveTarget === "valid") createMovement(location.id);
        else if (!moveTarget) selectLocation(location.id);
      }}
    >
      {isSelected ? (
        <Edges color={SELECTED_EDGE_COLOR} lineWidth={3} />
      ) : (
        isHighlighted && <Edges color={HIGHLIGHT_COLOR} lineWidth={2} />
      )}
    </mesh>
  );
}
