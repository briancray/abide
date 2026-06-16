/*
Method of a cache entry that may re-fire unprompted — snapshot replay on the
client, invalidate-policy refetch. Mirrors REPLAYABLE_METHODS (the runtime
gate; narrow via isReplayableMethod): only GET qualifies, the one safe
read-only method.
*/
export type ReplayableMethod = 'GET'
