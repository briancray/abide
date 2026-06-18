/*
The SVG foreign-content namespace. An element created in it (or cloned from a
parser-built `<svg>` subtree) renders as SVG; the same tag in the HTML namespace
renders as nothing. The imperative build reads it to namespace foreign elements that
the static `skeleton` path doesn't cover (a foreign parent with dynamic children).
*/
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
