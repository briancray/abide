/**
 * The key a bound component carries what `mount` needs under: its props as accessors, and a loader
 * for its browser module. A registered symbol, because the module that sets it is generated text
 * (`boundModule`) and spells it by its description.
 */
export const MOUNTABLE = Symbol.for('abide.mountable')
