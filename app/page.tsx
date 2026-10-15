import Image from "next/image";
import WarehouseScene from "@/components/warehouse/WarehouseScene";
import StatusLegend from "@/components/warehouse/StatusLegend";
import LocationDetail from "@/components/inventory/LocationDetail";
import LocationTooltip from "@/components/warehouse/LocationTooltip";
import MovementPanel from "@/components/movement/MovementPanel";
import MoveTargetBanner from "@/components/movement/MoveTargetBanner";
import InboundPanel from "@/components/inbound/InboundPanel";
import OutboundPanel from "@/components/outbound/OutboundPanel";
import ReturnPanel from "@/components/returns/ReturnPanel";
import SearchBox from "@/components/search/SearchBox";
import CameraPresets from "@/components/warehouse/CameraPresets";
import Sidebar from "@/components/layout/Sidebar";
import SimulationPanel from "@/components/simulation/SimulationPanel";

export default function Home() {
  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
        <div className="flex items-center gap-3">
          {/* Rasio asli logo 1181×294. */}
          <Image src="/flexofast.png" alt="Flexofast" width={128} height={32} loading="eager" />
          <span className="h-6 w-px bg-slate-200" />
          <h1 className="text-lg font-bold tracking-tight">WMS 3D</h1>
        </div>
        <div className="flex items-center gap-4">
          <SearchBox />
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">
            U
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar />

        <main className="relative min-w-0 flex-1">
          {/* Canvas R3F mengikuti ukuran parent; absolute supaya selalu full. */}
          <div className="absolute inset-0">
            <WarehouseScene />
          </div>
          <div className="absolute top-4 bottom-56 left-4 flex w-64 flex-col gap-3 overflow-y-auto">
            <SimulationPanel />
            <InboundPanel />
            <ReturnPanel />
            <OutboundPanel />
          </div>
          <StatusLegend />
          <MovementPanel />
          <CameraPresets />
          <MoveTargetBanner />
          <LocationDetail />
          <LocationTooltip />
        </main>
      </div>
    </div>
  );
}
