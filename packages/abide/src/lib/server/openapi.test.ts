// Registry + OpenAPI 3.1 generation (machine-surfaces.md MS1/MS4). Exercises buildRegistry and
// buildOpenApi directly, then end-to-end through the live `/openapi.json` route.

import { test, expect } from "bun:test";
import { GET } from "./GET.ts";
import { POST } from "./POST.ts";
import { socket } from "./socket.ts";
import { buildRegistry } from "./internal/registry.ts";
import { buildOpenApi } from "./internal/openapi.ts";
import { createTestApp, type TestAppConfig } from "../test/createTestApp.ts";
import type { JSONSchema } from "../shared/internal/jsonSchema.ts";

const searchInput: JSONSchema = {
  type: "object",
  properties: { q: { type: "string" } },
  required: ["q"],
};

const searchOutput: JSONSchema = {
  type: "object",
  properties: { hits: { type: "array", items: { type: "string" } } },
};

function fixtureConfig(): TestAppConfig {
  return {
    routes: {
      search: GET(async (args: { q: string }) => ({ hits: [args.q] }), {
        schemas: { input: searchInput, output: searchOutput },
        doc: "Search the index",
      }),
      create: POST(async (args: { title: string }) => ({ id: 1, title: args.title }), {
        schemas: { input: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
      }),
      secret: GET(async () => ({ ok: true }), { clients: { browser: false } }),
    },
    sockets: {
      ticks: socket<number>({ clientPublish: true }),
    },
  };
}

test("buildRegistry captures rpcs, schemas, clients, and sockets", () => {
  const registry = buildRegistry(fixtureConfig());

  const search = registry.rpcs.find((entry) => entry.name === "search");
  expect(search).toBeDefined();
  expect(search!.method).toBe("GET");
  expect(search!.read).toBe(true);
  expect(search!.inputSchema).toEqual(searchInput);
  expect(search!.outputSchema).toEqual(searchOutput);
  expect(search!.doc).toBe("Search the index");

  const create = registry.rpcs.find((entry) => entry.name === "create");
  expect(create!.method).toBe("POST");
  expect(create!.read).toBe(false);
  expect(create!.inputSchema).toBeDefined();
  expect(create!.outputSchema).toBeUndefined();

  const secret = registry.rpcs.find((entry) => entry.name === "secret");
  expect(secret!.clients.browser).toBe(false);

  const ticks = registry.sockets.find((entry) => entry.name === "ticks");
  expect(ticks).toBeDefined();
  expect(ticks!.clientPublish).toBe(true);
});

test("buildRegistry leaves inputSchema undefined for a Standard Schema", () => {
  const standardSchema = {
    "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) },
  };
  const registry = buildRegistry({
    routes: {
      thing: GET(async () => ({}), { schemas: { input: standardSchema as never } }),
    },
  });
  const thing = registry.rpcs.find((entry) => entry.name === "thing");
  expect(thing!.inputSchema).toBeUndefined();
});

test("buildOpenApi emits a 3.1 document with GET query param and POST requestBody", () => {
  const doc = buildOpenApi(buildRegistry(fixtureConfig()));

  expect(doc.openapi).toBe("3.1.0");
  const info = doc.info as Record<string, unknown>;
  expect(info.title).toBe("abide app");

  const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;

  const searchGet = paths["/rpc/search"]!.get!;
  const parameters = searchGet.parameters as Array<Record<string, unknown>>;
  expect(parameters[0]!.name).toBe("args");
  expect(parameters[0]!.in).toBe("query");
  expect(parameters[0]!.required).toBe(true);
  expect((searchGet.responses as Record<string, unknown>)["422"]).toBeDefined();
  expect(searchGet.summary).toBe("Search the index");

  const createPost = paths["/rpc/create"]!.post!;
  expect(createPost.requestBody).toBeDefined();
  expect((createPost.responses as Record<string, unknown>)["200"]).toBeDefined();

  // browser:false RPC is omitted entirely.
  expect(paths["/rpc/secret"]).toBeUndefined();

  const components = doc.components as Record<string, Record<string, unknown>>;
  expect(components.schemas!.ValidationError).toBeDefined();
  expect(components.securitySchemes!.bearerAuth).toBeDefined();
});

test("GET /openapi.json serves the generated document", async () => {
  const app = createTestApp(fixtureConfig());
  try {
    const response = await app.fetch("/openapi.json");
    expect(response.status).toBe(200);
    const doc = (await response.json()) as Record<string, any>;

    expect(doc.openapi).toBe("3.1.0");
    const searchGet = doc.paths["/rpc/search"].get;
    expect(searchGet).toBeDefined();
    // The args object is carried in a single `args` query param whose schema types the q field.
    expect(searchGet.parameters[0].name).toBe("args");
    expect(searchGet.parameters[0].schema.properties.q).toBeDefined();
    expect(doc.paths["/rpc/create"].post.requestBody).toBeDefined();
    expect(doc.paths["/rpc/create"].post.responses["422"]).toBeDefined();
    expect(doc.paths["/rpc/secret"]).toBeUndefined();
  } finally {
    await app.stop();
  }
});
