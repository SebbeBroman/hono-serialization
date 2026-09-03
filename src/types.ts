import type { Hono, Schema } from 'hono'
import type { JSONParsed } from 'hono/utils/types'

/** Body produced by `serialize`. Binary serializers return bytes. */
export type WireBody = string | ArrayBuffer | Uint8Array

/**
 * Text serializers receive a string; binary serializers receive a `Uint8Array`.
 * Bivariant so `SuperJSON.parse` (string-only) still assigns.
 */
type BivariantParse = {
  bivarianceHack(data: string | Uint8Array): unknown
}['bivarianceHack']

type BivariantSerialize = {
  bivarianceHack(value: never): WireBody
}['bivarianceHack']

/** One direction: value ↔ wire. */
export type WireSerializer = {
  serialize: BivariantSerialize
  parse: BivariantParse
  /**
   * If true, bodies are `Uint8Array`/`ArrayBuffer` and `parse` receives bytes.
   * Also implied when `serialize` returns bytes or `contentType` is octet-stream.
   */
  binary?: boolean
  /**
   * Content-Type for this direction.
   * Defaults: json → application/json, text → text/plain, html → text/html,
   * body → octet-stream when binary.
   */
  contentType?: string
}

/**
 * Serializer for one Hono response helper (`c.json`, `c.text`, `c.html`, `c.body`).
 *
 * `serialize` / `parse` are the response (output) direction.
 * `input` is the request-body direction; omit it to leave bodies as vanilla JSON.
 */
export type FormatSerializer = WireSerializer & {
  input?: WireSerializer
}

/**
 * A named serializer. Each of `json` / `text` / `html` / `body` is optional;
 * omitting a slot leaves that Hono helper on its default (`JSON.stringify`,
 * plain text, etc.).
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
  ? {
      [K in keyof I]: K extends 'json' ? JSONParsed<I[K]> : I[K]
    }
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

type JsonSchema<S> = {
  [P in keyof S]: {
    [M in keyof S[P]]: JsonEndpoint<S[P][M]>
  }
}

/**
 * Maps a Hono app type so JSON RPC outputs (and `input.json`) go through
 * `JSONParsed` — what stock `hc` would see after `JSON.stringify`.
 *
 * Use with `hc<JsonApp<typeof app>>` when the server uses `t.json()` but the
 * client is speaking vanilla JSON (no serialization header).
 */
export type JsonApp<T> = T extends Hono<infer E, infer S, infer BasePath>
  ? JsonSchema<S> extends Schema
    ? Hono<E, JsonSchema<S>, BasePath>
    : T
  : T
