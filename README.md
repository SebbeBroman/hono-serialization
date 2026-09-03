# hono-serialization

Opt-in serialize/deserialize for [Hono](https://hono.dev) RPC. You bring the serializer (`superjson`, `seroval`, `devalue`, …). The library never ships one.

A client sends `x-hono-serialization: <name>`. Matching helpers (`json` / `text` / `html` / `body`) then run that serializer. No header → ordinary Hono output, so curl, browsers, and stock `hc` keep working.

## Install

```bash
npm install hono-serialization
```

Peer: `hono` ^4.

## Quick start

```ts
import SuperJSON from 'superjson'
import { Hono } from 'hono'
import { defineSerializer, serialization } from 'hono-serialization'
import { createClient } from 'hono-serialization/client'

export const superjson = defineSerializer({
  name: 'superjson',
  json: {
    serialize: SuperJSON.stringify,
    parse: SuperJSON.parse,
    input: {
      serialize: SuperJSON.stringify,
      parse: SuperJSON.parse,
    },
  },
})

const t = serialization(superjson)

const app = new Hono()
  .use('/api/*', t)
  .get('/api/item', (c) => t.json(c, { createdAt: new Date() }))

export type AppType = typeof app

const client = createClient<AppType>('http://localhost', superjson)
const data = await (await client.api.item.$get()).json()
data.createdAt // Date
```

`t` is the middleware. `t.json` / `t.text` / `t.html` / `t.body` match `c.json` and friends. Use `t.json` when RPC types should keep `Date` / `Map` / `Set` — Hono’s `c.json` types them as `JSONParsed` (`Date` → `string`). `c.json` still encodes at runtime when `t` is mounted.

Put each serializer in its own file. The client is a separate entry (`hono-serialization/client`): import only the serializer that page uses.

## Serializers

Each of `json`, `text`, `html`, `body` is optional. Omit a slot to keep Hono’s default for that helper.

`serialize` / `parse` are the **response**. Request bodies stay vanilla JSON unless `input` is set to its own pair (it can differ from output).

```ts
type WireSerializer = {
  serialize: (value: unknown) => string | Uint8Array | ArrayBuffer
  parse: (data: string | Uint8Array) => unknown
  binary?: boolean
  contentType?: string
}

type Serializer = {
  name: string // header value
  json?: WireSerializer & { input?: WireSerializer }
  text?: WireSerializer
  html?: WireSerializer
  body?: WireSerializer
}
```

`contentType` is the `Content-Type` of the **bytes**. JSON-shaped serializers (SuperJSON, `devalue.stringify`) can omit it (`application/json`). JS-shaped serializers (`seroval.serialize`, `uneval`) should set a private type such as `application/seroval` — not `application/javascript`.

```ts
import { serialize, deserialize } from 'seroval'

export const seroval = defineSerializer({
  name: 'seroval',
  json: {
    serialize,
    parse: deserialize,
    contentType: 'application/seroval',
  },
})
```

Same handler, rewritten wire:

```http
Content-Type: application/seroval
x-hono-serialization: seroval
```

`serialize` must return a string (or bytes if `binary: true`). Do not return a JSON object — that double-encodes uneval/seroval.

| Library | Response | Request (`input`) |
|---|---|---|
| JSON | `JSON.stringify` / `JSON.parse` | same |
| superjson | `SuperJSON.stringify` / `.parse` | same |
| devalue | `stringify` / `parse` | same |
| seroval | `serialize` / `deserialize` | `toJSON` / `fromJSON`, or another safe pair |
| devalue uneval | `uneval` / eval | **not** uneval — use superjson or devalue `stringify` |

Never use an eval-based serializer as `input` unless you fully control the client.

## Several serializers

The server can mount many; the client still takes **one**.

```ts
const t = serialization([superjson, seroval])
app.use('/api/*', t)

const jsonClient = createClient<AppType>(url, superjson)
const serovalClient = createClient<AppType>(url, seroval)
```

Mount `t` only on routes that should participate, and **before** validators if `input` is set (`zValidator('json', z.object({ createdAt: z.date() }))`).

## Header

Default: `x-hono-serialization` = `serializer.name`. Unknown names are ignored (no echo). Override with `serialization(superjson, { header: 'x-my-serde' })` and the same `header` on `createClient`.

CORS: allow that header on preflight (`cors()`). The middleware appends it to `Access-Control-Expose-Headers` on encoded responses.

## Types

| Handler | `hc<typeof app>` | `createClient(..., superjson)` | `hc<JsonApp<typeof app>>` |
|---|---|---|---|
| `c.json({ d: new Date() })` | `d: string` | `d: string` (runtime `Date` if header) | `d: string` |
| `t.json(c, { d: new Date() })` | `d: Date` (lie if no header) | `d: Date` | `d: string` |

- Serializer RPC: `t.json` + `createClient`
- Plain JSON: `c.json` + `hc`
- Dual-mode (`t.json` server, vanilla client): `hc<JsonApp<typeof app>>`

`createClient` wraps `hc` (`$url` / `$path` still work). If `contentType` is not JSON, use the wrapped `res.json()` — Hono’s `parseResponse()` keys off Content-Type.

## API

```ts
defineSerializer({ name, json?, text?, html?, body? })

const t = serialization(superjson)
const t = serialization([superjson, seroval], { header?: string })

t.json(c, data, status?)
t.text(c, text, status?)
t.html(c, html, status?)
t.body(c, data, status?)

createClient<AppType>(url, superjson, { header?, ...hcOptions })
```
