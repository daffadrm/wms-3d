import { useLayoutEffect, useRef } from "react";
import { BoxGeometry, Color, InstancedMesh, MeshStandardMaterial, Object3D } from "three";
import type { FloorSlot, Rack, WarehouseLocation } from "@/types/warehouse";
import { getOccupancy, getRackRotation, getSlotWorldPosition } from "@/lib/warehouse";

const PALLET = { width: 1.2, height: 0.14, depth: 0.9 };
const BOX = { width: 0.56, height: 0.42, depth: 0.42 };
const BOX_SPACING = 0.02;
/** Box per lapis (2×2) dan jumlah lapis maksimum. */
const BOXES_PER_LAYER = 4;
const MAX_BOXES = BOXES_PER_LAYER * 2;
const BOX_SHADES = ["#c8a165", "#bf9455", "#d2ae74"];

const palletGeometry = new BoxGeometry(PALLET.width, PALLET.height, PALLET.depth);
const boxGeometry = new BoxGeometry(BOX.width, BOX.height, BOX.depth);
const palletMaterial = new MeshStandardMaterial({ color: "#a0703c", roughness: 0.9 });
// Warna dasar putih; warna per box diatur lewat instanceColor.
const boxMaterial = new MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 });
const boxShadeMaterials = BOX_SHADES.map((color) => new MeshStandardMaterial({ color, roughness: 0.8 }));

/**
 * Jumlah box hanya representasi visual occupancy (maks 8), bukan jumlah barang sebenarnya.
 */
export function getBoxCount(stock: number, capacity: number): number {
  if (stock <= 0) return 0;
  const occupancy = getOccupancy(stock, capacity);
  return Math.min(MAX_BOXES, Math.max(1, Math.ceil((occupancy / 100) * MAX_BOXES)));
}

/** Posisi tengah box ke-n, relatif terhadap titik tengah-bawah pallet. */
function getBoxOffset(n: number): [x: number, y: number, z: number] {
  const layer = Math.floor(n / BOXES_PER_LAYER);
  const cell = n % BOXES_PER_LAYER;
  return [
    ((cell % 2) - 0.5) * (BOX.width + BOX_SPACING),
    PALLET.height + BOX.height / 2 + layer * BOX.height,
    (Math.floor(cell / 2) - 0.5) * (BOX.depth + BOX_SPACING),
  ];
}

export interface PalletPlacement {
  /** Titik tengah-bawah pallet dalam koordinat dunia. */
  position: [x: number, y: number, z: number];
  /** Rotasi terhadap sumbu y (radian). */
  rotationY?: number;
  boxCount: number;
}

/**
 * Pallet di slot lantai (staging / packing station). Diputar 90° karena forklift mengambilnya
 * dari samping (sejajar sumbu x), sehingga orientasinya sama dengan pallet di atas fork.
 */
export function buildFloorPlacements(
  slots: FloorSlot[],
  stockByLocation: Map<string, number>,
  palletCapacity: number,
): PalletPlacement[] {
  return slots.flatMap((slot) => {
    const boxCount = getBoxCount(stockByLocation.get(slot.id) ?? 0, palletCapacity);
    if (boxCount === 0) return [];
    const [x, z] = slot.position;
    return [{ position: [x, 0, z], rotationY: FLOOR_PALLET_ROTATION, boxCount }];
  });
}

export const FLOOR_PALLET_ROTATION = Math.PI / 2;

/** Satu pallet per location yang berisi stock. */
export function buildPalletPlacements(
  racks: Rack[],
  locations: WarehouseLocation[],
  stockByLocation: Map<string, number>,
): PalletPlacement[] {
  const rackById = new Map(racks.map((rack) => [rack.id, rack]));
  return locations.flatMap((location) => {
    const boxCount = getBoxCount(stockByLocation.get(location.id) ?? 0, location.capacity);
    const rack = rackById.get(location.rackId);
    if (boxCount === 0 || !rack) return [];
    return [{ position: getSlotWorldPosition(rack, location), rotationY: getRackRotation(rack), boxCount }];
  });
}

/** Semua pallet di rack: 1 draw call untuk pallet, 1 untuk box. */
export default function Pallets({ placements }: { placements: PalletPlacement[] }) {
  const palletRef = useRef<InstancedMesh>(null);
  const boxRef = useRef<InstancedMesh>(null);
  const boxTotal = placements.reduce((total, p) => total + p.boxCount, 0);

  useLayoutEffect(() => {
    const pallets = palletRef.current;
    const boxes = boxRef.current;
    if (!pallets || !boxes) return;

    const dummy = new Object3D();
    const color = new Color();
    let boxIndex = 0;

    placements.forEach(({ position: [x, y, z], rotationY = 0, boxCount }, i) => {
      const cos = Math.cos(rotationY);
      const sin = Math.sin(rotationY);
      dummy.rotation.set(0, rotationY, 0);
      dummy.position.set(x, y + PALLET.height / 2, z);
      dummy.updateMatrix();
      pallets.setMatrixAt(i, dummy.matrix);

      for (let n = 0; n < boxCount; n++) {
        const [ox, oy, oz] = getBoxOffset(n);
        // Offset box ikut diputar bersama pallet.
        dummy.position.set(x + ox * cos + oz * sin, y + oy, z - ox * sin + oz * cos);
        dummy.updateMatrix();
        boxes.setMatrixAt(boxIndex, dummy.matrix);
        boxes.setColorAt(boxIndex, color.set(BOX_SHADES[boxIndex % BOX_SHADES.length]));
        boxIndex++;
      }
    });

    pallets.instanceMatrix.needsUpdate = true;
    boxes.instanceMatrix.needsUpdate = true;
    if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
    pallets.computeBoundingSphere();
    boxes.computeBoundingSphere();
  }, [placements]);

  return (
    <>
      <instancedMesh
        ref={palletRef}
        args={[palletGeometry, palletMaterial, placements.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={boxRef}
        args={[boxGeometry, boxMaterial, boxTotal]}
        castShadow
        receiveShadow
      />
    </>
  );
}

/** Satu pallet biasa (non-instanced), untuk pallet yang sedang dibawa. Origin = tengah-bawah. */
export function PalletModel({ boxCount }: { boxCount: number }) {
  return (
    <group>
      <mesh
        geometry={palletGeometry}
        material={palletMaterial}
        position={[0, PALLET.height / 2, 0]}
        castShadow
      />
      {Array.from({ length: boxCount }, (_, n) => (
        <mesh
          key={n}
          geometry={boxGeometry}
          material={boxShadeMaterials[n % boxShadeMaterials.length]}
          position={getBoxOffset(n)}
          castShadow
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Pallet paket: hasil packing per PCS (1 PCS = 1 paket), paket kecil ditumpuk 4×3 per lapis.
// ---------------------------------------------------------------------------

const PARCEL = { size: 0.26, height: 0.18, gap: 0.03 };
const PARCEL_COLS = 4; // searah x (lebar pallet)
const PARCEL_ROWS = 3; // searah z (kedalaman pallet)
const PARCELS_PER_LAYER = PARCEL_COLS * PARCEL_ROWS;
/** Kapasitas instanced mesh; cukup untuk order terbesar (lihat MAX_PICK_QUANTITY). */
const MAX_PARCELS = PARCELS_PER_LAYER * 5;

const parcelGeometry = new BoxGeometry(PARCEL.size, PARCEL.height, PARCEL.size);
export const PARCEL_COLOR = "#d6a96b";
const parcelMaterials = new Map<string, MeshStandardMaterial>();
/** Satu material per warna, dipakai bersama. */
function getParcelMaterial(color: string) {
  let material = parcelMaterials.get(color);
  if (!material) {
    material = new MeshStandardMaterial({ color, roughness: 0.85 });
    parcelMaterials.set(color, material);
  }
  return material;
}

/** Posisi tengah paket ke-n, relatif terhadap titik tengah-bawah pallet. */
export function getParcelOffset(n: number): [x: number, y: number, z: number] {
  const layer = Math.floor(n / PARCELS_PER_LAYER);
  const cell = n % PARCELS_PER_LAYER;
  const step = PARCEL.size + PARCEL.gap;
  return [
    ((cell % PARCEL_COLS) - (PARCEL_COLS - 1) / 2) * step,
    PALLET.height + PARCEL.height / 2 + layer * PARCEL.height,
    (Math.floor(cell / PARCEL_COLS) - (PARCEL_ROWS - 1) / 2) * step,
  ];
}

/**
 * Pallet berisi `count` paket (atau barang satuan, dengan `color` berbeda). Origin = tengah-bawah pallet.
 */
export function ParcelPallet({ count, color = PARCEL_COLOR }: { count: number; color?: string }) {
  const ref = useRef<InstancedMesh>(null);
  const visible = Math.min(count, MAX_PARCELS);

  useLayoutEffect(() => {
    const parcels = ref.current;
    if (!parcels) return;
    const dummy = new Object3D();
    for (let n = 0; n < visible; n++) {
      dummy.position.set(...getParcelOffset(n));
      dummy.updateMatrix();
      parcels.setMatrixAt(n, dummy.matrix);
    }
    parcels.instanceMatrix.needsUpdate = true;
    parcels.computeBoundingSphere();
  }, [visible]);

  return (
    <group>
      <mesh geometry={palletGeometry} material={palletMaterial} position={[0, PALLET.height / 2, 0]} castShadow />
      <instancedMesh
        ref={ref}
        args={[parcelGeometry, getParcelMaterial(color), MAX_PARCELS]}
        count={visible}
        castShadow
      />
    </group>
  );
}
