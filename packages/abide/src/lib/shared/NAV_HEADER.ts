/*
Request header the client router stamps (value '1') on its SPA navigation probe:
a bare fetch of the destination that exists only to run app.handle server-side
(auth, redirect, header gating) without paying for a render. Presence tells the
page dispatcher to answer 204 once handle() has passed — a redirect or block from
handle() never reaches that point. Absence is an ordinary document/render request.
*/
export const NAV_HEADER = 'abide-nav'
