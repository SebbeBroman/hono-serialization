import type { Hono, Schema } from 'hono'
import type { JSONParsed } from 'hono/utils/types'

export type WireBody = string | ArrayBuffer | Uint8Array
export type OutputMode = 'preserve' | 'json' | 'unknown'

/** The discriminant makes the bytes passed to parse explicit. */
export type WireSerializer<Value = unknown, Parsed = unknown> = (
  | {
      binary?: false
      serialize: (value: Value) => string
      parse: (data: string) => Parsed
    }
  | {
      binary: true
      serialize: (value: Value) => Uint8Array | ArrayBuffer
      parse: (data: Uint8Array) => Parsed
    }
) & { contentType?: string }

export type JsonSerializer<Value = unknown> = WireSerializer<Value> & {
  input?: WireSerializer & { output: 'preserve' | 'json' }
  /** Contract for JSON RPC output. Omitted means unknown; preserve is a lossless-codec promise. */
  output?: OutputMode
}

export type Serializer<Name extends string = string> = {
  name: Name
  json: JsonSerializer
}
export type SerializerList = Serializer | readonly Serializer[]
export type SerializerOf<S extends SerializerList> =
  S extends readonly Serializer[] ? S[number] : S

// An opaque endpoint output: stock hc cannot mistake a negotiated payload for plain JSON.
declare const serialized: unique symbol
export type SerializedOutput<T, S extends Serializer = Serializer> = {
  readonly [serialized]: { value: T; serializer: S }
}
type JsonInput<I> = I extends object
  ? { [K in keyof I]: K extends 'json' ? JSONParsed<I[K]> : I[K] }
  : I

type DecodeOutput<O, Mode extends OutputMode> =
  O extends SerializedOutput<infer T>
    ? Mode extends 'preserve'
      ? T
      : Mode extends 'json'
        ? JSONParsed<T>
        : unknown
    : O

type Endpoint<E, Mode extends OutputMode, Plain extends boolean> = E extends {
  input: infer I
  output: infer O
  outputFormat: infer F
  status: infer St
}
  ? {
      input: Plain extends true ? JsonInput<I> : I
      output: F extends 'json' ? DecodeOutput<O, Mode> : O
      outputFormat: F
      status: St
    }
  : E

type MapSchema<S, Mode extends OutputMode, Plain extends boolean> = {
  [P in keyof S]: { [M in keyof S[P]]: Endpoint<S[P][M], Mode, Plain> }
}
export type ClientApp<
  T,
  Mode extends OutputMode,
  RichInput extends boolean = false,
> =
  T extends Hono<infer E, infer S, infer P>
    ? MapSchema<
        S,
        Mode,
        RichInput extends true ? false : true
      > extends infer M extends Schema
      ? Hono<E, M, P>
      : never
    : never
/** A plain JSON client converts both request and response JSON values. */
export type JsonApp<T> =
  T extends Hono<infer E, infer S, infer P>
    ? MapSchema<S, 'json', true> extends infer M extends Schema
      ? Hono<E, M, P>
      : never
    : never

type EndpointSerializer<E> = E extends { output: infer O }
  ? O extends SerializedOutput<unknown, infer S>
    ? S
    : never
  : never
type SchemaSerializers<S> = {
  [P in keyof S]: { [M in keyof S[P]]: EndpointSerializer<S[P][M]> }[keyof S[P]]
}[keyof S]
/** Restrict clients to serializer definitions carried by the app's typed helpers. */
export type AppSerializer<T> =
  T extends Hono<infer _E, infer S, infer _P>
    ? [SchemaSerializers<S>] extends [never]
      ? Serializer
      : SchemaSerializers<S>
    : never
