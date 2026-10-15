import type { ReturnOrder } from "@/types/warehouse";

/**
 * Apakah paket ke-`index` (mulai 0) dari sebuah retur berisi barang rusak.
 * Paket rusak disebar merata di antara semua paket, jadi tidak selalu di akhir.
 */
export function isReturnPieceDamaged(order: Pick<ReturnOrder, "quantity" | "damagedPlanned">, index: number) {
  const { quantity, damagedPlanned } = order;
  return Math.floor(((index + 1) * damagedPlanned) / quantity) > Math.floor((index * damagedPlanned) / quantity);
}
