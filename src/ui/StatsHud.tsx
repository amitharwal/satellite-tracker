import { perfMonitor } from '@/state';
import { useStore } from '@/ui/useStore';

const f1 = (n: number) => n.toFixed(1);

/** Performance overlay; updates at the monitor's publish rate (2 Hz), not per frame. */
export function StatsHud() {
  const snap = useStore(perfMonitor.store);
  const p = snap?.propagation;
  return (
    <div className="pointer-events-none rounded-md bg-black/70 px-3 py-2 font-mono text-xs leading-5 text-neutral-200 tabular-nums">
      {snap ? (
        <>
          <div>
            {f1(snap.fps)} fps · frame {f1(snap.frameMs)} ms
          </div>
          <div>
            render CPU {snap.cpuMs.toFixed(2)} ms (max {snap.cpuMsMax.toFixed(2)})
          </div>
          {p && (
            <>
              <div>
                {p.workers} workers · {p.satellites.toLocaleString()} sats · {p.failed} flagged
              </div>
              <div>
                batch {p.workerMs.toFixed(2)} ms worker · {p.roundTripMs.toFixed(2)} ms round trip
                (mean)
              </div>
              <div>
                {f1(p.batchesPerSec)} / {f1(p.targetHz)} Hz · late frames {p.lateFramesInPeriod}
              </div>
              <div>init {f1(p.initMs)} ms</div>
            </>
          )}
        </>
      ) : (
        <div>collecting…</div>
      )}
    </div>
  );
}
