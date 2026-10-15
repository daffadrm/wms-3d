/**
 * Koordinasi lalu lintas sederhana antara forklift dan pejalan kaki (packer/picker), dan antar forklift.
 * Posisi ditulis langsung tiap frame oleh masing-masing komponen (bukan lewat store),
 * supaya tidak memicu re-render. Semua koordinat dunia x/z.
 *
 * Aturan:
 * - Forklift berhenti kalau gerakan berikutnya mendekati pejalan kaki dalam jarak aman.
 * - Pejalan kaki menunggu kalau langkahnya mendekati forklift yang sedang bergerak; kalau forklift
 *   sedang berhenti mengalah, pejalan kaki boleh lewat asal tidak menabrak badan forklift.
 * - Forklift yang sedang menahan pallet let-down untuk picker boleh didekati pejalan kaki.
 * - Antar forklift: yang mendekati forklift lain berhenti; kalau keduanya saling mendekat,
 *   forklift dengan id lebih kecil jalan duluan.
 */

export interface Point {
  x: number;
  z: number;
}

export interface ForkliftTraffic {
  /** Tengah badan forklift sekarang. */
  body: Point;
  /** Perkiraan tengah badan forklift sesaat lagi (arah geraknya). */
  look: Point;
  /** Sedang berhenti mengalah. */
  yielding: boolean;
  /** Sedang menahan pallet let-down di aisle, menunggu picker mengambil barang. */
  holding: boolean;
}

/** Badan forklift + fork + pallet didekati sebagai lingkaran di tengah badan. */
const FORKLIFT_BODY_RADIUS = 1.25;
/** Tengah badan forklift berada di belakang pose (pose = tengah pallet di atas fork). */
const FORKLIFT_BODY_OFFSET = 0.65;
const PEDESTRIAN_RADIUS = 0.3;
const CONTACT_DISTANCE = FORKLIFT_BODY_RADIUS + PEDESTRIAN_RADIUS;
const SAFE_DISTANCE = CONTACT_DISTANCE + 0.5;
/** Jarak aman antar tengah badan dua forklift. */
const FORKLIFT_SAFE_DISTANCE = FORKLIFT_BODY_RADIUS * 2 + 0.3;

export const traffic = {
  forklifts: new Map<string, ForkliftTraffic>(),
  pedestrians: new Map<string, Point>(),
};

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** `look` lebih dekat ke `target` daripada `from`, dan sudah di bawah `limit`. */
const approaching = (from: Point, look: Point, target: Point, limit: number) =>
  distance(look, target) < limit && distance(look, target) < distance(from, target) - 1e-3;

export function getForkliftBodyCenter(pose: { x: number; z: number; heading: number }): Point {
  // Arah depan forklift = (-sin h, -cos h), jadi badan ada di (+sin h, +cos h) dari pose.
  return {
    x: pose.x + Math.sin(pose.heading) * FORKLIFT_BODY_OFFSET,
    z: pose.z + Math.cos(pose.heading) * FORKLIFT_BODY_OFFSET,
  };
}

/** Forklift `id` harus berhenti kalau gerakan berikutnya (body → look) mendekati pejalan kaki atau forklift lain. */
export function forkliftShouldYield(id: string, body: Point, look: Point): boolean {
  for (const pedestrian of traffic.pedestrians.values()) {
    if (approaching(body, look, pedestrian, SAFE_DISTANCE)) return true;
  }
  for (const [otherId, other] of traffic.forklifts) {
    if (otherId === id || !approaching(body, look, other.body, FORKLIFT_SAFE_DISTANCE)) continue;
    // Saling mendekat: yang id-nya lebih kecil jalan duluan, supaya tidak saling tunggu.
    const headOn = !other.yielding && approaching(other.body, other.look, body, FORKLIFT_SAFE_DISTANCE);
    if (!headOn || id > otherId) return true;
  }
  return false;
}

/** Pejalan kaki menunggu kalau langkah `now` → `next` mendekati forklift terlalu dekat. */
export function pedestrianShouldWait(now: Point, next: Point): boolean {
  for (const forklift of traffic.forklifts.values()) {
    if (forklift.holding) continue;
    if (forklift.yielding) {
      if (approaching(now, next, forklift.body, CONTACT_DISTANCE)) return true;
    } else if (
      approaching(now, next, forklift.body, SAFE_DISTANCE) ||
      approaching(now, next, forklift.look, SAFE_DISTANCE)
    ) {
      return true;
    }
  }
  return false;
}
