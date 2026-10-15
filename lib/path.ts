export type Vec3 = [x: number, y: number, z: number];

const distance = (a: Vec3, b: Vec3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/** Panjang total polyline. */
export function pathLength(path: Vec3[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += distance(path[i - 1], path[i]);
  return length;
}

/** Titik di polyline `path` sejauh `along` dari awal, plus arah segmen tempat titik itu berada. */
export function pointAlong(path: Vec3[], along: number): { point: Vec3; direction: [dx: number, dz: number] } {
  let remaining = along;
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]];
    const segment = distance(a, b);
    if (remaining <= segment && segment > 0) {
      const t = remaining / segment;
      return {
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
        direction: [b[0] - a[0], b[2] - a[2]],
      };
    }
    remaining -= segment;
  }
  const [a, b] = [path[path.length - 2] ?? path[0], path[path.length - 1]];
  return { point: b, direction: [b[0] - a[0], b[2] - a[2]] };
}
