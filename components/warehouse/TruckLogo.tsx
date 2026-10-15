import { Suspense } from "react";
import { useTexture } from "@react-three/drei";
import { SRGBColorSpace, type Texture } from "three";

/** File logo di folder public/. Ukuran plane mengikuti rasio gambar. */
const LOGO_URL = "/flexotrans.png";

interface TruckLogoProps {
  /** Titik tengah logo di sisi trailer (koordinat lokal truk), tanpa offset z. */
  center: [x: number, y: number];
  /** Setengah lebar trailer: logo ditempel di z = ±halfWidth. */
  halfWidth: number;
  /** Lebar maksimum logo di sisi trailer. */
  maxWidth: number;
  /** Tinggi maksimum logo di sisi trailer. */
  maxHeight: number;
}

/** Logo di kedua sisi trailer. Suspense supaya truk tetap tampil selama gambar dimuat. */
export default function TruckLogo(props: TruckLogoProps) {
  return (
    <Suspense fallback={null}>
      <LogoPlanes {...props} />
    </Suspense>
  );
}

function LogoPlanes({ center: [x, y], halfWidth, maxWidth, maxHeight }: TruckLogoProps) {
  const texture = useTexture(LOGO_URL, (t: Texture) => {
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
  });

  // Muat sebesar mungkin di dalam kotak maxWidth × maxHeight tanpa mengubah rasio.
  const image = texture.image as { width: number; height: number };
  const aspect = image.width / image.height;
  const width = Math.min(maxWidth, maxHeight * aspect);
  const height = width / aspect;
  // Sedikit di luar permukaan trailer supaya tidak z-fighting.
  const offset = halfWidth + 0.01;

  return (
    <>
      {[1, -1].map((side) => (
        <mesh key={side} position={[x, y, side * offset]} rotation={[0, side === 1 ? 0 : Math.PI, 0]}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial map={texture} transparent toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}
