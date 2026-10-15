import { useEffect, type ReactNode } from "react";
import { Edges, Line, useCursor } from "@react-three/drei";
import { MeshStandardMaterial } from "three";
import type { FloorSlot } from "@/types/warehouse";
import { useWarehouseStore } from "@/store/warehouseStore";
import { unitBox } from "./sharedGeometry";
import FloorLabel from "./FloorLabel";

const RESERVED_COLOR = "#d97706";
/** Sorotan hasil search, sama dengan sorotan location rack. */
const HIGHLIGHT_COLOR = "#d946ef";
/** Ukuran slot di lantai: pallet di lantai diputar 90°, jadi sisi panjangnya searah z. */
const SLOT_SIZE = { x: 1.1, z: 1.4 };
/** Kotak interaksi menutupi pallet + box (tinggi maks ±1 m). */
const HIT_BOX = { x: 1, y: 1.05, z: 1.3 };

type MaterialSet = Record<"normal" | "hovered" | "selected", MeshStandardMaterial>;
const materialCache = new Map<string, MaterialSet>();

/** Material per warna dipakai bersama semua slot dengan warna yang sama. */
function getMaterials(color: string): MaterialSet {
  let set = materialCache.get(color);
  if (!set) {
    const make = (opacity: number, emissiveIntensity: number) =>
      new MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity,
        transparent: true,
        opacity,
        depthWrite: false,
      });
    set = { normal: make(0.12, 0), hovered: make(0.45, 0.4), selected: make(0.6, 0.6) };
    materialCache.set(color, set);
  }
  return set;
}

interface FloorSlotMarkerProps {
  slot: FloorSlot;
  color: string;
  /** Ada pallet di slot ini: slot bisa di-hover/klik. */
  occupied: boolean;
  /** Sudah dipesan, pallet masih dalam perjalanan. */
  reserved?: boolean;
  /** Posisi pojok label kode, relatif terhadap tengah slot. Default: sisi timur. */
  labelPosition?: [x: number, y: number, z: number];
  /** Objek tambahan di slot ini (mis. meja packing), dalam koordinat lokal slot. */
  children?: ReactNode;
}

/** Garis slot di lantai + kode + kotak interaksi saat ada pallet. */
export default function FloorSlotMarker({
  slot,
  color,
  occupied,
  reserved = false,
  labelPosition,
  children,
}: FloorSlotMarkerProps) {
  const isSelected = useWarehouseStore((s) => s.selectedLocationId === slot.id);
  const isHovered = useWarehouseStore((s) => s.hoveredLocationId === slot.id);
  const isHighlighted = useWarehouseStore((s) => s.highlightedLocationIds.includes(slot.id));
  const isPickingTarget = useWarehouseStore((s) => s.movingInventoryId !== null);
  const selectLocation = useWarehouseStore((s) => s.selectLocation);
  const hoverLocation = useWarehouseStore((s) => s.hoverLocation);
  const unhoverLocation = useWarehouseStore((s) => s.unhoverLocation);
  // Slot lantai bukan tujuan movement manual, jadi tidak bisa diklik saat mode pilih tujuan.
  const interactive = occupied && !isPickingTarget;
  useCursor(isHovered && interactive);

  // Mesh interaksi hilang (mis. pallet diangkat forklift) tanpa event pointerout: bersihkan hover.
  useEffect(() => {
    if (!interactive) unhoverLocation(slot.id);
  }, [interactive, slot.id, unhoverLocation]);

  const [x, z] = slot.position;
  const hx = SLOT_SIZE.x / 2;
  const hz = SLOT_SIZE.z / 2;
  const outlineColor = isHighlighted ? HIGHLIGHT_COLOR : reserved ? RESERVED_COLOR : color;
  const materials = getMaterials(isHighlighted ? HIGHLIGHT_COLOR : color);

  return (
    <group position={[x, 0, z]}>
      <Line
        points={[
          [-hx, 0.02, -hz],
          [hx, 0.02, -hz],
          [hx, 0.02, hz],
          [-hx, 0.02, hz],
          [-hx, 0.02, -hz],
        ]}
        color={outlineColor}
        lineWidth={reserved || isHighlighted ? 3 : 1.5}
        dashed
        dashSize={0.2}
        gapSize={0.1}
      />
      <FloorLabel
        text={slot.code}
        color={outlineColor}
        position={labelPosition ?? [hx + 0.15, 0.02, 0.25]}
        height={0.45}
      />

      {interactive && (
        <mesh
          geometry={unitBox}
          material={
            isSelected ? materials.selected : isHovered || isHighlighted ? materials.hovered : materials.normal
          }
          position={[0, HIT_BOX.y / 2, 0]}
          scale={[HIT_BOX.x, HIT_BOX.y, HIT_BOX.z]}
          onPointerOver={(e) => {
            e.stopPropagation();
            hoverLocation(slot.id);
          }}
          onPointerOut={() => unhoverLocation(slot.id)}
          onClick={(e) => {
            e.stopPropagation();
            selectLocation(slot.id);
          }}
        >
          {isSelected && <Edges color={color} lineWidth={3} />}
        </mesh>
      )}

      {children}
    </group>
  );
}
