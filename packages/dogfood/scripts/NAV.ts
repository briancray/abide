// The documentation's information architecture: ordered sections, ordered pages.
// A page's TITLE and INTENT are not here — they live in the markdown's own front
// matter, so there is one place to edit a page's words. This file is the ORDER and
// the GROUPING only, and `slug` is both the content path and the output path.
//
// A section's first page is its OVERVIEW, `<folder>/index`. It owns the opening that
// `content/index.md` shows through `{% lead <folder>/index %}`, so those words have one
// home. See "Documentation structure" in docs/BRAND.md.

export const NAV = [
    {
        section: 'Start',
        pages: [
            'index',
            'start/what-abide-is-for',
            'start/your-first-page',
            'start/how-a-page-becomes-html',
        ],
    },
    {
        section: 'Reactive values',
        pages: [
            'values/index',
            'values/show-a-value-that-changes',
            'values/show-a-value-that-isnt-there-yet',
            'values/derive-a-value-from-other-values',
            'values/load-once-per-set-of-arguments',
            'values/decide-when-a-value-reloads',
            'values/slow-down-a-value-that-changes-too-fast',
            'values/share-one-value-across-components',
            'values/do-something-when-a-value-changes',
            'values/keep-the-last-few-values',
        ],
    },
    {
        section: 'Data from the server',
        pages: [
            'server/index',
            'server/read-data-without-writing-an-api',
            'server/change-something-on-the-server',
            'server/refuse-a-request-and-say-why',
            'server/send-rows-as-they-are-ready',
            'server/keep-a-room-of-callers-in-sync',
            'server/check-what-callers-send-you',
            'server/decide-who-may-call-what',
            'server/let-another-origin-call-you',
            'server/put-a-ceiling-on-a-request',
            'server/answer-with-something-other-than-json',
            'server/find-the-url-a-handler-answers-on',
        ],
    },
    {
        section: 'Pages and navigation',
        pages: [
            'pages/index',
            'pages/add-a-page',
            'pages/give-pages-the-same-chrome',
            'pages/show-a-page-when-something-fails',
            'pages/set-the-title-and-social-preview',
            'pages/link-to-another-page',
            'pages/animate-from-one-page-to-the-next',
            'pages/serve-the-app-under-a-sub-path',
            'pages/send-the-page-before-the-data-lands',
            'pages/render-a-document-yourself',
        ],
    },
    {
        section: 'Templates',
        pages: [
            'templates/index',
            'templates/read-and-write-state-by-name',
            'templates/put-a-value-in-the-markup',
            'templates/respond-to-a-click',
            'templates/bind-a-form-to-state',
            'templates/show-markup-conditionally',
            'templates/repeat-markup-over-a-list',
            'templates/reuse-a-piece-of-markup',
            'templates/scope-styles-to-a-component',
            'templates/run-code-when-a-component-loads',
        ],
    },
    {
        section: 'The running app',
        pages: [
            'app/index',
            'app/configure-the-app',
            'app/run-code-at-start-and-stop',
            'app/know-who-is-calling',
            'app/read-the-incoming-request',
            'app/record-what-happened',
            'app/follow-a-request-across-services',
            'app/tell-a-load-balancer-you-are-healthy',
            'app/lock-down-what-the-page-may-load',
            'app/know-when-the-browser-goes-offline',
        ],
    },
    {
        section: 'Shipping',
        pages: [
            'ship/index',
            'ship/start-a-new-app',
            'ship/run-the-app-while-you-work',
            'ship/build-and-serve-the-app',
            'ship/catch-mistakes-before-you-ship',
            'ship/ship-a-single-binary',
            'ship/watch-a-running-app',
        ],
    },
    {
        section: 'Reference',
        pages: [
            'reference/reactive',
            'reference/transports',
            'reference/ambient-values',
            'reference/helpers',
            'reference/abide-files',
            'reference/routing',
            'reference/configuration',
            'reference/cli',
        ],
    },
] as const
