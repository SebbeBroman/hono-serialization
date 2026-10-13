import type { Context, MiddlewareHandler, TypedResponse } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  BINARY_CONTENT_TYPE,
  DEFAULT_HEADER,
  DEFAULT_JSON_CONTENT_TYPE,
  appendHeader,
  getActive,
  lookup,
  outputHeader,
  resolve,
  resolveInput,
  sendEncoded,
  setActive,
  validateHeader,
  type HeaderRecord,
  type ResponseOptions,
} from './internal'
import type {
  SerializedOutput,
  Serializer,
  SerializerList,
  SerializerOf,
} from './types'

export { BINARY_CONTENT_TYPE, DEFAULT_HEADER, DEFAULT_JSON_CONTENT_TYPE }
export type {
  JsonApp,
  JsonSerializer,
  OutputMode,
  Serializer,
  WireBody,
  WireSerializer,
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
  ): Response & TypedResponse<SerializedOutput<T, S>, U, 'json'>
  <T, U extends ContentfulStatusCode = 200>(
    c: Context,
    object: T,
    init: ResponseOptions<U>,
  ): Response & TypedResponse<SerializedOutput<T, S>, U, 'json'>
}
export type SerializationMiddleware<S extends Serializer = Serializer> =
  MiddlewareHandler & { json: JsonHelper<S> }

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
      for (const name of [header, outputHeader(header)]) {
        appendHeader(responseHeaders, 'Access-Control-Expose-Headers', name)
      }
      c.header(
        'Access-Control-Expose-Headers',
        responseHeaders.get('Access-Control-Expose-Headers')!,
      )
    }
  })
  const json = (
    c: Context,
    value: unknown,
    arg?: ContentfulStatusCode | ResponseOptions,
    headers?: HeaderRecord,
  ): Response => {
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
    if (active) {
      return sendEncoded(
        c,
        value,
        init,
        headers,
        resolve(active.serializer.json),
        header,
        active.serializer,
      )
    }
    // Unnegotiated requests keep Hono's ordinary JSON response.
    return typeof init === 'object'
      ? c.json(value as never, init)
      : c.json(value as never, init, headers)
  }
  return Object.assign(middleware, {
    json: json as JsonHelper<SerializerOf<S> & Serializer>,
  })
}
