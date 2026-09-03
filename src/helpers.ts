import type { Context, TypedResponse } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  DEFAULT_HTML_CONTENT_TYPE,
  DEFAULT_JSON_CONTENT_TYPE,
  DEFAULT_TEXT_CONTENT_TYPE,
} from './constants'
import { getActive } from './context'
import {
  sendEncoded,
  type HeaderRecord,
  type JsonArg,
} from './send'
import type { FormatSerializer } from './types'
import { resolveSerializer } from './wire'

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

const sendSlot = (
  c: Context,
  value: unknown,
  arg: JsonArg | undefined,
  headers: HeaderRecord | undefined,
  slot: FormatSerializer,
  fallbackContentType: string | undefined,
): Response => {
  const active = getActive(c)
  if (!active) {
    throw new TypeError('serialization helper: no active serializer')
  }
  return sendEncoded(
    c,
    value,
    arg,
    headers,
    resolveSerializer(slot, fallbackContentType),
    active.header,
    active.serializer.name,
  )
}

/** Like `c.json()`, but RPC `output` stays `T` (so `Date` is not `string`). */
export const json: JsonHelper = ((
  c: Context,
  object: unknown,
  arg?: JsonArg,
  headers?: HeaderRecord,
): Response => {
  const slot = getActive(c)?.serializer.json
  if (slot) {
    return sendSlot(c, object, arg, headers, slot, DEFAULT_JSON_CONTENT_TYPE)
  }
  return c.json(object as never, arg as never, headers as never)
}) as JsonHelper

/** Like `c.text()`. Uses the serializer `text` slot when present. */
export const text: TextHelper = ((
  c: Context,
  value: string,
  arg?: JsonArg,
  headers?: HeaderRecord,
): Response => {
  const slot = getActive(c)?.serializer.text
  if (slot) {
    return sendSlot(c, value, arg, headers, slot, DEFAULT_TEXT_CONTENT_TYPE)
  }
  return c.text(value, arg as never, headers as never)
}) as TextHelper

/** Like `c.html()`. Uses the serializer `html` slot when present. */
export const html: HtmlHelper = ((
  c: Context,
  value: string | Promise<string>,
  arg?: JsonArg,
  headers?: HeaderRecord,
): Response | Promise<Response> => {
  const slot = getActive(c)?.serializer.html
  if (!slot) {
    return c.html(value as never, arg as never, headers as never)
  }
  const send = (s: string) =>
    sendSlot(c, s, arg, headers, slot, DEFAULT_HTML_CONTENT_TYPE)
  if (typeof value === 'string') {
    return send(value)
  }
  return Promise.resolve(value).then((s) => send(String(s)))
}) as HtmlHelper

/** Like `c.body()`. Uses the serializer `body` slot when present. */
export const body: BodyHelper = ((
  c: Context,
  data: unknown,
  arg?: JsonArg,
  headers?: HeaderRecord,
): Response => {
  const slot = getActive(c)?.serializer.body
  if (slot) {
    return sendSlot(c, data, arg, headers, slot, undefined)
  }
  return c.body(data as never, arg as never, headers as never)
}) as BodyHelper
