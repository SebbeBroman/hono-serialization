import type { Hono } from 'hono'
import { hc } from 'hono/client'
import type { ClientRequestOptions } from 'hono/client'
import {
  DEFAULT_HEADER,
  isHtmlCt,
  isJsonCt,
  isTextualCt,
  resolve,
  resolveInput,
  toBytes,
} from './internal'
import { defineSerializer } from './index'
import type { FormatSerializer, Serializer } from './types'

export { defineSerializer }
export type { Serializer } from './types'

type AnyClient = Record<string | symbol, unknown>

const decode = async (res: Response, slot: FormatSerializer, text: () => Promise<string>, buf: () => Promise<ArrayBuffer>) => {
  const r = resolve(slot, undefined)
  const ct = res.headers.get('content-type') ?? ''
  return r.binary || !isTextualCt(ct) ? r.parse(toBytes(await buf())) : r.parse(await text())
}

const wrapResponse = (res: Response, serializer: Serializer, header: string): Response => {
  let buf: Promise<ArrayBuffer> | undefined
  const getBuf = () => (buf ??= res.arrayBuffer())
  const getText = async () => new TextDecoder().decode(await getBuf())
  const matched = () => res.headers.get(header) === serializer.name

  return new Proxy(res, {
    get(target, prop) {
      if (prop === 'arrayBuffer') return getBuf
      if (prop === 'json') {
        return async () =>
          matched() && serializer.json
            ? decode(res, serializer.json, getText, getBuf)
            : JSON.parse(await getText())
      }
      if (prop === 'text') {
        return async () => {
          const raw = await getText()
          if (!matched()) return raw
          const ct = target.headers.get('content-type') ?? ''
          if (isJsonCt(ct)) return raw
          if (serializer.html && isHtmlCt(ct)) return String(await decode(res, serializer.html, getText, getBuf))
          if (serializer.text) return String(await decode(res, serializer.text, getText, getBuf))
          return raw
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const wrapClient = (client: AnyClient, input: NonNullable<ReturnType<typeof resolveInput>>): AnyClient =>
  new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'then' || typeof prop === 'symbol') return Reflect.get(target, prop, receiver)
      const value = Reflect.get(target, prop, receiver)
      if (value == null) return value
      const name = String(prop)
      if (name === '$url' || name === '$path' || name === '$ws') return value
      return typeof value === 'function' || typeof value === 'object'
        ? wrapClient(value as AnyClient, input)
        : value
    },
    apply(target, _thisArg, argArray) {
      const args = argArray[0] as { json?: unknown } | undefined
      const opts = (argArray[1] ?? {}) as ClientRequestOptions
      if (args?.json === undefined) {
        return Reflect.apply(target as unknown as (...a: never[]) => unknown, undefined, [args, opts])
      }
      const { json, ...rest } = args
      const body = input.serialize(json)
      const contentType = input.contentType ?? (typeof body === 'string' ? 'application/json' : 'application/octet-stream')
      const requestHeaders = opts.headers
      const headers =
        typeof requestHeaders === 'function'
          ? async () => ({ ...(await (requestHeaders as () => Promise<Record<string, string>>)()), 'Content-Type': contentType })
          : { ...requestHeaders, 'Content-Type': contentType }
      return Reflect.apply(target as unknown as (...a: never[]) => unknown, undefined, [
        rest,
        { ...opts, headers, init: { ...opts.init, body: body as BodyInit } },
      ])
    },
  })

export type CreateClientOptions = ClientRequestOptions & {
  /** Header carrying the serializer `name`. @default 'x-hono-serialization' */
  header?: string
}

/**
 * Hono `hc` wrapper that sends this serializer's name and decodes with its
 * slots. Import only the serializer this page needs.
 * Formats omitted on the serializer fall back to `JSON.parse` / raw text.
 */
export const createClient = <T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: Serializer,
  options?: CreateClientOptions,
): ReturnType<typeof hc<T, Prefix>> => {
  const { header: headerName, ...rest } = options ?? {}
  const header = headerName ?? DEFAULT_HEADER

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await (rest.fetch ?? globalThis.fetch)(input as never, init as never)
    return wrapResponse(res, serializer, header)
  }) as NonNullable<ClientRequestOptions['fetch']>

  const baseHeaders = rest.headers
  const headers = !baseHeaders
    ? { [header]: serializer.name }
    : async () => ({ ...(typeof baseHeaders === 'function' ? await baseHeaders() : baseHeaders), [header]: serializer.name })

  const raw = hc<T, Prefix>(baseUrl, { ...rest, headers, fetch: fetchImpl })
  const input = resolveInput(serializer.json)
  return (input ? wrapClient(raw as unknown as AnyClient, input) : raw) as typeof raw
}
