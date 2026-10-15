import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { useWarehouseStore } from "@/store/warehouseStore";

/** Lama animasi kamera pindah fokus (detik). */
const DURATION = 1;

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** Bagian OrbitControls yang dipakai di sini. */
interface Controls {
  target: Vector3;
  update: () => void;
}

interface Flight {
  fromPosition: Vector3;
  fromTarget: Vector3;
  toPosition: Vector3;
  toTarget: Vector3;
  t: number;
}

/**
 * Menerbangkan kamera ke `cameraFocus` di store dengan animasi halus.
 * Setelah sampai, OrbitControls tetap bisa dipakai seperti biasa dari titik fokus baru.
 */
export default function CameraRig() {
  const focus = useWarehouseStore((s) => s.cameraFocus);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const flight = useRef<Flight | null>(null);

  useEffect(() => {
    if (!focus || !controls) return;
    flight.current = {
      fromPosition: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPosition: new Vector3(...focus.position),
      toTarget: new Vector3(...focus.target),
      t: 0,
    };
  }, [focus, camera, controls]);

  useFrame((_, delta) => {
    const f = flight.current;
    if (!f || !controls) return;
    f.t = Math.min(f.t + delta / DURATION, 1);
    const k = ease(f.t);
    camera.position.lerpVectors(f.fromPosition, f.toPosition, k);
    controls.target.lerpVectors(f.fromTarget, f.toTarget, k);
    controls.update();
    if (f.t >= 1) flight.current = null;
  });

  return null;
}
