export const GOJEK_GREEN = "#00aa13";

interface MotorbikeProps {
  /** Warna bodi motor. */
  color?: string;
  /** Driver Gojek di atas motor + box pengantaran hijau di belakang. Tanpa ini = motor parkir kosong. */
  gojek?: boolean;
}

/** Motor sederhana. Origin = tengah-bawah, menghadap +z. */
export default function Motorbike({ color = "#334155", gojek = false }: MotorbikeProps) {
  return (
    <group>
      {/* Roda */}
      {[0.6, -0.6].map((z) => (
        <mesh key={z} position={[0, 0.3, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 0.12, 16]} />
          <meshStandardMaterial color="#18181b" />
        </mesh>
      ))}
      {/* Bodi, jok, setang */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.32, 0.3, 1.05]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.76, -0.15]} castShadow>
        <boxGeometry args={[0.3, 0.1, 0.6]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
      <mesh position={[0, 0.75, 0.55]} rotation={[-0.35, 0, 0]} castShadow>
        <boxGeometry args={[0.08, 0.55, 0.08]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.0, 0.48]} castShadow>
        <boxGeometry args={[0.65, 0.05, 0.05]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
      {gojek && <GojekDriver />}
    </group>
  );
}

/** Driver Gojek: jaket & helm hijau, tangan ke setang, kaki di footstep, box pengantaran di belakang. */
function GojekDriver() {
  return (
    <group>
      <mesh position={[0, 0.92, -0.62]} castShadow>
        <boxGeometry args={[0.42, 0.42, 0.38]} />
        <meshStandardMaterial color={GOJEK_GREEN} />
      </mesh>
      <mesh position={[0, 1.2, -0.12]} rotation={[0.15, 0, 0]} castShadow>
        <boxGeometry args={[0.42, 0.55, 0.26]} />
        <meshStandardMaterial color={GOJEK_GREEN} />
      </mesh>
      <mesh position={[0, 1.62, -0.06]} castShadow>
        <sphereGeometry args={[0.15, 16, 12]} />
        <meshStandardMaterial color={GOJEK_GREEN} />
      </mesh>
      <mesh position={[0, 1.58, 0.06]}>
        <boxGeometry args={[0.2, 0.08, 0.04]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.24, 1.18, 0.2]} rotation={[-1.1, 0, 0]} castShadow>
            <boxGeometry args={[0.09, 0.5, 0.09]} />
            <meshStandardMaterial color={GOJEK_GREEN} />
          </mesh>
          <mesh position={[side * 0.16, 0.85, 0.08]} rotation={[-1.3, 0, 0]} castShadow>
            <boxGeometry args={[0.13, 0.45, 0.13]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
          <mesh position={[side * 0.18, 0.55, 0.28]} castShadow>
            <boxGeometry args={[0.12, 0.45, 0.13]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
