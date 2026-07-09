/* The classification scanPages returns for src/ui/pages: route leaves
   (page.abide) and layout leaves (layout.abide), each an array of paths
   relative to the pages dir. */
export type PagesScan = {
    pageFiles: string[]
    layoutFiles: string[]
}
