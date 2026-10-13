# hono-serialization

Opt-in serialization for [Hono](https://hono.dev) RPC. Bring your own SuperJSON, devalue, Seroval, or binary codec. No serializer is bundled.

A client sends `x-hono-serialization: <name>`. The middleware encodes `s.json` responses and optionally decodes JSON request bodies. Requests without that header, or with an unknown name, receive ordinary Hono output.

## Install

```sh
npm install hono-serialization hono
```

Peer dependency: Hono `^4.13.13`. The package is ESM-only.

## Quick start

Define the shared codec in `codecs/superjson.ts`:

```ts
import SuperJSON from 'superjson'
import { defineSerializer } from 'hono-serialization/codec'

export const superjson = defineSerializer({
  name: 'superjson',
  json: {
    output: 'preserve',
    serialize: SuperJSON.stringify,
    parse: SuperJSON.parse,
    input: {
      output: 'preserve',
      serialize: SuperJSON.stringify,
      parse: SuperJSON.parse,
    },
  },
})
```

Create the middleware in `server.ts`:

```ts
import { Hono } from 'hono'
import { serialization } from 'hono-serialization'
import { superjson } from './codecs/superjson'

const s = serialization(superjson)
export const app = new Hono()
  .use('/api/*', s)
  .get('/api/item', (c) => s.json(c, { createdAt: new Date() }))

export type AppType = typeof app
```

Create the browser client in `client.ts`:

```ts
import { createClient } from 'hono-serialization/client'
import { superjson } from './codecs/superjson'
import type { AppType } from './server'

const client = createClient<AppType>('http://localhost', superjson)
const data = await (await client.api.item.$get()).json()
data.createdAt // Date
```

The browser imports the codec and RPC client. The `AppType` import is erased, so it does not load `server.ts` or its middleware.

`defineSerializer` is optional: `serialization({ name, json })` accepts and validates a configuration directly. A separate definition is convenient when the server and client share the codec.

Put `defineSerializer` imports in shared codec files using `hono-serialization/codec`, which has no Hono runtime or middleware dependency. Create `s = serialization(codec)` only on the server. Import `AppType` with `import type` on the client. Import the client from `hono-serialization/client` and only the codec a page needs.

## Codec contracts and RPC types

Declare how your JSON codec changes values:

- `json.output: 'preserve'`: the codec promises to preserve the values and types supplied to `s.json`, such as Date, Map, and Set. The client exposes the original output type.
- `json.output: 'json'`: the codec promises ordinary JSON conversion. The client exposes Hono's `JSONParsed<T>` type: Dates become strings.
- Omitted `json.output`, or `'unknown'`: decoded output is `unknown`. Validate it before accessing properties.

These are explicit codec contracts, not capabilities that TypeScript can prove about arbitrary functions. Choose `preserve` only for values supported by your codec; unsupported values must be rejected by the codec rather than silently converted. Declaring a false contract or using an unchecked cast can invalidate any TypeScript API's guarantees.

`s.json` carries an opaque output type in the app schema. `createClient` maps it according to the codec contract and checks that the codec belongs to the app's typed endpoints. Direct `hc<typeof app>` cannot access negotiated output as if it were plain JSON.

For ordinary JSON clients, use:

```ts
import { hc } from 'hono/client'
import type { JsonApp } from 'hono-serialization'

const plain = hc<JsonApp<AppType>>('http://localhost')
const data = await (await plain.api.item.$get()).json()
data.createdAt // string
```

Serializer clients reject JSON responses that omit negotiation headers or advertise a different output contract. Missing middleware, unavailable codecs, and CORS configuration errors fail explicitly instead of returning a value with the wrong static type. Mount the middleware on all JSON routes used by a serializer client, including JSON error handlers, and serve those routes with `s.json`.

`c.json`, `c.text`, `c.html`, and the rest of the context keep Hono's ordinary behavior. The middleware does not patch them. Routes served with `c.json` always return ordinary JSON: stock `hc` and `hc<JsonApp<typeof app>>` read them, while a serializer client fails closed on them. Use `s.json` for routes that participate in serialization.

`s.json` defaults to status **200**, even after `c.status(...)`. Pass another status explicitly; numeric and `{ status: ... }` arguments preserve the literal RPC status. `s.json` rejects contentless statuses (204, 304) at compile time.

## Request bodies

Bodies remain ordinary JSON unless `json.input` is provided. An input codec requires its own `output: 'preserve' | 'json'` contract. The client retains rich JSON argument types only for a preserving input codec; otherwise request types undergo JSON conversion.

Mount serialization **before** JSON validators. Validate the decoded values, using schemas appropriate for the input codec. Query parameters, forms, and WebSockets keep Hono's behavior.

Input and response codecs can differ. For Seroval, use its safe JSON mode on requests:

```ts
import { serialize, deserialize, toJSON, fromJSON } from 'seroval'

const seroval = defineSerializer({
  name: 'seroval',
  json: {
    output: 'preserve',
    serialize,
    parse: deserialize,
    contentType: 'application/seroval',
    input: {
      output: 'preserve',
      serialize: (value: unknown) => JSON.stringify(toJSON(value)),
      parse: (wire: string) => fromJSON(JSON.parse(wire)),
    },
  },
})
```

Never evaluate request bodies with `eval`, Seroval's `deserialize`, or a devalue `uneval` decoder. A request header is not authentication, and anyone can construct an HTTP request independently of your client.

## Wire formats

The codec serializes to a string or to bytes and parses the same shape back. A text codec returns a string, and `parse` receives a string. A binary codec must explicitly set `binary: true`, return `Uint8Array` or `ArrayBuffer`, and accept `Uint8Array` in `parse`. MIME types do not imply binary behavior.

```ts
import { encode, decode } from 'cbor-x'

const cbor = defineSerializer({
  name: 'cbor',
  json: {
    output: 'preserve',
    binary: true,
    contentType: 'application/cbor',
    serialize: encode,
    parse: decode,
  },
})
```

Binary codecs such as CBOR work through the same JSON slot: negotiation, request decoding, and client types behave identically; only the wire representation differs.

Set `contentType` to the MIME type of the wire representation. JSON-shaped strings default to `application/json`; binary codecs default to `application/octet-stream`. JavaScript-shaped output should use a private MIME type such as `application/seroval`, rather than `application/javascript`. Invalid codec output throws instead of being coerced into an empty body.

The response advertises the codec name and the JSON output contract. Decoding uses those declarations rather than guessing from Content-Type. Response clones and per-call fetch implementations retain decoding. `json`, `text`, `arrayBuffer`, and `bytes` share a cached body; `text()` on an encoded JSON response returns its raw wire text.

## Several codecs and custom headers

```ts
const s = serialization([superjson, seroval])
app.use('/api/*', s)

const jsonClient = createClient<AppType>(url, superjson)
const serovalClient = createClient<AppType>(url, seroval)
```

A helper belongs to its middleware instance. Mixing helpers from different instances throws rather than using an unrelated codec.

Configure a custom header on both ends:

```ts
const s = serialization(superjson, { header: 'x-my-serde' })
const client = createClient<AppType>(url, superjson, { header: 'x-my-serde' })
```

For CORS, allow the negotiation request header in preflight. Encoded responses expose the negotiation header and its `-output` companion. The middleware adds the configured header to `Vary` on encoded and ordinary responses while preserving existing entries.

`createClient` accepts Hono client options, including async headers and per-call fetch overrides. It always sets the negotiation header on the outgoing request. `$url`, `$path`, and `$ws` retain their Hono behavior. For private MIME types, use the wrapped `res.json()`; Hono's `parseResponse()` selects a parser by Content-Type.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run check:package
npm run check:release
```

Typechecking includes positive and negative RPC assertions and dependency declarations. Publishing runs the full release check, including typechecking, tests, ESM builds, package-boundary checks, and installed tarball tests over real HTTP.

See [CHANGELOG.md](CHANGELOG.md) for release notes.
