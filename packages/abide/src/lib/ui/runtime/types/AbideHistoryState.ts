/* The shape abide stamps into `History.state`: a monotonic `abideEntry` id the router
   buckets scroll by, and the last `scroll` offset persisted for that entry (so a reload
   can recover it — the in-memory bucket does not survive). Both optional: a foreign or
   bare entry (one another script pushed, or the first landing before a stamp) carries
   neither, which the readers treat as "no abide data". */
export type AbideHistoryState = {
    abideEntry?: number
    scroll?: [number, number]
}
