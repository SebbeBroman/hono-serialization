import type { Hono } from 'hono'
import { hc } from 'hono/client'
import type { ClientRequestOptions } from 'hono/client'
import { DEFAULT_HEADER } from './constants'
import { defineSerializer } from './define'
import type { FormatSerializer, Serializer, WireBody } from './types'
import {
  isHtmlContentType,
  isJsonContentType,
  isTextualContentType,
  resolveInput,
  resolveSerializer,
  toUint8Array,
} from './wire'

export { defineSerializer }
export type { Serializer } from './types'

type AnyClient = Record<string | symbol, unknown>

const wrapResponse = (
  res: Response,
  serializer: Serializer,
  header: string,
): Response => {
  let bufferPromise: Promise<ArrayBuffer> | undefined
  const getBuffer = () => (bufferPromise ??= res.arrayBuffer())
  const getText = async () => new TextDecoder().decode(await getBuffer())

  const echoed = () => res.headers.get(header)
  const matched = () => echoed() === serializer.name

  const parseWith = async (
    slot: FormatSerializer,
    fallbackContentType: string | undefined,
  ) => {
    const resolved = resolveSerializer(slot, fallbackContentType)
    const ct = res.headers.get('content-type') ?? ''
    const binary = resolved.binary || !isTextualContentType(ct)
    if (binary) {
      return resolved.parse(toUint8Array(await getBuffer()))
    }
    return resolved.parse(await getText())
  }

  return new Proxy(res, {
    get(target, prop) {
      if (prop === 'json') {
        return async () => {
          if (!matched() || serializer.json == null) {
            return JSON.parse(await getText())
          }
          return parseWith(serializer.json, undefined)
        }
      }
      if (prop === 'text') {
        return async () => {
          const raw = await getText()
          if (!matched()) {
            return raw
          }
          const ct = target.headers.get('content-type') ?? ''
          if (isJsonContentType(ct)) {
            return raw
          }
          if (serializer.html != null && isHtmlContentType(ct)) {
            return String(await parseWith(serializer.html, undefined))
          }
          if (serializer.text != null) {
            return String(await parseWith(serializer.text, undefined))
          }
          return raw
        }
      }
      if (prop === 'arrayBuffer') {
        return () => getBuffer()
      }
      const value = Reflect.get(target, prop, target)
      if (typeof value === 'function') {
        return value.bind(target)
      }
      return value
    },
  })
}

const mergeClientHeaders = (
  base: ClientRequestOptions['headers'],
  extra: Record<string, string>,
): ClientRequestOptions['headers'] => {
  if (!base) {
    return extra
  }
  return async () => ({
    ...(typeof base === 'function' ? await base() : base),
    ...extra,
  })
}

const contentTypeFor = (body: WireBody, fallback: string | undefined): string =>
  fallback ??
  (typeof body === 'string' ? 'application/json' : 'application/octet-stream')

const wrapClient = (client: AnyClient, serializer: Serializer): AnyClient => {
  const input = resolveInput(serializer.json)
  if (!input) {
    return client
  }

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'then' || typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver)
      }
      const value = Reflect.get(target, prop, receiver)
      if (value == null) {
        return value
      }
      const name = String(prop)
      if (name === '$url' || name === '$path' || name === '$ws') {
        return value
      }
      if (typeof value === 'function' || typeof value === 'object') {
        return wrapClient(value as AnyClient, serializer)
      }
      return value
    },
    apply(target, _thisArg, argArray) {
      const args = argArray[0] as { json?: unknown } | undefined
      const requestOpts = (argArray[1] ?? {}) as ClientRequestOptions

      if (args?.json === undefined) {
        return Reflect.apply(
          target as unknown as (...a: never[]) => unknown,
          undefined,
          [args, requestOpts],
        )
      }

      const { json, ...rest } = args
      const body = input.serialize(json as never)
      const contentType = contentTypeFor(body, input.contentType)

      const requestHeaders = requestOpts.headers
      const withContentType =
        typeof requestHeaders === 'function'
          ? async () => ({
              ...(await requestHeaders()),
              'Content-Type': contentType,
            })
          : { ...requestHeaders, 'Content-Type': contentType }

      return Reflect.apply(
        target as unknown as (...a: never[]) => unknown,
        undefined,
        [
          rest,
          {
            ...requestOpts,
            headers: withContentType,
            init: {
              ...requestOpts.init,
              body: body as BodyInit,
            },
          },
        ],
      )
    },
  })
}

export type CreateClientOptions = ClientRequestOptions & {
  /**
   * Request/response header that carries the serializer `name`.
   * @default 'x-hono-serialization'
   */
  header?: string
}

/**
 * Hono `hc` wrapper that sends this serializer’s name and decodes with its
 * slots. Import only the serializer this page needs — unused serializer
 * modules are tree-shaken.
 *
 * Formats omitted on the serializer fall back to `JSON.parse` / raw text.
 */
export const createClient = <T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: Serializer,
  options?: CreateClientOptions,
): ReturnType<typeof hc<T, Prefix>> => {
  const { header: headerName, ...rest } = options ?? {}
  const header = headerName ?? DEFAULT_HEADER

  const fetchImpl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const res = await (rest.fetch ?? globalThis.fetch)(
      input as never,
      init as never,
    )
    return wrapResponse(res, serializer, header)
  }) as NonNullable<ClientRequestOptions['fetch']>

  const raw = hc<T, Prefix>(baseUrl, {
    ...rest,
    headers: mergeClientHeaders(rest.headers, {
      [header]: serializer.name,
    }),
    fetch: fetchImpl,
  })

  return wrapClient(raw as unknown as AnyClient, serializer) as typeof raw
}
