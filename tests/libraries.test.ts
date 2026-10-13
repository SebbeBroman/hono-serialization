import { encode as cborEncode, decode as cborDecode } from 'cbor-x'
import { parse as devalueParse, stringify as devalueStringify } from 'devalue'
import { Hono } from 'hono'
import { deserialize, serialize, toJSON, fromJSON } from 'seroval'
import SuperJSON from 'superjson'
import { describe, expect, test } from 'vitest'
import { createClient } from '../src/client'
import { DEFAULT_HEADER, serialization, defineSerializer } from '../src/index'

const date = new Date('2024-01-15T12:00:00.000Z')

type Payload = {
  createdAt: Date
  tags: Set<string>
  meta: Map<string, number>
  count: number
}

const payload = (): Payload => ({
  createdAt: date,
  tags: new Set(['a', 'b']),
  meta: new Map([['n', 1]]),
  count: 7,
})

const superjson = defineSerializer({
  name: 'superjson',
  json: {
    output: 'preserve',
    serialize: SuperJSON.stringify,
    parse: SuperJSON.parse,
    input: {
      output: 'preserve',
      serialize: SuperJSON.stringify,
      parse: SuperJSON.parse,
    },
  },
})

const vanilla = defineSerializer({
  name: 'json',
  json: {
    output: 'json',
    serialize: JSON.stringify,
    parse: JSON.parse,
    input: {
      output: 'json',
      serialize: JSON.stringify,
      parse: JSON.parse,
    },
  },
})

const devalue = defineSerializer({
  name: 'devalue',
  json: {
    output: 'preserve',
    serialize: devalueStringify,
    parse: devalueParse,
    input: {
      output: 'preserve',
      serialize: devalueStringify,
      parse: devalueParse,
    },
  },
})

const seroval = defineSerializer({
  name: 'seroval',
  json: {
    output: 'preserve',
    serialize,
    parse: deserialize,
    contentType: 'application/seroval',
    input: {
      output: 'preserve',
      serialize: (value: unknown) => JSON.stringify(toJSON(value)),
      parse: (value: string) => fromJSON(JSON.parse(value)),
    },
  },
})

const libraries = [
  { serializer: superjson, rich: true },
  { serializer: vanilla, rich: false },
  { serializer: devalue, rich: true },
  { serializer: seroval, rich: true },
] as const

const t = serialization([superjson, vanilla, devalue, seroval])

const app = new Hono()
  .use(t)
  .get('/item', (c) => t.json(c, payload()))
  .post('/echo', async (c) => {
    const body = await c.req.json<Payload>()
    return t.json(c, {
      isDate: body.createdAt instanceof Date,
      isSet: body.tags instanceof Set,
      isMap: body.meta instanceof Map,
      count: body.count,
      createdAt: body.createdAt,
      tags: body.tags,
      meta: body.meta,
    })
  })

const clientOf = (item: (typeof libraries)[number]) =>
  createClient<typeof app>('http://localhost', item.serializer, {
    fetch: app.request as typeof fetch,
  })

const expectRich = (value: {
  createdAt: unknown
  tags: unknown
  meta: unknown
  count: unknown
}) => {
  expect(value.count).toBe(7)
  expect(value.createdAt).toBeInstanceOf(Date)
  expect((value.createdAt as Date).toISOString()).toBe(date.toISOString())
  expect(value.tags).toBeInstanceOf(Set)
  expect([...(value.tags as Set<string>)].sort()).toEqual(['a', 'b'])
  expect(value.meta).toBeInstanceOf(Map)
  expect((value.meta as Map<string, number>).get('n')).toBe(1)
}

const expectVanilla = (value: {
  createdAt: unknown
  tags: unknown
  meta: unknown
  count: unknown
}) => {
  expect(value.count).toBe(7)
  expect(value.createdAt).toBe(date.toISOString())
  expect(value.tags).toEqual({})
  expect(value.meta).toEqual({})
}

describe.each(libraries)('$serializer.name', (item) => {
  test('GET round-trips through createClient', async () => {
    const res = await clientOf(item).item.$get()
    expect(res.headers.get(DEFAULT_HEADER)).toBe(item.serializer.name)
    const data = (await res.json()) as Payload & {
      isDate: boolean
      isSet: boolean
      isMap: boolean
    }
    if (item.rich) {
      expectRich(data)
    } else {
      expectVanilla(data)
    }
  })

  test('POST input is parsed on the server and echoed', async () => {
    const res = await clientOf(item).echo.$post({ json: payload() })
    expect(res.headers.get(DEFAULT_HEADER)).toBe(item.serializer.name)
    const data = (await res.json()) as Payload & {
      isDate: boolean
      isSet: boolean
      isMap: boolean
    }
    if (item.rich) {
      expect(data.isDate).toBe(true)
      expect(data.isSet).toBe(true)
      expect(data.isMap).toBe(true)
      expectRich(data)
    } else {
      expect(data.isDate).toBe(false)
      expect(data.isSet).toBe(false)
      expect(data.isMap).toBe(false)
      expectVanilla(data)
    }
  })

  test('no header still returns vanilla JSON.stringify', async () => {
    const res = await app.request('/item')
    expect(res.headers.get(DEFAULT_HEADER)).toBeNull()
    const data = (await res.json()) as Payload & {
      isDate: boolean
      isSet: boolean
      isMap: boolean
    }
    expectVanilla(data)
  })
})

const cborSlot = {
  serialize: (value: unknown) => cborEncode(value),
  parse: (data: string | Uint8Array) => {
    if (typeof data === 'string') {
      throw new TypeError('cbor serializer expected bytes')
    }
    return cborDecode(data)
  },
  contentType: 'application/cbor',
  binary: true as const,
}

const cbor = defineSerializer({
  name: 'cbor',
  json: {
    output: 'preserve',
    ...cborSlot,
    input: { output: 'preserve', ...cborSlot },
  },
})

describe('cbor-x contentType', () => {
  const t = serialization(cbor)
  const app = new Hono()
    .use(t)
    .get('/item', (c) => t.json(c, payload()))
    .post('/echo', async (c) => {
      const body = await c.req.json<Payload>()
      return t.json(c, {
        isDate: body.createdAt instanceof Date,
        isSet: body.tags instanceof Set,
        isMap: body.meta instanceof Map,
        count: body.count,
        createdAt: body.createdAt,
        tags: body.tags,
        meta: body.meta,
      })
    })

  test('GET sets Content-Type: application/cbor and res.json() revives types', async () => {
    const client = createClient<typeof app>('http://localhost', cbor, {
      fetch: app.request as typeof fetch,
    })
    const res = await client.item.$get()
    expect(res.headers.get(DEFAULT_HEADER)).toBe('cbor')
    expect(res.headers.get('content-type')).toMatch(/application\/cbor/)
    const data = (await res.json()) as Payload & {
      isDate: boolean
      isSet: boolean
      isMap: boolean
    }
    expectRich(data)
  })

  test('POST sends application/cbor and the server parses bytes', async () => {
    let requestContentType: string | null = null
    const client = createClient<typeof app>('http://localhost', cbor, {
      fetch: (async (input, init) => {
        requestContentType = new Headers(init?.headers).get('content-type')
        return app.request(input as never, init as never)
      }) as typeof fetch,
    })
    const res = await client.echo.$post({ json: payload() })
    expect(requestContentType).toMatch(/application\/cbor/)
    expect(res.headers.get('content-type')).toMatch(/application\/cbor/)
    const data = (await res.json()) as Payload & {
      isDate: boolean
      isSet: boolean
      isMap: boolean
    }
    expect(data.isDate).toBe(true)
    expect(data.isSet).toBe(true)
    expect(data.isMap).toBe(true)
    expectRich(data)
  })

  test('implied binary from contentType without binary: true', async () => {
    const res = await app.request('/item', {
      headers: { [DEFAULT_HEADER]: 'cbor' },
    })
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf[0]).not.toBe(0x7b) // not `{` / JSON
    const data = cborDecode(buf) as Payload
    expectRich(data)
  })
})
