/* The tag prefix every component instance mounts into (`abide-<name>`). One source
   for the compiler (componentWrapperTag) and the runtime opacity checks (skeleton,
   scopeLabel) so the wrapper convention can't drift between build and hydrate. */
export const COMPONENT_WRAPPER_PREFIX = 'abide-'
