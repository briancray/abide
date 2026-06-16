/*
Request header a abide client fetch sets (value '1') only when navigator.onLine
is false, so a handler's online() reflects the calling client's connectivity.
Presence = offline; absence = online/unknown. In a bundle the client and the
embedded server share a machine, so this carries exactly the outbound
reachability a handler reaching external sites needs.
*/
export const OFFLINE_HEADER = 'abide-offline'
