/**
 * Client-side reactive routing cell. Mutating any field reactively swaps the
 * rendered tree. `layouts` is the resolved view chain (root → leaf).
 *
 * @type {{
 *   layouts: Array<{ key: string, Component: any }>,
 *   Page: any,
 *   params: Record<string, string>,
 *   data: Record<string, unknown>
 * }}
 */
export const nav = $state({
    layouts: [],
    Page: null,
    params: {},
    data: {},
})
