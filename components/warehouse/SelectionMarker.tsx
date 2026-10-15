import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { floorSlotById, locationById, rackById } from "@/data/warehouse";
import { getRackSize, getSlotWorldPosition } from "@/lib/warehouse";
import { useWarehouseStore } from "@/store/warehouseStore";

const MARKER_COLOR = "#1d4ed8";
/** Jarak ujung panah dari atap rack. */
const HOVER_HEIGHT = 0.9;
const BOUNCE = 0.25;

/** Pallet di lantai maksimal ±1 m tingginya. */
const FLOOR_PALLET_TOP = 1;

/** Ujung panah: di atas atap rack untuk location rack, di atas pallet untuk slot lantai. */
function getMarkerPosition(id: string): [number, number, number] | undefined {
  const slot = floorSlotById.get(id);
  if (slot) return [slot.position[0], FLOOR_PALLET_TOP + HOVER_HEIGHT, slot.position[1]];

  const location = locationById.get(id);
  const rack = location && rackById.get(location.rackId);
  if (!location || !rack) return undefined;
  const [x, , z] = getSlotWorldPosition(rack, location);
  return [x, getRackSize(rack).height + HOVER_HEIGHT, z];
}

/** Panah yang memantul di atas rack, menunjuk kolom location yang dipilih. */
export default function SelectionMarker() {
  const selectedLocationId = useWarehouseStore((s) => s.selectedLocationId);
  const ref = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = Math.abs(Math.sin(clock.elapsedTime * 3)) * BOUNCE;
  });

  const position = selectedLocationId ? getMarkerPosition(selectedLocationId) : undefined;
  if (!position) return null;

  return (
    <group position={position}>
      <group ref={ref}>
        {/* Cone menghadap ke bawah, ujungnya di y = 0. */}
        <mesh position={[0, 0.3, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.3, 0.6, 16]} />
          <meshStandardMaterial color={MARKER_COLOR} emissive={MARKER_COLOR} emissiveIntensity={0.4} />
        </mesh>
        <mesh position={[0, 0.85, 0]}>
          <cylinderGeometry args={[0.1, 0.1, 0.5, 12]} />
          <meshStandardMaterial color={MARKER_COLOR} emissive={MARKER_COLOR} emissiveIntensity={0.4} />
        </mesh>
      </group>
    </group>
  );
}
