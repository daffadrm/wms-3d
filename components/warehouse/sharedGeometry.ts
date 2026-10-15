import { BoxGeometry } from "three";

/**
 * Box 1×1×1 yang dipakai bersama oleh semua mesh kotak (tiang, papan, location).
 * Ukuran sebenarnya diatur lewat `scale`, jadi tidak perlu membuat geometry baru per object.
 */
export const unitBox = new BoxGeometry(1, 1, 1);
