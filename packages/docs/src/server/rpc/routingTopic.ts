import { GET } from "abide/server/GET"

export interface RoutingTopic {
  slug: string
  title: string
  blurb: string
}

// Read RPC used by the `/routing-demo/[slug]` param route: the captured `slug` becomes this RPC's
// single argument, proving a route param can flow straight into an isomorphic read.
// #demo routing-topic
export default GET(
  ({ slug }: { slug: string }): RoutingTopic => ({
    slug,
    title: `Topic: ${slug}`,
    blurb: `This record was loaded for the "${slug}" param captured from the URL path.`,
  }),
)
// #enddemo
