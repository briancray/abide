/*
The SVG foreign-content namespace. An element created in it (or cloned from a
parser-built `<svg>` subtree) renders as SVG; the same tag in the HTML namespace
renders as nothing. The runtime reads it (via `effectiveChildNamespace`) to namespace
foreign children mounted into a foreign parent dynamically — at a skeleton anchor or in a
control-flow fragment — where no parser-built `<svg>` ancestor namespaces them for free.
*/
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
