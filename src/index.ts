import type { Context, MiddlewareHandler, TypedResponse } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  BINARY_CONTENT_TYPE,
  DEFAULT_HEADER,
  DEFAULT_HTML_CONTENT_TYPE,
  DEFAULT_JSON_CONTENT_TYPE,
  DEFAULT_TEXT_CONTENT_TYPE,
  getActive,
  lookup,
  resolve,
  resolveInput,
  sendEncoded,
  setActive,
  type HeaderRecord,
} from './internal'
import type { FormatName, FormatSerializer, Serializer } from './types'

export {
  BINARY_CONTENT_TYPE,
  DEFAULT_HEADER,
  DEFAULT_HTML_CONTENT_TYPE,
  DEFAULT_JSON_CONTENT_TYPE,
  DEFAULT_TEXT_CONTENT_TYPE,
}
export type {
  FormatName,
  FormatSerializer,
  Serializer,
  WireBody,
  WireSerializer,
} from './types'
export type { JsonApp } from './types'

export function defineSerializer<const T extends Serializer>(serializer: T): T {
  if (serializer.name == null || serializer.name === '') {
    throw new TypeError('defineSerializer: name is required')
  }
  if (
    serializer.json == null &&
    serializer.text == null &&
    serializer.html == null &&
    serializer.body == null
  ) {
    throw new TypeError('defineSerializer: at least one of json, text, html, body is required')
  }
  return serializer
}

export type SerializationMiddlewareOptions = {
  /** Header that selects a serializer by `name`. @default 'x-hono-serialization' */
  header?: string
}

export type JsonHelper = {
  <T, U extends ContentfulStatusCode = ContentfulStatusCode>(
    c: Context,
    object: T,
    status?: U,
    headers?: HeaderRecord,
  ): Response & TypedResponse<T, U, 'json'>
  <T, U extends ContentfulStatusCode = ContentfulStatusCode>(
    c: Context,
    object: T,
    init?: ResponseInit,
  ): Response & TypedResponse<T, U, 'json'>
}

export type TextHelper = {
  <T extends string, U extends ContentfulStatusCode = ContentfulStatusCode>(
    c: Context,
    text: T,
    status?: U,
    headers?: HeaderRecord,
  ): Response & TypedResponse<T, U, 'text'>
  <T extends string, U extends ContentfulStatusCode = ContentfulStatusCode>(
    c: Context,
    text: T,
    init?: ResponseInit,
  ): Response & TypedResponse<T, U, 'text'>
}

export type HtmlHelper = {
  <T extends string | Promise<string>>(
    c: Context,
    html: T,
    status?: ContentfulStatusCode,
    headers?: HeaderRecord,
  ): T extends string ? Response : Promise<Response>
  <T extends string | Promise<string>>(
    c: Context,
    html: T,
    init?: ResponseInit,
  ): T extends string ? Response : Promise<Response>
}

export type BodyHelper = {
  <T extends string | ArrayBuffer | Uint8Array, U extends ContentfulStatusCode>(
    c: Context,
    data: T,
    status?: U,
    headers?: HeaderRecord,
  ): Response & TypedResponse<T, U, 'body'>
  <T extends string | ArrayBuffer | Uint8Array, U extends ContentfulStatusCode>(
    c: Context,
    data: T,
    init?: ResponseInit,
  ): Response & TypedResponse<T, U, 'body'>
}

export type SerializationMiddleware = MiddlewareHandler & {
  json: JsonHelper
  text: TextHelper
  html: HtmlHelper
  body: BodyHelper
}

const FALLBACKS: Record<FormatName, string | undefined> = {
  json: DEFAULT_JSON_CONTENT_TYPE,
  text: DEFAULT_TEXT_CONTENT_TYPE,
  html: DEFAULT_HTML_CONTENT_TYPE,
  body: undefined,
}

const sendSlot = (
  c: Context,
  format: FormatName,
  value: unknown,
  arg: unknown,
  headers: HeaderRecord | undefined,
): Response => {
  const slot = getActive(c)?.serializer[format] as FormatSerializer | undefined
  if (slot) {
    const active = getActive(c)!
    return sendEncoded(
      c,
      value,
      arg as ResponseInit | undefined,
      headers,
      resolve(slot, FALLBACKS[format]),
      active.header,
      active.serializer.name,
    )
  }
  const fallback = (c as unknown as Record<FormatName, (...a: never[]) => Response>)[format]
  return fallback.call(c, value as never, arg as never, headers as never)
}

const awaited = (value: string | Promise<string>, send: (s: string) => Response) =>
  typeof value === 'string' ? send(value) : Promise.resolve(value).then((s) => send(String(s)))

/** Like `c.json()` but RPC `output` stays `T` (so `Date` is not `string`). */
export const json: JsonHelper = ((c: Context, value: unknown, arg?: unknown, headers?: HeaderRecord) =>
  sendSlot(c, 'json', value, arg, headers)) as JsonHelper

/** Like `c.text()`. Uses the `text` slot when present. */
export const text: TextHelper = ((c: Context, value: string, arg?: unknown, headers?: HeaderRecord) =>
  sendSlot(c, 'text', value, arg, headers)) as TextHelper

/** Like `c.html()`. Uses the `html` slot when present. */
export const html: HtmlHelper = ((c: Context, value: string | Promise<string>, arg?: unknown, headers?: HeaderRecord) =>
  awaited(value, (s) => sendSlot(c, 'html', s, arg, headers))) as HtmlHelper

/** Like `c.body()`. Uses the `body` slot when present. */
export const body: BodyHelper = ((c: Context, value: unknown, arg?: unknown, headers?: HeaderRecord) =>
  sendSlot(c, 'body', value, arg, headers)) as BodyHelper

/**
 * Negotiate a serializer from the request header and patch the Hono helpers
 * that have a matching slot. Omitted slots stay on Hono defaults.
 * No header / unknown name → no patching (curl, stock `hc`).
 */
export function serialization(
  serializers: Serializer | readonly Serializer[],
  options?: SerializationMiddlewareOptions,
): SerializationMiddleware {
  const byName = lookup(serializers)
  const header = options?.header ?? DEFAULT_HEADER

  const middleware = createMiddleware(async (c, next) => {
    const name = c.req.header(header)?.trim() || undefined
    const active = name != null ? byName.get(name) : undefined
    if (!active) {
      await next()
      return
    }
    setActive(c, { serializer: active, header })

    for (const format of Object.keys(FALLBACKS) as FormatName[]) {
      const slot = active[format]
      if (!slot) continue
      const resolved = resolve(slot, FALLBACKS[format])
      if (format === 'html') {
        c.html = ((v: string | Promise<string>, arg?: never, headers?: never) =>
          awaited(v, (s) => sendEncoded(c, s, arg, headers, resolved, header, active.name))) as never
      } else if (format === 'json') {
        c.json = ((v: unknown, arg?: never, headers?: never) =>
          sendEncoded(c, v, arg, headers, resolved, header, active.name)) as never
      } else if (format === 'text') {
        c.text = ((v: unknown, arg?: never, headers?: never) =>
          sendEncoded(c, v, arg, headers, resolved, header, active.name)) as never
      } else {
        c.body = ((v: unknown, arg?: never, headers?: never) =>
          sendEncoded(c, v, arg, headers, resolved, header, active.name)) as never
      }
    }

    const input = resolveInput(active.json)
    if (input) {
      c.req.json = (async () => {
        const data = input.binary
          ? new Uint8Array(await c.req.arrayBuffer())
          : await c.req.text()
        return input.parse(data)
      }) as typeof c.req.json
    }

    await next()
  })

  return Object.assign(middleware, { json, text, html, body })
}
