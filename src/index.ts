import type { Context, MiddlewareHandler, TypedResponse } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  BINARY_CONTENT_TYPE,
  DEFAULT_HEADER,
  DEFAULT_HTML_CONTENT_TYPE,
  DEFAULT_JSON_CONTENT_TYPE,
  DEFAULT_TEXT_CONTENT_TYPE,
  appendHeader,
  formatHeader,
  outputHeader,
  getActive,
  lookup,
  resolve,
  resolveInput,
  sendEncoded,
  setActive,
  validateHeader,
  type HeaderRecord,
  type ResponseOptions,
} from './internal'
import type {
  FormatName,
  HelperOutput,
  Serializer,
  SerializerList,
  SerializerOf,
  WireBody,
} from './types'

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
  JsonApp,
  OutputMode,
} from './types'
export type { ResponseOptions } from './internal'

export { defineSerializer } from './codec'
export type SerializationMiddlewareOptions = { header?: string }
export type JsonHelper<S extends Serializer = Serializer> = {
  <T, U extends ContentfulStatusCode = 200>(
    c: Context,
    object: T,
    status?: U,
    headers?: HeaderRecord,
  ): Response & TypedResponse<HelperOutput<T, S>, U, 'json'>
  <T, U extends ContentfulStatusCode = 200>(
    c: Context,
    object: T,
    init: ResponseOptions<U>,
  ): Response & TypedResponse<HelperOutput<T, S>, U, 'json'>
}
export type TextHelper = {
  <T extends string, U extends ContentfulStatusCode = 200>(
    c: Context,
    text: T,
    status?: U,
    headers?: HeaderRecord,
  ): Response & TypedResponse<string, U, 'text'>
  <T extends string, U extends ContentfulStatusCode = 200>(
    c: Context,
    text: T,
    init: ResponseOptions<U>,
  ): Response & TypedResponse<string, U, 'text'>
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
    init: ResponseOptions,
  ): T extends string ? Response : Promise<Response>
}
export type BodyHelper = {
  <T extends WireBody, U extends ContentfulStatusCode = 200>(
    c: Context,
    data: T,
    status?: U,
    headers?: HeaderRecord,
  ): Response & TypedResponse<unknown, U, 'body'>
  <T extends WireBody, U extends ContentfulStatusCode = 200>(
    c: Context,
    data: T,
    init: ResponseOptions<U>,
  ): Response & TypedResponse<unknown, U, 'body'>
}
export type SerializationMiddleware<S extends Serializer = Serializer> =
  MiddlewareHandler & {
    json: JsonHelper<S>
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
const awaited = (
  value: string | Promise<string>,
  send: (s: string) => Response,
) =>
  typeof value === 'string' ? send(value) : Promise.resolve(value).then(send)

export function serialization<const S extends SerializerList>(
  serializers: S,
  options?: SerializationMiddlewareOptions,
): SerializationMiddleware<SerializerOf<S> & Serializer> {
  const byName = lookup(serializers)
  const header = options?.header ?? DEFAULT_HEADER
  validateHeader(header)
  const middleware = createMiddleware(async (c, next) => {
    const name = c.req.header(header)?.trim()
    const active = name ? byName.get(name) : undefined
    if (active) {
      setActive(c, { serializer: active, header })
      for (const format of Object.keys(FALLBACKS) as FormatName[]) {
        const slot = active[format]
        if (!slot) continue
        const resolved = resolve(slot, FALLBACKS[format])
        const send = (
          v: unknown,
          arg?: ContentfulStatusCode | ResponseOptions,
          headers?: HeaderRecord,
        ) => sendEncoded(c, v, arg, headers, resolved, header, active, format)
        if (format === 'html') {
          c.html = ((
            v: string | Promise<string>,
            arg?: ContentfulStatusCode | ResponseOptions,
            headers?: HeaderRecord,
          ) => awaited(v, (s) => send(s, arg, headers))) as Context['html']
        } else if (format === 'json') {
          // c.json's public Hono type promises JSONParsed, so normalize before encoding.
          c.json = ((
            v: unknown,
            arg?: ContentfulStatusCode | ResponseOptions,
            headers?: HeaderRecord,
          ) =>
            send(
              JSON.parse(JSON.stringify(v)),
              arg,
              headers,
            )) as Context['json']
        } else {
          c[format] = send as Context['text'] & Context['body']
        }
      }
      const input = resolveInput(active.json)
      if (input) {
        let parsed: Promise<unknown> | undefined
        c.req.json = (() =>
          (parsed ??= (async () => {
            const data = input.binary
              ? new Uint8Array(await c.req.arrayBuffer())
              : await c.req.text()
            return input.parse(data as never)
          })())) as Context['req']['json']
      }
    }
    await next()
    const responseHeaders = new Headers(c.res.headers)
    appendHeader(responseHeaders, 'Vary', header)
    c.header('Vary', responseHeaders.get('Vary')!)
    if (c.res.headers.get(header)) {
      for (const name of [header, formatHeader(header), outputHeader(header)]) {
        appendHeader(responseHeaders, 'Access-Control-Expose-Headers', name)
      }
      c.header(
        'Access-Control-Expose-Headers',
        responseHeaders.get('Access-Control-Expose-Headers')!,
      )
    }
  })
  const send = (
    c: Context,
    format: FormatName,
    value: unknown,
    arg?: ContentfulStatusCode | ResponseOptions,
    headers?: HeaderRecord,
  ) => {
    const active = getActive(c)
    if (
      active &&
      (active.header !== header ||
        byName.get(active.serializer.name) !== active.serializer)
    ) {
      throw new TypeError(
        'serialization helper used with a different middleware instance',
      )
    }
    // A helper's status must agree with its RPC type, even after c.status().
    const init =
      typeof arg === 'object'
        ? { ...arg, status: arg.status ?? 200 }
        : (arg ?? 200)
    const slot = active?.serializer[format]
    if (slot && active)
      return sendEncoded(
        c,
        value,
        init,
        headers,
        resolve(slot, FALLBACKS[format]),
        header,
        active.serializer,
        format,
      )
    const fallback = c[format] as (
      value: never,
      arg: never,
      headers?: HeaderRecord,
    ) => Response
    return fallback(value as never, init as never, headers)
  }
  return Object.assign(middleware, {
    json: ((c, value, arg, headers) =>
      send(c, 'json', value, arg, headers)) as JsonHelper<
      SerializerOf<S> & Serializer
    >,
    text: ((c, value, arg, headers) =>
      send(c, 'text', value, arg, headers)) as TextHelper,
    html: ((c, value, arg, headers) =>
      awaited(value, (s) => send(c, 'html', s, arg, headers))) as HtmlHelper,
    body: ((c, value, arg, headers) =>
      send(c, 'body', value, arg, headers)) as BodyHelper,
  })
}
