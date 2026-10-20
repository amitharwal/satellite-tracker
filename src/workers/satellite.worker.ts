// Propagation worker: owns one contiguous slice of the catalog.
import { FLOATS_PER_SATELLITE, type FromWorker, type ToWorker } from './protocol.ts';
import { SlicePropagator } from './slice.ts';

// The app's tsconfig uses the DOM lib, so type just the worker scope we use.
interface WorkerScope {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

let slice: SlicePropagator | null = null;

function post(message: FromWorker, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

scope.onmessage = (event) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      const start = performance.now();
      slice = new SlicePropagator(message.columns);
      post({
        type: 'ready',
        count: slice.count,
        initMs: performance.now() - start,
        initFailures: slice.initFailures,
      });
      return;
    }

    if (!slice) throw new Error('propagate before init');
    const floats = slice.count * FLOATS_PER_SATELLITE;
    const positions =
      message.positions?.byteLength === floats * 4
        ? new Float32Array(message.positions)
        : new Float32Array(floats);
    const status =
      message.status?.byteLength === slice.count
        ? new Uint8Array(message.status)
        : new Uint8Array(slice.count);

    const start = performance.now();
    const failed = slice.propagate(message.t0Ms, message.t1Ms, positions, status);
    post(
      {
        type: 'positions',
        id: message.id,
        t0Ms: message.t0Ms,
        t1Ms: message.t1Ms,
        positions: positions.buffer,
        status: status.buffer,
        elapsedMs: performance.now() - start,
        failed,
      },
      [positions.buffer, status.buffer],
    );
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
