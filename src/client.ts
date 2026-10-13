import type { Hono } from 'hono'
import { hc } from 'hono/client'
import type { ClientRequestOptions } from 'hono/client'
import {
  DEFAULT_HEADER,
  encode,
  typesHeader,
  resolve,
  resolveInput,
  validateHeader,
} from './wire'
import { validateSerializer } from './validation'
import type {
  AppSerializer,
  ClientApp,
  CodecTypes,
  Serializer,
  WireSerializer,
} from './types'
export type { Serializer } from './types'

type AnyClient = object
const wrapResponse = (
  res: Response,
  serializer: Serializer,
  header: string,
): Response => {
  let buf: Promise<ArrayBuffer> | undefined
  const getBuf = () => (buf ??= res.arrayBuffer())
  const getText = async () => new TextDecoder().decode(await getBuf())
  return new Proxy(res, {
    get(target, prop) {
      if (prop === 'clone')
        return () => wrapResponse(target.clone(), serializer, header)
      if (prop === 'arrayBuffer') return getBuf
      if (prop === 'bytes') return async () => new Uint8Array(await getBuf())
      if (prop === 'json')
        return async () => {
          if (res.headers.get(header) !== serializer.name) {
            throw new TypeError(
              'JSON response did not negotiate the requested serializer; use s.json on the server and check middleware/CORS',
            )
          }
          if (
            res.headers.get(typesHeader(header)) !==
            (serializer.json.types ?? 'preserve')
          ) {
            throw new TypeError('server and client codec types differ')
          }
          const slot = resolve(serializer.json)
          const data = slot.binary
            ? new Uint8Array(await getBuf())
            : await getText()
          return slot.parse(data as never)
        }
      if (prop === 'text') return getText
      const value: unknown = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export type CreateClientOptions = ClientRequestOptions & { header?: string }
type Preserving = Serializer & { json: { types?: 'preserve' } }
type Converting = Serializer & { json: { types: 'json-parsed' } }
type Unknown = Serializer & { json: { types: 'unknown' } }
type WithInput = Serializer & {
  json: { input: WireSerializer & { types?: 'preserve' } }
}
type HonoClient<T extends Hono, Prefix extends string> = ReturnType<
  typeof hc<T, Prefix>
>
export type SerializerClient<
  T extends Hono,
  Types extends CodecTypes,
  Prefix extends string = string,
  RichInput extends boolean = false,
> = HonoClient<ClientApp<T, Types, RichInput>, Prefix>
export function createClient<T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: Preserving & WithInput & AppSerializer<T>,
  options?: CreateClientOptions,
): SerializerClient<T, 'preserve', Prefix, true>
export function createClient<T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: Preserving & AppSerializer<T>,
  options?: CreateClientOptions,
): SerializerClient<T, 'preserve', Prefix>
export function createClient<T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: Converting & WithInput & AppSerializer<T>,
  options?: CreateClientOptions,
): SerializerClient<T, 'json-parsed', Prefix, true>
export function createClient<T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: Converting & AppSerializer<T>,
  options?: CreateClientOptions,
): SerializerClient<T, 'json-parsed', Prefix>
export function createClient<T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: Unknown & WithInput & AppSerializer<T>,
  options?: CreateClientOptions,
): SerializerClient<T, 'unknown', Prefix, true>
export function createClient<T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: Unknown & AppSerializer<T>,
  options?: CreateClientOptions,
): SerializerClient<T, 'unknown', Prefix>
export function createClient<T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: Serializer & AppSerializer<T>,
  options?: CreateClientOptions,
): SerializerClient<T, 'unknown', Prefix>
export function createClient(
  baseUrl: string,
  serializer: Serializer,
  options?: CreateClientOptions,
): object {
  validateSerializer(serializer)
  const { header: headerName, ...rest } = options ?? {}
  const header = headerName ?? DEFAULT_HEADER
  validateHeader(header)
  const inputSlot = resolveInput(serializer.json)
  const wrapFetch = (fetcher: NonNullable<ClientRequestOptions['fetch']>) => {
    const wrapped = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const headers = new Headers(init?.headers)
      headers.set(header, serializer.name)
      return wrapResponse(
        await fetcher(input as never, { ...init, headers }),
        serializer,
        header,
      )
    }
    return wrapped as NonNullable<ClientRequestOptions['fetch']>
  }
  const raw = hc(baseUrl, {
    ...rest,
    fetch: wrapFetch(rest.fetch ?? globalThis.fetch),
  })
  const wrapClient = (client: AnyClient): AnyClient =>
    new Proxy(client, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver)
        if (
          typeof prop === 'symbol' ||
          prop === 'then' ||
          prop === '$url' ||
          prop === '$path' ||
          prop === '$ws'
        )
          return value
        return value !== null &&
          (typeof value === 'function' || typeof value === 'object')
          ? wrapClient(value)
          : value
      },
      apply(target, _thisArg, argArray: unknown[]) {
        const args = argArray[0] as { json?: unknown } | undefined
        const opts = (argArray[1] ?? {}) as ClientRequestOptions
        const callOptions: ClientRequestOptions = { ...opts }
        if (opts.fetch) callOptions.fetch = wrapFetch(opts.fetch)
        let callArgs = args
        if (inputSlot && args?.json !== undefined) {
          const { json, ...otherArgs } = args
          callArgs = otherArgs
          const body = encode(inputSlot, json)
          const requestHeaders = opts.headers
          callOptions.headers = async () => ({
            ...(typeof requestHeaders === 'function'
              ? await requestHeaders()
              : requestHeaders),
            'Content-Type': inputSlot.contentType ?? 'application/json',
          })
          callOptions.init = { ...opts.init, body: body as BodyInit }
          // RequestInit headers otherwise override hc's assembled headers.
          if (opts.init?.headers || rest.init?.headers) {
            const headers = new Headers(
              opts.init?.headers ?? rest.init?.headers,
            )
            headers.set(
              'Content-Type',
              inputSlot.contentType ?? 'application/json',
            )
            callOptions.init.headers = headers
          }
        }
        return Reflect.apply(
          target as (...args: unknown[]) => unknown,
          undefined,
          [callArgs, callOptions],
        )
      },
    })
  return wrapClient(raw)
}
