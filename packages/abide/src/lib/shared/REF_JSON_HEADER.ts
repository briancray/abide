/*
Request header the RPC client stamps (value '1') when an `application/json` body is
ref-json-encoded (encodeRefJson), so the server decodes with the matching codec.
Its presence is the unambiguous discriminator: ref-json's `[rootValue, slots]`
envelope collides with a legitimate plain-JSON 2-element array body, so the shape
alone can't be trusted. Absence means an ordinary JSON body from a non-abide client
(curl, an OpenAPI-generated SDK, a webhook) — parseArgs reads it with plain JSON.parse.
*/
export const REF_JSON_HEADER = 'abide-ref-json'
