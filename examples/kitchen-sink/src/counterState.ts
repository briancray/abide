/*
Module-level state stands in for a database for the counter demos. Shared
between getCounter / incrementCounter / resetCounter under src/server/rpc/.
*/
export const counterState = { count: 0 }
