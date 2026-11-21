/** Runs at most `n` tasks at once; the rest wait in arrival order. */
export function withLimit(n: number): <T>(task: () => Promise<T>) => Promise<T> {
  const waiting: Array<() => void> = [];
  let active = 0;
  return async (task) => {
    if (active >= n) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Runs `task` with an abort signal. After `ms`, aborts it and resolves to `onTimeout` without waiting for it. */
export async function withTimeout<T>(ms: number, onTimeout: T, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(onTimeout);
    }, ms);
  });
  try {
    return await Promise.race([task(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}
