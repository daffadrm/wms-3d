"use client";

import { useEffect, useState } from "react";
import { SIMULATION_INTENSITIES, runSimulationTick, type SimulationIntensity } from "@/lib/simulation";
import { useWarehouseStore } from "@/store/warehouseStore";

const MAX_LOG = 4;

/**
 * Auto simulation: gudang "hidup" sendiri. Tiap tick membuat permintaan acak (inbound, order pick,
 * retur) dan melanjutkan langkah yang biasanya diklik user (putaway, load ke truk, berangkatkan truk).
 */
export default function SimulationPanel() {
  const [running, setRunning] = useState(false);
  const [intensity, setIntensity] = useState<SimulationIntensity>("NORMAL");
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const events = runSimulationTick(useWarehouseStore.getState, intensity);
      if (events.length > 0) setLog((prev) => [...events.reverse(), ...prev].slice(0, MAX_LOG));
    };
    tick();
    const timer = window.setInterval(tick, SIMULATION_INTENSITIES[intensity].tickMs);
    return () => window.clearInterval(timer);
  }, [running, intensity]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-xs shadow-sm backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 font-semibold text-slate-700">
          <span
            className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-green-500" : "bg-slate-300"}`}
            aria-hidden
          />
          Auto Simulation
        </p>
        <span className="text-slate-500">{running ? "Berjalan" : "Berhenti"}</span>
      </div>

      <div className="flex gap-2">
        <select
          value={intensity}
          onChange={(e) => setIntensity(e.target.value as SimulationIntensity)}
          aria-label="Intensitas simulasi"
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500"
        >
          {Object.entries(SIMULATION_INTENSITIES).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-white ${
            running ? "bg-slate-600 hover:bg-slate-700" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {running ? "Pause" : "Start"}
        </button>
      </div>

      {log.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-slate-200 pt-2 text-slate-600">
          {log.map((entry, i) => (
            <li key={`${i}-${entry}`} className={`truncate ${i === 0 ? "text-slate-800" : ""}`}>
              {entry}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
