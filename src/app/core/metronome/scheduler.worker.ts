/// <reference lib="webworker" />

type SchedulerCommand =
  | { type: 'start'; intervalMs: number }
  | { type: 'stop' };

let running = false;
let intervalMs = 25;
let timeoutHandle: number | null = null;

function scheduleNextTick(): void {
  if (!running) {
    return;
  }

  timeoutHandle = self.setTimeout(() => {
    postMessage({ type: 'tick' });
    scheduleNextTick();
  }, intervalMs);
}

addEventListener('message', ({ data }: MessageEvent<SchedulerCommand>) => {
  if (data.type === 'start') {
    intervalMs = Math.max(10, Math.floor(data.intervalMs));

    if (running) {
      return;
    }

    running = true;
    scheduleNextTick();
    return;
  }

  running = false;

  if (timeoutHandle !== null) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
});

export {};
