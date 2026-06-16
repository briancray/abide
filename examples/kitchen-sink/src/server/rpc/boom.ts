import { GET } from '@abide/abide/server/GET'

/*
Always throws. Routes through abide's handleError fallback (defined in
src/app.ts here), producing a 500 with the framework's no-store cache
header. Used by /rpc/errors.
*/
export const boom = GET(() => {
    throw new Error('intentional boom — exercising the 500 error path')
})
