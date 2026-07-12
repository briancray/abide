/*
Internal holder for the in-process page-render dispatch. createServer sets this
once at boot, closing over the app's route resolver + render pipeline, so the
public `render()` can turn a route URL into the same Response the HTTP fetch
handler would — a page render, without a socket hop. Empty until boot: `render()`
throws on access before the slot is set (mirroring serverSlot / server()). The
closure runs the matched page handler directly under runWithRequestScope — like
dispatchRpcInProcess for rpcs — so it skips app.handle middleware and wire
finalization (gzip); it is the page analogue of the in-process rpc seam.
*/
export const pageRenderSlot: {
    render: ((request: Request, url: URL) => Promise<Response>) | undefined
} = {
    render: undefined,
}
