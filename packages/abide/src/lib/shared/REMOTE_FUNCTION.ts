/*
Brand set by createRemoteFunction on both the decoded callable and its raw
sibling — the exact answer to "is this a abide remote?" where structural
checks ('url' in fn) would misclassify any user function that happens to
carry a url property. Read by cache()'s remote/producer discriminator,
selectorMatcher's identity branch, and the route dispatcher's export scan.
*/
export const REMOTE_FUNCTION: unique symbol = Symbol('abide.remoteFunction')
