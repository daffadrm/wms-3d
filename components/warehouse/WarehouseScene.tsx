"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useMemo } from "react";
import {
  PALLET_CAPACITY,
  locations,
  locationsByRack,
  packingStations,
  racks,
  shippingSlots,
  stagingLocations,
  warehouseLayout,
} from "@/data/warehouse";
import { canReceive, getPickerHomes } from "@/lib/movement";
import {
  useActiveOrderByShippingSlot,
  useActiveOrderByStation,
  useIncomingByLocation,
  useLiftedLocationIds,
  useInventoryByLocation,
  useMovingInventory,
  useOutboundByInventory,
  useStockByLocation,
  useUsedStagingIds,
  useWarehouseStore,
} from "@/store/warehouseStore";
import Dock from "./Dock";
import { getOverviewFocus } from "@/lib/camera";
import WarehouseFloor, { YARD_WIDTH } from "./WarehouseFloor";
import FrontYard, { FRONT_YARD_DEPTH } from "./FrontYard";
import WarehouseArea from "./WarehouseArea";
import Rack from "./Rack";
import Pallets, {
  FLOOR_PALLET_ROTATION,
  ParcelPallet,
  buildFloorPlacements,
  buildPalletPlacements,
} from "./Pallets";
import FloorSlotMarker from "./FloorSlotMarker";
import PackingStation from "./PackingStation";
import Conveyor from "./Conveyor";
import ShippingChecker from "./ShippingChecker";
import SamedayCounter from "./SamedayCounter";
import Office from "./Office";
import SelectionMarker from "./SelectionMarker";
import Forklift, { ForkliftParking } from "./Forklift";
import Picker from "./Picker";
import CheckinArea from "./CheckinArea";
import ReturnArea from "./ReturnArea";
import CameraRig from "./CameraRig";
import type { MoveTargetState } from "./Location";

/** Jumlah orang inventory (picker); semuanya mengambil order dari antrean yang sama. */
const PICKER_COUNT = 3;
const pickerHomes = getPickerHomes(racks, warehouseLayout.depth, PICKER_COUNT);
/** Jumlah forklift; parkir di sisi barat gudang (lihat getHomePose), berbagi antrean movement & let-down. */
const FORKLIFT_COUNT = 2;
const forkliftIndexes = Array.from({ length: FORKLIFT_COUNT }, (_, i) => i);

const STAGING_COLOR = "#16a34a";
const SHIPPING_COLOR = "#9333ea";

export default function WarehouseScene() {
  const { width, depth, wallHeight, areas, docks } = warehouseLayout;
  const stockByLocation = useStockByLocation();
  const inventoryByLocation = useInventoryByLocation();
  const activeOrderByStation = useActiveOrderByStation();
  const activeOrderByShippingSlot = useActiveOrderByShippingSlot();
  const outboundByInventory = useOutboundByInventory();
  const usedStagingIds = useUsedStagingIds();
  const incomingByLocation = useIncomingByLocation();
  const movingItem = useMovingInventory();

  const liftedLocationIds = useLiftedLocationIds();

  const palletPlacements = useMemo(() => {
    // Pallet yang sedang di fork forklift (let-down) tidak digambar di rack-nya.
    const inRack = liftedLocationIds.size
      ? new Map([...stockByLocation].filter(([id]) => !liftedLocationIds.has(id)))
      : stockByLocation;
    return [
      ...buildPalletPlacements(racks, locations, inRack),
      // Pallet di Shipping berisi paket, dirender sendiri oleh slot-nya.
      ...buildFloorPlacements(stagingLocations, stockByLocation, PALLET_CAPACITY),
    ];
  }, [stockByLocation, liftedLocationIds]);

  const moveTargets = useMemo(() => {
    if (!movingItem) return undefined;
    return new Map<string, MoveTargetState>(
      locations.map((l) => [
        l.id,
        canReceive(l, movingItem, stockByLocation.get(l.id) ?? 0, incomingByLocation.get(l.id) ?? 0)
          ? "valid"
          : "invalid",
      ]),
    );
  }, [movingItem, stockByLocation, incomingByLocation]);

  // Sisi terpanjang warehouse, dipakai untuk batas zoom dan shadow camera.
  const span = Math.max(width, depth);
  // Shadow camera mencakup yard truk & halaman depan, bukan hanya lantai gudang.
  const shadowExtent = Math.max(width / 2 + YARD_WIDTH, depth / 2 + FRONT_YARD_DEPTH);
  const overview = getOverviewFocus();

  return (
    <Canvas
      // PCFSoftShadowMap (default `shadows`) sudah dihapus di Three r186.
      shadows="percentage"
      camera={{ position: overview.position, fov: 45, near: 0.1, far: 500 }}
      // Klik di area kosong: batalkan pilih tujuan, atau tutup panel detail.
      onPointerMissed={() => {
        const { movingInventoryId, cancelMove, selectLocation } = useWarehouseStore.getState();
        if (movingInventoryId) cancelMove();
        else selectLocation(null);
      }}
    >
      <color attach="background" args={["#e2e8f0"]} />

      <ambientLight intensity={0.6} />
      <directionalLight
        position={[15, 25, 10]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
      />

      <WarehouseFloor width={width} depth={depth} wallHeight={wallHeight} docks={docks} />
      <FrontYard width={width} depth={depth} />
      {docks.map((dock) => (
        <Dock key={dock.id} dock={dock} wallX={dock.wall === "EAST" ? width / 2 : -width / 2} />
      ))}
      {areas.map((area) => (
        <WarehouseArea key={area.id} area={area} />
      ))}
      {racks.map((rack) => (
        <Rack
          key={rack.id}
          rack={rack}
          locations={locationsByRack.get(rack.id) ?? []}
          stockByLocation={stockByLocation}
          moveTargets={moveTargets}
        />
      ))}
      {stagingLocations.map((staging) => (
        <FloorSlotMarker
          key={staging.id}
          slot={staging}
          color={STAGING_COLOR}
          occupied={stockByLocation.has(staging.id)}
          reserved={usedStagingIds.has(staging.id) && !stockByLocation.has(staging.id)}
        />
      ))}
      {packingStations.map((station) => (
        <PackingStation key={station.id} station={station} order={activeOrderByStation.get(station.id)} />
      ))}
      {shippingSlots.map((slot) => {
        const item = inventoryByLocation.get(slot.id)?.[0];
        // Pallet yang masih diisi conveyor: belum jadi inventory sampai paket terakhir sampai.
        const filling = activeOrderByShippingSlot.get(slot.id);
        const parcels = item?.quantity ?? filling?.conveyedQuantity;
        return (
          <FloorSlotMarker
            key={slot.id}
            slot={slot}
            color={SHIPPING_COLOR}
            occupied={item !== undefined || filling !== undefined}
            // Amber: pallet sudah diantrekan untuk dimuat ke truk.
            reserved={item !== undefined && outboundByInventory.has(item.id)}
          >
            {/* Pallet di Shipping selalu pallet paket hasil packing (1 PCS = 1 paket). */}
            {parcels !== undefined && (
              <group rotation={[0, FLOOR_PALLET_ROTATION, 0]}>
                <ParcelPallet count={parcels} />
              </group>
            )}
          </FloorSlotMarker>
        );
      })}
      <Conveyor />
      <ShippingChecker />
      <SamedayCounter />
      <Office />
      <Pallets placements={palletPlacements} />
      {forkliftIndexes.map((i) => (
        <ForkliftParking key={i} index={i} />
      ))}
      {forkliftIndexes.map((i) => (
        <Forklift key={i} id={`forklift-${i + 1}`} index={i} />
      ))}
      {pickerHomes.map((home, i) => (
        <Picker key={i} id={`picker-${i + 1}`} home={home} />
      ))}
      <CheckinArea />
      <ReturnArea />
      <SelectionMarker />
      <CameraRig />

      <OrbitControls
        makeDefault
        target={overview.target}
        enableDamping
        minDistance={5}
        maxDistance={span * 2}
        // Jangan sampai kamera masuk ke bawah lantai.
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  );
}
