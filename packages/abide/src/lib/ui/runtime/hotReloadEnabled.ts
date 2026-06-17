/*
Whether abide-ui hot-module replacement is active. Off by default, so production
and ordinary dev render exactly as before — `mountChild` takes the plain path.
The dev client sets it true once the hot bridge is in place, switching every
child mount onto the path that records its instance so an edited component can be
disposed and re-run where it stands.
*/
export const hotReloadEnabled: { current: boolean } = { current: false }
