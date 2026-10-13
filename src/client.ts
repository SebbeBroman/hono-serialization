import type { Hono } from 'hono'
import { hc } from 'hono/client'
import type { ClientRequestOptions } from 'hono/client'
import {
  DEFAULT_HEADER,
  encode,
  formatHeader,
  outputHeader,
  resolve,
  resolveInput,
  validateHeader,
} from './wire'
import { defineSerializer } from './codec'
import { validateSerializer } from './validation'
import type {
  AppSerializer,
  ClientApp,
  FormatName,
  Serializer,
  WireSerializer,
  OutputMode,
} from './types'
export { defineSerializer }
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
  const decode = async (format: FormatName) => {
    const slot = serializer[format]
    if (!slot)
      throw new TypeError(`response uses an unconfigured ${format} slot`)
    const resolved = resolve(slot, undefined)
    const data = resolved.binary
      ? new Uint8Array(await getBuf())
      : await getText()
    return resolved.parse(data as never)
  }
  const matched = () => res.headers.get(header) === serializer.name
  const format = () => res.headers.get(formatHeader(header))
  return new Proxy(res, {
    get(target, prop) {
      if (prop === 'clone')
        return () => wrapResponse(target.clone(), serializer, header)
      if (prop === 'arrayBuffer') return getBuf
      if (prop === 'bytes') return async () => new Uint8Array(await getBuf())
      if (prop === 'json')
        return async () => {
          if (serializer.json) {
            if (!matched() || format() !== 'json')
              throw new TypeError(
                'JSON response did not negotiate the requested serializer; check server middleware and CORS exposure',
              )
            if (
              res.headers.get(outputHeader(header)) !==
              (serializer.json.output ?? 'unknown')
            ) {
              throw new TypeError(
                'server and client JSON output contracts differ',
              )
            }
            return decode('json')
          }
          return JSON.parse(await getText()) as unknown
        }
      if (prop === 'text')
        return async () => {
          if (matched() && (format() === 'text' || format() === 'html')) {
            const value = await decode(format() as 'text' | 'html')
            if (typeof value !== 'string')
              throw new TypeError('text/html parse() must return a string')
            return value
          }
          return getText()
        }
      const value: unknown = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export type CreateClientOptions = ClientRequestOptions & { header?: string }
type PreservingSerializer = Serializer & {
  json: NonNullable<Serializer['json']> & { output: 'preserve' }
}
type JsonSerializer = Serializer & {
  json: NonNullable<Serializer['json']> & { output: 'json' }
}
type WithInput = Serializer & {
  json: NonNullable<Serializer['json']> & {
    input: WireSerializer & { output: 'preserve' }
  }
}
type HonoClient<T extends Hono, Prefix extends string> = ReturnType<
  typeof hc<T, Prefix>
>
export type SerializerClient<
  T extends Hono,
  Mode extends OutputMode,
  Prefix extends string = string,
  RichInput extends boolean = false,
> = HonoClient<ClientApp<T, Mode, RichInput>, Prefix>
export function createClient<T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: PreservingSerializer & WithInput & AppSerializer<T>,
  options?: CreateClientOptions,
): SerializerClient<T, 'preserve', Prefix, true>
export function createClient<T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: PreservingSerializer & AppSerializer<T>,
  options?: CreateClientOptions,
): SerializerClient<T, 'preserve', Prefix>
export function createClient<T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: JsonSerializer & WithInput & AppSerializer<T>,
  options?: CreateClientOptions,
): SerializerClient<T, 'json', Prefix, true>
export function createClient<T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: JsonSerializer & AppSerializer<T>,
  options?: CreateClientOptions,
): SerializerClient<T, 'json', Prefix>
export function createClient<T extends Hono, Prefix extends string = string>(
  baseUrl: Prefix,
  serializer: WithInput & AppSerializer<T>,
  options?: CreateClientOptions,
): SerializerClient<T, 'unknown', Prefix, true>
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
