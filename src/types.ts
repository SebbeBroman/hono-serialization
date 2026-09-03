import type { Hono, Schema } from 'hono'
import type { JSONParsed } from 'hono/utils/types'

/** Body produced by `serialize`. Binary serializers return bytes. */
export type WireBody = string | ArrayBuffer | Uint8Array

/** One direction: value ↔ wire. */
export type WireSerializer = {
  serialize: (value: any) => WireBody
  parse: (data: any) => unknown
  /**
   * If true, bodies are `Uint8Array`/`ArrayBuffer` and `parse` receives bytes.
   * Also implied when `contentType` looks binary (octet-stream/cbor/msgpack).
   */
  binary?: boolean
  /** Content-Type for this direction (json → application/json, etc.). */
  contentType?: string
}

/**
 * Serializer for one Hono response helper (`c.json`, `c.text`, …).
 * `serialize` / `parse` are the response; `input` is the request body
 * (omit it to leave bodies as vanilla JSON).
 */
export type FormatSerializer = WireSerializer & {
  input?: WireSerializer
}

/**
 * A named serializer. Each of `json` / `text` / `html` / `body` is optional;
 * omitting a slot leaves that Hono helper on its default.
 */
export type Serializer<Name extends string = string> = {
  name: Name
  json?: FormatSerializer
  text?: FormatSerializer
  html?: FormatSerializer
  body?: FormatSerializer
}

export type FormatName = keyof Omit<Serializer, 'name'>

type JsonInput<I> = I extends object
  ? { [K in keyof I]: K extends 'json' ? JSONParsed<I[K]> : I[K] }
  : I

type JsonEndpoint<E> = E extends {
  input: infer I
  output: infer O
  outputFormat: infer F
  status: infer St
}
  ? [unknown] extends [F]
    ? E
    : {
        input: JsonInput<I>
        output: F extends 'json' ? JSONParsed<O> : O
        outputFormat: F
        status: St
      }
  : E

/**
 * Maps an app type so JSON RPC outputs (and `input.json`) go through
 * `JSONParsed` — what stock `hc` sees after `JSON.stringify`.
 * Use with `hc<JsonApp<typeof app>>` for header-less clients.
 */
export type JsonApp<T> = T extends Hono<infer E, infer S, infer BasePath>
  ? JsonSchema<S> extends Schema
    ? Hono<E, JsonSchema<S>, BasePath>
    : T
  : T

type JsonSchema<S> = {
  [P in keyof S]: { [M in keyof S[P]]: JsonEndpoint<S[P][M]> }
}
