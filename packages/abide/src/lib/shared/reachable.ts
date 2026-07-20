// reachable(host) — an actively-probed reachability check (CO2.5). Attempts a short-timeout fetch
// and reports whether the host answered at all: any HTTP response (even a 404) means the host is
// reachable; a network error / timeout / refused connection means it is not.

const PROBE_TIMEOUT_MS = 2000;

export async function reachable(host: string): Promise<boolean> {
  try {
    await fetch(host, { method: "HEAD", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}
