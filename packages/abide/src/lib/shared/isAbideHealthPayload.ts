/*
Whether a health/identity response body identifies a abide server. The
`abide` field carries the framework version (a non-empty string) on current
servers and `true` on older ones — both accepted, so a newer prober still
recognises an older server. The body check (never response.ok alone) is the
captive-portal defense shared by every prober: a portal answers any GET with
a 200, but it doesn't answer with this.
*/
export function isAbideHealthPayload(body: { abide?: unknown }): boolean {
    return body.abide === true || (typeof body.abide === 'string' && body.abide !== '')
}
