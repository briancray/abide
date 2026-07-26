// The comment-anchor VALUES that bracket a `{html(...)}` region: `<!--[h-->` … `<!--]h-->` (a numeric
// suffix is appended to BOTH when the injected markup already contains the close marker — see
// `serverRuntime.renderHtml`). Shared by the plan's skeleton, the server render and the claim walk, so
// the three cannot drift: the region's extent is READ from these markers rather than re-derived, which
// is what makes it sound for arbitrary raw markup.
export const HTML_ANCHOR = { open: '[h', close: ']h' } as const
