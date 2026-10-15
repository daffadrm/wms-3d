import { Suspense } from "react";
import { useTexture } from "@react-three/drei";
import { SRGBColorSpace, type Texture } from "three";

/** File logo gudang di folder public/. Ukuran plane mengikuti rasio gambar. */
const LOGO_URL = "/flexofast.png";
/** Ketebalan papan putih di belakang logo. */
const BOARD_THICKNESS = 0.04;
/** Jarak tepi papan ke logo. */
const BOARD_PADDING = 0.12;

interface WarehouseLogoProps {
  /** Titik tengah papan di permukaan luar dinding. */
  position: [x: number, y: number, z: number];
  /** Rotasi Y supaya papan menghadap keluar dinding (default menghadap +z). */
  rotationY?: number;
  /** Lebar maksimum logo. */
  maxWidth: number;
  /** Tinggi maksimum logo. */
  maxHeight: number;
}

/** Papan logo gudang di dinding luar. Suspense supaya scene tetap tampil selama gambar dimuat. */
export default function WarehouseLogo(props: WarehouseLogoProps) {
  return (
    <Suspense fallback={null}>
      <LogoBoard {...props} />
    </Suspense>
  );
}

function LogoBoard({ position, rotationY = 0, maxWidth, maxHeight }: WarehouseLogoProps) {
  const texture = useTexture(LOGO_URL, (t: Texture) => {
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
  });

  // Muat sebesar mungkin di dalam kotak maxWidth × maxHeight tanpa mengubah rasio.
  const image = texture.image as { width: number; height: number };
  const aspect = image.width / image.height;
  const width = Math.min(maxWidth, maxHeight * aspect);
  const height = width / aspect;

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0, BOARD_THICKNESS / 2]} castShadow>
        <boxGeometry args={[width + BOARD_PADDING * 2, height + BOARD_PADDING * 2, BOARD_THICKNESS]} />
        <meshStandardMaterial color="#ffffff" roughness={0.6} />
      </mesh>
      {/* Sedikit di depan papan supaya tidak z-fighting. */}
      <mesh position={[0, 0, BOARD_THICKNESS + 0.01]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
