import { useRef, type ReactNode, type Ref, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";

/** Diubah oleh pemilik worker tiap frame; worker hanya membaca untuk menggerakkan tangan & kaki. */
export interface WorkerMotion {
  walking: boolean;
  /** Kedua tangan ke depan (memegang sesuatu, mis. roll film). */
  holding: boolean;
}

const COLORS = {
  skin: "#e0ac69",
  vest: "#f97316",
  shirt: "#1e3a8a",
  pants: "#1e293b",
  helmet: "#facc15",
};

const HIP_Y = 0.85;
const SHOULDER_Y = 1.42;
/** Kecepatan jalan semua pekerja (m/s), dipakai picker, checker, dan shipping checker. */
export const WORKER_WALK_SPEED = 2.4;
/** Kecepatan ayunan langkah (radian per detik), sebanding dengan kecepatan jalan supaya kaki tidak "meluncur". */
const STRIDE_SPEED = 6.5 * WORKER_WALK_SPEED;
const STRIDE_ANGLE = 0.5;
/** Rotasi lengan ke depan saat memegang (negatif = ke depan). */
const HOLD_ANGLE = -1.1;

interface WorkerProps {
  ref: Ref<Group>;
  motion: RefObject<WorkerMotion>;
  /** Warna rompi, untuk membedakan peran (mis. packer oranye, orang inventory hijau). */
  vestColor?: string;
  /** Objek yang ikut bergerak bersama worker (mis. tote yang dibawa), koordinat lokal worker. */
  children?: ReactNode;
  /**
   * Duduk dengan pinggul setinggi ini dari lantai (mis. di bangku): paha ke depan (+z), betis turun
   * ke lantai, badan ikut turun. Kosong = berdiri.
   */
  seatHeight?: number;
}

const LEG_SIZE = { width: 0.14, depth: 0.16 };
/** Panjang paha saat duduk. */
const THIGH_LENGTH = 0.42;

/**
 * Orang low-poly (±1,75 m). Origin = di antara kedua kaki di lantai, menghadap +z.
 * Posisi & arah diatur pemilik lewat `ref`; ayunan kaki/tangan dari `motion`.
 */
export default function Worker({
  ref,
  motion,
  vestColor = COLORS.vest,
  children,
  seatHeight,
}: WorkerProps) {
  const seated = seatHeight !== undefined;
  /** Badan diturunkan supaya pinggul berada di dudukan. */
  const bodyY = seated ? seatHeight - HIP_Y : 0;
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const stride = useRef(0);

  useFrame((_, delta) => {
    const { walking, holding } = motion.current;
    if (walking) stride.current += Math.min(delta, 0.1) * STRIDE_SPEED;
    const swing = walking ? Math.sin(stride.current) * STRIDE_ANGLE : 0;

    if (leftLeg.current) leftLeg.current.rotation.x = swing;
    if (rightLeg.current) rightLeg.current.rotation.x = -swing;
    // Tangan berayun berlawanan dengan kaki, kecuali sedang memegang sesuatu.
    if (leftArm.current) leftArm.current.rotation.x = holding ? HOLD_ANGLE : -swing * 0.8;
    if (rightArm.current)
      rightArm.current.rotation.x = holding ? HOLD_ANGLE : swing * 0.8;
  });

  return (
    <group ref={ref}>
      {/* Kaki: pivot di pinggul supaya bisa berayun; disembunyikan saat duduk */}
      {[
        { ref: leftLeg, x: -0.1 },
        { ref: rightLeg, x: 0.1 },
      ].map(({ ref: legRef, x }) => (
        <group key={x} ref={legRef} position={[x, HIP_Y, 0]} visible={!seated}>
          <mesh position={[0, -HIP_Y / 2, 0]} castShadow>
            <boxGeometry args={[LEG_SIZE.width, HIP_Y, LEG_SIZE.depth]} />
            <meshStandardMaterial color={COLORS.pants} />
          </mesh>
        </group>
      ))}
      {seated && <SeatedLegs seatHeight={seatHeight} />}

      <group position={[0, bodyY, 0]}>
      {/* Badan: baju + rompi */}
      <mesh
        position={[0, 1.15, 0]}
        castShadow
      >
        <boxGeometry args={[0.4, 0.6, 0.22]} />
        <meshStandardMaterial color={COLORS.shirt} />
      </mesh>
      <mesh position={[0, 1.13, 0]}>
        <boxGeometry args={[0.42, 0.5, 0.24]} />
        <meshStandardMaterial color={vestColor} />
      </mesh>

      {/* Lengan: pivot di bahu */}
      {[
        { ref: leftArm, x: -0.26 },
        { ref: rightArm, x: 0.26 },
      ].map(({ ref: armRef, x }) => (
        <group
          key={x}
          ref={armRef}
          position={[x, SHOULDER_Y, 0]}
        >
          <mesh
            position={[0, -0.28, 0]}
            castShadow
          >
            <boxGeometry args={[0.1, 0.56, 0.12]} />
            <meshStandardMaterial color={COLORS.shirt} />
          </mesh>
          <mesh position={[0, -0.6, 0]}>
            <boxGeometry args={[0.09, 0.1, 0.1]} />
            <meshStandardMaterial color={COLORS.skin} />
          </mesh>
        </group>
      ))}

      {/* Kepala + helm */}
      <mesh
        position={[0, 1.6, 0]}
        castShadow
      >
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshStandardMaterial color={COLORS.skin} />
      </mesh>
      <mesh position={[0, 1.66, 0]}>
        <sphereGeometry args={[0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={COLORS.helmet} />
      </mesh>
      </group>

      {children}
    </group>
  );
}

/** Kaki duduk: paha mendatar ke depan dari pinggul, betis tegak dari lutut ke lantai. */
function SeatedLegs({ seatHeight }: { seatHeight: number }) {
  return (
    <>
      {[-0.1, 0.1].map((x) => (
        <group key={x} position={[x, seatHeight, 0]}>
          <mesh position={[0, 0, THIGH_LENGTH / 2]} castShadow>
            <boxGeometry args={[LEG_SIZE.width, LEG_SIZE.depth, THIGH_LENGTH]} />
            <meshStandardMaterial color={COLORS.pants} />
          </mesh>
          <mesh position={[0, -seatHeight / 2, THIGH_LENGTH - LEG_SIZE.depth / 2]} castShadow>
            <boxGeometry args={[LEG_SIZE.width, seatHeight, LEG_SIZE.depth]} />
            <meshStandardMaterial color={COLORS.pants} />
          </mesh>
        </group>
      ))}
    </>
  );
}
