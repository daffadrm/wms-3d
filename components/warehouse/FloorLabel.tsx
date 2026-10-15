import { useEffect, useMemo } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";

interface FloorLabelProps {
  text: string;
  color: string;
  /** Pojok kiri-bawah label (dari sudut pandang membaca) di lantai. */
  position: [x: number, y: number, z: number];
  /** Tinggi label dalam meter; lebar mengikuti panjang teks. */
  height?: number;
}

const FONT_PX = 64;
const PADDING_PX = 12;

/** Teks datar di lantai, dirender ke CanvasTexture (tanpa font loading/worker). */
export default function FloorLabel({ text, color, position, height = 0.9 }: FloorLabelProps) {
  const { texture, aspect } = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const font = `600 ${FONT_PX}px Arial, Helvetica, sans-serif`;

    ctx.font = font;
    canvas.width = Math.ceil(ctx.measureText(text).width) + PADDING_PX * 2;
    canvas.height = FONT_PX + PADDING_PX * 2;

    // Mengubah ukuran canvas me-reset state context.
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(text, PADDING_PX, canvas.height / 2);

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return { texture, aspect: canvas.width / canvas.height };
  }, [text, color]);

  useEffect(() => () => texture.dispose(), [texture]);

  const width = height * aspect;
  const [x, y, z] = position;

  return (
    <mesh position={[x + width / 2, y, z - height / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
