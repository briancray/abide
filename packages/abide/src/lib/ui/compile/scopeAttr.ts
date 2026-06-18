/*
Serializes one `<style>` scope marker to its empty-valued attribute fragment,
leading space included. Shared by the SSR generator and the static-clone skeleton
generator so server markup and the client clone template stamp the same scope
attributes in the same byte-shape.
*/
export function scopeAttr(scope: string): string {
    return ` ${scope}=""`
}
