// health() — the framework baseline health probe (CO2.4). Returns at least `{ reachable: true }`;
// the app-defined `health()` hook is merged into `/__abide/health` on top of this baseline.

export function health(): { reachable: boolean; [k: string]: unknown } {
  return { reachable: true };
}
