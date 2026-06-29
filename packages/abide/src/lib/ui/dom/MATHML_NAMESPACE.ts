/*
The MathML foreign-content namespace — the `<math>` counterpart to `SVG_NAMESPACE`.
The runtime reads it to namespace MathML children mounted into a `<math>` parent
dynamically, where no parser-built ancestor namespaces them for free.
*/
export const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'
