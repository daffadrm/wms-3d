import type { WarehouseArea } from "@/types/warehouse";
import { floorSlotById, locationById, rackById, warehouseLayout } from "@/data/warehouse";
import { RACK_DIMENSIONS, getRackRotation, getSlotWorldPosition } from "./warehouse";

type Vec3 = [x: number, y: number, z: number];

/** Posisi kamera + titik yang dilihat (target OrbitControls). */
export interface CameraFocus {
  position: Vec3;
  target: Vec3;
}

/**
 * Kamera default: melihat seluruh gudang dari sudut depan-kanan atas. Target digeser
 * sedikit ke selatan supaya halaman depan (gerbang & parkiran) ikut terlihat.
 */
export function getOverviewFocus(): CameraFocus {
  const span = Math.max(warehouseLayout.width, warehouseLayout.depth);
  const targetZ = span * 0.1;
  return { position: [span * 0.7, span * 0.65, span * 0.7 + targetZ], target: [0, 0, targetZ] };
}

/** Location dilihat dari depan rack (rack menghadap +z), sedikit dari kanan & atas; diputar mengikuti rack. */
const CLOSE_OFFSET: Vec3 = [3, 3.5, 7];
/** Arah kamera (dinormalisasi) saat melihat sekelompok titik atau sebuah area. */
const FIT_DIRECTION: Vec3 = [0.45, 0.75, 0.75];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const normalize = (v: Vec3): Vec3 => scale(v, 1 / Math.hypot(...v));

/** Titik dunia sebuah location rack (tengah slot) atau slot lantai. */
export function getLocationPoint(id: string): Vec3 | undefined {
  const slot = floorSlotById.get(id);
  if (slot) return [slot.position[0], 0.5, slot.position[1]];

  const location = locationById.get(id);
  const rack = location && rackById.get(location.rackId);
  if (!location || !rack) return undefined;
  const [x, y, z] = getSlotWorldPosition(rack, location);
  return [x, y + RACK_DIMENSIONS.levelHeight / 2, z];
}

/** Dekat ke satu location. */
export function getLocationFocus(id: string): CameraFocus | undefined {
  const point = getLocationPoint(id);
  const location = locationById.get(id);
  const rack = location && rackById.get(location.rackId);
  const t = rack ? getRackRotation(rack) : 0;
  const [ox, oy, oz] = CLOSE_OFFSET;
  const offset: Vec3 = [ox * Math.cos(t) + oz * Math.sin(t), oy, -ox * Math.sin(t) + oz * Math.cos(t)];
  return point && { position: add(point, offset), target: point };
}

/** Kamera yang memuat semua location `ids` di layar. */
export function getFitFocus(ids: string[]): CameraFocus | undefined {
  const points = ids.map(getLocationPoint).filter((p): p is Vec3 => p !== undefined);
  if (points.length === 0) return undefined;
  if (points.length === 1) return getLocationFocus(ids[0]);

  const center = scale(points.reduce(add, [0, 0, 0] as Vec3), 1 / points.length);
  const spread = Math.max(...points.map((p) => Math.hypot(p[0] - center[0], p[2] - center[2])));
  const distance = Math.max(8, spread * 1.8);
  return { position: add(center, scale(normalize(FIT_DIRECTION), distance)), target: center };
}

/** Kamera yang memuat satu area (zone, receiving, packing, shipping). */
export function getAreaFocus(area: WarehouseArea): CameraFocus {
  const target: Vec3 = [area.position[0], 0, area.position[1]];
  const distance = Math.max(...area.size) * 1.1 + 4;
  return { position: add(target, scale(normalize(FIT_DIRECTION), distance)), target };
}
