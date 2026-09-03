import { createMiddleware } from 'hono/factory'
import type { MiddlewareHandler } from 'hono'
import {
  DEFAULT_HEADER,
  DEFAULT_HTML_CONTENT_TYPE,
  DEFAULT_JSON_CONTENT_TYPE,
  DEFAULT_TEXT_CONTENT_TYPE,
} from './constants'
import { setActive } from './context'
import {
  body,
  html,
  json,
  text,
  type BodyHelper,
  type HtmlHelper,
  type JsonHelper,
  type TextHelper,
} from './helpers'
import { serializerMap } from './list'
import { requestedSerializer, sendEncoded } from './send'
import type { Serializer } from './types'
import { resolveSerializer, resolveInput } from './wire'

export type SerializationMiddlewareOptions = {
  /**
   * Request/response header that selects a serializer by `name`.
   * @default 'x-hono-serialization'
   */
  header?: string
}

export type SerializationMiddleware = MiddlewareHandler & {
  json: JsonHelper
  text: TextHelper
  html: HtmlHelper
  body: BodyHelper
}

const readBody = async (
  c: {
    req: {
      arrayBuffer: () => Promise<ArrayBuffer>
      text: () => Promise<string>
    }
  },
  binary: boolean,
): Promise<string | Uint8Array> => {
  if (binary) {
    return new Uint8Array(await c.req.arrayBuffer())
  }
  return c.req.text()
}

/**
 * Negotiate a serializer from the request header and patch the Hono helpers
 * that have a matching slot. Omitted slots stay on Hono defaults.
 *
 * No header / unknown name → no patching (curl, stock `hc`).
 */
export function serialization(
  serializers: Serializer | readonly Serializer[],
  options?: SerializationMiddlewareOptions,
): SerializationMiddleware {
  const { byName } = serializerMap(serializers)
  const header = options?.header ?? DEFAULT_HEADER

  const middleware = createMiddleware(async (c, next) => {
    const name = requestedSerializer(c, header)
    const active = name != null ? byName.get(name) : undefined
    if (!active) {
      await next()
      return
    }

    setActive(c, { serializer: active, header })

    if (active.json) {
      const slot = resolveSerializer(active.json, DEFAULT_JSON_CONTENT_TYPE)
      c.json = ((object: unknown, arg?: never, headers?: never) => {
        return sendEncoded(c, object, arg, headers, slot, header, active.name)
      }) as typeof c.json

      const input = resolveInput(active.json)
      if (input) {
        c.req.json = (async () => {
          const data = await readBody(c, input.binary)
          return input.parse(data)
        }) as typeof c.req.json
      }
    }

    if (active.text) {
      const slot = resolveSerializer(active.text, DEFAULT_TEXT_CONTENT_TYPE)
      c.text = ((text: string, arg?: never, headers?: never) => {
        return sendEncoded(c, text, arg, headers, slot, header, active.name)
      }) as typeof c.text
    }

    if (active.html) {
      const slot = resolveSerializer(active.html, DEFAULT_HTML_CONTENT_TYPE)
      c.html = ((html: string | Promise<string>, arg?: never, headers?: never) => {
        const send = (value: string) =>
          sendEncoded(c, value, arg, headers, slot, header, active.name)
        if (typeof html === 'string') {
          return send(html)
        }
        return Promise.resolve(html).then((value) => send(String(value)))
      }) as typeof c.html
    }

    if (active.body) {
      const slot = resolveSerializer(active.body, undefined)
      c.body = ((data: unknown, arg?: never, headers?: never) => {
        return sendEncoded(c, data, arg, headers, slot, header, active.name)
      }) as typeof c.body
    }

    await next()
  })

  return Object.assign(middleware, { json, text, html, body })
}
