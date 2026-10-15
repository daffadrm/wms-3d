"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { FloorSlotType, Inventory, LetDownStatus, PackingOrder, PackingOrderStatus } from "@/types/warehouse";
import { MAX_PICK_QUANTITY, MAX_SAMEDAY_QUANTITY,floorSlotById, getLocationCode, locationById, productBySku } from "@/data/warehouse";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  getAvailableQuantity,
  getLocationStatus,
  getOccupancy,
} from "@/lib/warehouse";
import { isActiveMovement } from "@/lib/movement";
import {
  useActiveOrderByShippingSlot,
  useActiveOrderByStation,
  useFreeFloorSlots,
  useIncomingByLocation,
  useInventoryByLocation,
  useLetDownLocationIds,
  useOutboundByInventory,
  useWarehouseStore,
} from "@/store/warehouseStore";

const KIND_TITLES: Record<FloorSlotType | "RACK", string> = {
  RACK: "Location Detail",
  STAGING: "Receiving Staging",
  PACKING: "Packing Station",
  SHIPPING: "Shipping Area",
  RETURN: "Return Area",
};

const KIND_DESCRIPTIONS: Record<FloorSlotType, string> = {
  STAGING: "Pallet inbound menunggu putaway ke rack.",
  PACKING: "Barang hasil pick dikemas per PCS (1 PCS = 1 paket), tiap paket langsung dibawa conveyor ke Shipping.",
  SHIPPING: "Pallet paket dari conveyor. Dicek (scan per paket) dulu, baru boleh dimuat ke truk outbound di dock D03.",
  RETURN: "Barang retur yang lolos pemeriksaan, siap putaway kembali ke rack.",
};

export default function LocationDetail() {
  const selectedLocationId = useWarehouseStore((s) => s.selectedLocationId);
  const selectLocation = useWarehouseStore((s) => s.selectLocation);
  const movingInventoryId = useWarehouseStore((s) => s.movingInventoryId);
  const beginMove = useWarehouseStore((s) => s.beginMove);
  const createPackingOrder = useWarehouseStore((s) => s.createPackingOrder);
  const shipPallet = useWarehouseStore((s) => s.shipPallet);
  const movements = useWarehouseStore((s) => s.movements);
  const packingOrders = useWarehouseStore((s) => s.packingOrders);
  const inventoryByLocation = useInventoryByLocation();
  const incomingByLocation = useIncomingByLocation();
  const activeOrderByStation = useActiveOrderByStation();
  const activeOrderByShippingSlot = useActiveOrderByShippingSlot();
  const letDownLocationIds = useLetDownLocationIds();
  const shippingChecks = useWarehouseStore((s) => s.shippingChecks);
  const outboundByInventory = useOutboundByInventory();
  const freeSlots = useFreeFloorSlots();
  /** Inventory yang form quantity pick-nya sedang terbuka. */
  const [pickFormItemId, setPickFormItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedLocationId) return;
    // Esc: batalkan pilih tujuan dulu kalau sedang aktif, kalau tidak tutup panel.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const state = useWarehouseStore.getState();
      if (state.movingInventoryId) state.cancelMove();
      else state.selectLocation(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedLocationId]);

  // Yang dipilih bisa location rack, atau slot lantai (staging Receiving / packing station).
  const location = selectedLocationId ? locationById.get(selectedLocationId) : undefined;
  const floorSlot = selectedLocationId ? floorSlotById.get(selectedLocationId) : undefined;
  if (!selectedLocationId || (!location && !floorSlot)) return null;

  const items = inventoryByLocation.get(selectedLocationId) ?? [];
  const activeInventoryIds = new Set(movements.filter(isActiveMovement).map((m) => m.inventoryId));
  const pickingInventoryIds = new Set(
    // Selama barang belum diambil (antre / picker sedang jalan ke rack), pallet asal dikunci.
    packingOrders.filter((o) => o.status === "QUEUED" || o.status === "PICKING").map((o) => o.sourceInventoryId),
  );
  const kind = floorSlot?.type ?? "RACK";

  const renderActions = (item: Inventory) => {
    const isMoving = activeInventoryIds.has(item.id);

    if (kind === "SHIPPING") {
      const status = outboundByInventory.get(item.id)?.status;
      const check = shippingChecks.find((c) => c.inventoryId === item.id);
      // Pallet dicek dulu (scan per paket) sebelum boleh diserahkan ke transporter.
      const checkLabel =
        check?.status === "CHECKING"
          ? `Dicek ${check.checkedQuantity}/${check.quantity}…`
          : check?.status !== "CHECKED"
            ? "Menunggu pengecekan…"
            : undefined;
      return (
        <>
          {check && (
            <div className="mt-3">
              <ProgressRow label="Pengecekan" done={check.checkedQuantity} total={check.quantity} color="bg-teal-500" />
            </div>
          )}
          <div className="mt-2 flex">
            <ActionButton
              label="Load ke Truk"
              variant="shipping"
              busyLabel={status === "LOADING" ? "Sedang dimuat…" : status ? "Antre muat…" : checkLabel}
              onClick={() => shipPallet(item.id)}
            />
          </div>
        </>
      );
    }

    // Pallet yang sedang diambil picker / diturunkan forklift (let-down) tidak boleh dipindah dulu.
    const isLetDown = letDownLocationIds.has(item.locationId);
    const isBeingPicked = pickingInventoryIds.has(item.id) || isLetDown;
    if (kind === "RACK" && pickFormItemId === item.id) {
      return (
        <PickForm
          available={getAvailableQuantity(item)}
          canShip={freeSlots.shipping}
          canSameday={freeSlots.sameday}
          onCancel={() => setPickFormItemId(null)}
          onSubmit={(quantity, sameday) => {
            if (createPackingOrder(item.id, quantity, sameday)) setPickFormItemId(null);
          }}
        />
      );
    }
    return (
      <div className="mt-3 flex gap-2">
        <ActionButton
          label={kind === "STAGING" || kind === "RETURN" ? "Putaway" : "Move"}
          busyLabel={
            isMoving
              ? "Menunggu forklift…"
              : movingInventoryId === item.id
                ? "Pilih tujuan di rack…"
                : isBeingPicked
                  ? "Sedang di-pick…"
                  : undefined
          }
          onClick={() => beginMove(item.id)}
        />
        {kind === "RACK" && !isMoving && (
          <ActionButton
            label="Pick → Packing"
            variant="secondary"
            busyLabel={
              isLetDown
                ? "Sedang let-down…"
                : !freeSlots.packing
                ? "Packing penuh"
                : !freeSlots.shipping && !freeSlots.sameday
                  ? "Shipping & loket penuh"
                  : getAvailableQuantity(item) <= 0
                    ? "Stok habis"
                    : undefined
            }
            onClick={() => setPickFormItemId(item.id)}
          />
        )}
      </div>
    );
  };

  return (
    <aside className="absolute top-4 right-4 z-10 flex max-h-[calc(100%-15rem)] w-80 flex-col rounded-lg border border-slate-200 bg-white shadow-lg">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <p className="text-xs text-slate-500">{KIND_TITLES[kind]}</p>
          <h2 className="text-base font-semibold text-slate-900">{location?.code ?? floorSlot?.code}</h2>
        </div>
        <button
          type="button"
          onClick={() => selectLocation(null)}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      <div className="flex flex-col gap-4 overflow-y-auto px-4 py-3 text-sm">
        {location ? (
          <OccupancySection
            stock={items.reduce((total, item) => total + item.quantity, 0)}
            capacity={location.capacity}
            incoming={incomingByLocation.get(location.id) ?? 0}
          />
        ) : (
          <p className="text-xs text-slate-500">{kind !== "RACK" && KIND_DESCRIPTIONS[kind]}</p>
        )}

        {kind === "PACKING" ? (
          <PackingOrderCard order={activeOrderByStation.get(selectedLocationId)} />
        ) : kind === "SHIPPING" && activeOrderByShippingSlot.has(selectedLocationId) ? (
          <ConveyorFillCard order={activeOrderByShippingSlot.get(selectedLocationId)!} />
        ) : items.length === 0 ? (
          <p className="rounded-md bg-slate-50 px-3 py-4 text-center text-slate-500">
            {kind === "RACK" ? "Location kosong" : "Slot kosong"}
          </p>
        ) : (
          items.map((item) => {
            const product = productBySku.get(item.sku);
            const unit = product?.unit ?? "PCS";
            return (
              <section key={item.id} className="rounded-md border border-slate-200 p-3">
                <p className="text-xs text-slate-500">{item.sku}</p>
                <p className="mb-2 font-medium text-slate-900">{product?.name ?? "Unknown product"}</p>
                <dl className="grid grid-cols-2 gap-y-1 text-slate-600">
                  <dt>Stock</dt>
                  <dd className="text-right tabular-nums">
                    {item.quantity} {unit}
                  </dd>
                  <dt>Reserved</dt>
                  <dd className="text-right tabular-nums">
                    {item.reservedQuantity} {unit}
                  </dd>
                  <dt className="font-medium text-slate-900">Available</dt>
                  <dd className="text-right font-medium tabular-nums text-slate-900">
                    {getAvailableQuantity(item)} {unit}
                  </dd>
                </dl>
                {renderActions(item)}
              </section>
            );
          })
        )}
      </div>
    </aside>
  );
}

interface OccupancySectionProps {
  stock: number;
  capacity: number;
  /** Quantity dari movement yang sedang menuju location ini. */
  incoming: number;
}

function OccupancySection({ stock, capacity, incoming }: OccupancySectionProps) {
  const status = getLocationStatus(stock, capacity);
  const occupancy = getOccupancy(stock, capacity);
  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-slate-500">Occupancy</span>
        <span
          className="rounded px-2 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: STATUS_COLORS[status] }}
        >
          {STATUS_LABELS[status]}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(occupancy, 100)}%`, backgroundColor: STATUS_COLORS[status] }}
        />
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>
          {stock} / {capacity} PCS
        </span>
        <span className="font-medium text-slate-700">{Math.round(occupancy)}%</span>
      </div>
      {incoming > 0 && (
        <p className="mt-1 text-xs text-blue-600">+{incoming} PCS sedang dalam perjalanan ke sini</p>
      )}
    </section>
  );
}

const BUTTON_VARIANTS = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  secondary: "bg-amber-600 text-white hover:bg-amber-700",
  shipping: "bg-purple-600 text-white hover:bg-purple-700",
};

interface ActionButtonProps {
  label: string;
  /** Kalau diisi, tombol nonaktif dan menampilkan teks ini (mis. "Menunggu forklift…"). */
  busyLabel?: string;
  variant?: keyof typeof BUTTON_VARIANTS;
  onClick: () => void;
}

function ActionButton({ label, busyLabel, variant = "primary", onClick }: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={busyLabel !== undefined}
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium disabled:bg-slate-200 disabled:text-slate-500 ${BUTTON_VARIANTS[variant]}`}
    >
      {busyLabel ?? label}
    </button>
  );
}

interface PickFormProps {
  /** Stok available pallet ini. */
  available: number;
  /** Masih ada slot Shipping / tumpukan loket Sameday kosong. */
  canShip: boolean;
  canSameday: boolean;
  onSubmit: (quantity: number, sameday: boolean) => void;
  onCancel: () => void;
}

/** Input quantity PCS yang di-pick untuk dikemas, dan tujuannya (truk lewat Shipping, atau Sameday/Gojek). */
function PickForm({ available, canShip, canSameday, onSubmit, onCancel }: PickFormProps) {
  const [sameday, setSameday] = useState(!canShip);
  const maxQuantity = Math.min(available, sameday ? MAX_SAMEDAY_QUANTITY : MAX_PICK_QUANTITY);
  const [quantity, setQuantity] = useState(Math.min(sameday ? 2 : 10, maxQuantity));
  const isValid =
    Number.isInteger(quantity) && quantity >= 1 && quantity <= maxQuantity && (sameday ? canSameday : canShip);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (isValid) onSubmit(quantity, sameday);
  };

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 rounded-md bg-amber-50 p-2">
      <label className="flex items-center gap-2 text-xs text-amber-900">
        <input
          type="checkbox"
          checked={sameday}
          disabled={!canSameday || !canShip}
          onChange={(e) => {
            setSameday(e.target.checked);
            // Order sameday dibatasi (1 driver Gojek membawa semuanya).
            if (e.target.checked) setQuantity((q) => Math.min(q, MAX_SAMEDAY_QUANTITY, available));
          }}
          className="accent-green-600"
        />
        Sameday (diambil Gojek di loket)
        {!canSameday && <span className="text-slate-500">· loket penuh</span>}
      </label>
      <label className="text-xs text-amber-900" htmlFor="pick-qty">
        Quantity pick (maks {maxQuantity} PCS)
      </label>
      <div className="flex gap-2">
        <input
          id="pick-qty"
          type="number"
          min={1}
          max={maxQuantity}
          autoFocus
          value={Number.isNaN(quantity) ? "" : quantity}
          onChange={(e) => setQuantity(e.target.valueAsNumber)}
          className="w-20 rounded-md border border-amber-300 bg-white px-2 py-1 text-sm tabular-nums outline-none focus:border-amber-500"
        />
        <button
          type="submit"
          disabled={!isValid}
          className="flex-1 rounded-md bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-500"
        >
          Pick
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-2 text-sm text-slate-500 hover:bg-amber-100">
          Batal
        </button>
      </div>
    </form>
  );
}

const ORDER_STATUS_LABELS: Record<PackingOrderStatus, string> = {
  QUEUED: "Menunggu orang inventory…",
  PICKING: "Orang inventory mengambil barang…",
  AT_CHECKIN: "Di meja check-in, menunggu diperiksa",
  CHECKING: "Diperiksa di check-in (scan per PCS)…",
  TO_PACKING: "Diantar checker ke packing…",
  HANDOVER: "Serah terima barang ke packer…",
  PACKING: "Sedang dikemas per PCS, paket langsung ke conveyor",
  CONVEYING: "Selesai dikemas, paket terakhir di conveyor…",
  AT_COUNTER: "Di loket Sameday, menunggu driver Gojek…",
  CLOSED: "Selesai",
};

/** Progress per PCS untuk satu tahap (check-in / packing). */
function ProgressRow({ label, done, total, color }: { label: string; done: number; total: number; color: string }) {
  return (
    <div className="mb-1.5">
      <div className="mb-0.5 flex justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="font-medium tabular-nums text-slate-900">
          {done}/{total} PCS
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${(done / total) * 100}%` }} />
      </div>
    </div>
  );
}

/** Status let-down yang ditampilkan menggantikan status order selama picker masih di rack. */
const LET_DOWN_LABELS: Partial<Record<LetDownStatus, string>> = {
  PENDING: "Rack level atas: menunggu forklift menurunkan pallet…",
  FETCHING: "Forklift menuju rack untuk menurunkan pallet…",
  LOWERING: "Forklift menurunkan pallet…",
  HOLDING: "Pallet diturunkan, orang inventory mengambil barang…",
};

/** Isi packing station: order pick & pack beserta progress per PCS. Packing mulai otomatis setelah check-in. */
function PackingOrderCard({ order }: { order: PackingOrder | undefined }) {
  const letDown = useWarehouseStore((s) => (order ? s.letDowns.find((l) => l.orderId === order.id) : undefined));
  if (!order) {
    return (
      <p className="rounded-md bg-slate-50 px-3 py-4 text-center text-slate-500">
        Station kosong. Pick barang dari location rack untuk mulai packing.
      </p>
    );
  }

  const product = productBySku.get(order.sku);

  return (
    <section className="rounded-md border border-slate-200 p-3">
      <p className="text-xs text-slate-500">
        {order.id} · dari {getLocationCode(order.fromLocationId)}
      </p>
      <p className="font-medium text-slate-900">{product?.name ?? order.sku}</p>
      <p className="mb-2 text-xs text-slate-500">{order.sku}</p>

      <p className="mb-2 text-xs text-slate-600">
        {letDown && LET_DOWN_LABELS[letDown.status] ? LET_DOWN_LABELS[letDown.status] : ORDER_STATUS_LABELS[order.status]}
      </p>
      <ProgressRow label="Check-in" done={order.checkedQuantity} total={order.quantity} color="bg-cyan-500" />
      <ProgressRow label="Packing" done={order.packedQuantity} total={order.quantity} color="bg-amber-500" />
      <ProgressRow label="Conveyor" done={order.conveyedQuantity} total={order.quantity} color="bg-purple-500" />
      <p className="mt-1 text-xs text-slate-500">
        1 PCS = 1 paket · {order.conveyedQuantity} paket sampai di{" "}
        {order.destination.kind === "SAMEDAY" ? "loket Sameday" : getLocationCode(order.destination.slotId)}
      </p>
    </section>
  );
}

/** Slot Shipping yang palletnya sedang diisi conveyor dari packing station. */
function ConveyorFillCard({ order }: { order: PackingOrder }) {
  const product = productBySku.get(order.sku);
  return (
    <section className="rounded-md border border-slate-200 p-3">
      <p className="text-xs text-slate-500">
        {order.id} · dari {getLocationCode(order.stationId)} via conveyor
      </p>
      <p className="mb-2 font-medium text-slate-900">{product?.name ?? order.sku}</p>
      <ProgressRow label="Paket sampai" done={order.conveyedQuantity} total={order.quantity} color="bg-purple-500" />
      <p className="mt-1 text-xs text-slate-500">Pallet bisa dimuat ke truk setelah semua paket sampai.</p>
    </section>
  );
}
