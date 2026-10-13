import { uneval } from 'devalue'
import { Hono } from 'hono'
import { hc } from 'hono/client'
import {
  deserialize as serovalDeserialize,
  serialize as serovalSerialize,
} from 'seroval'
import {
  stringify as superjsonStringify,
  parse as superjsonParse,
} from 'superjson'
import { describe, expect, test } from 'vitest'
import { createClient } from '../src/client'
import {
  DEFAULT_HEADER,
  serialization,
  defineSerializer,
  type JsonApp,
} from '../src/index'

const date = new Date('2024-01-15T12:00:00.000Z')

const superjson = defineSerializer({
  name: 'superjson',
  json: {
    output: 'preserve',
    serialize: superjsonStringify,
    parse: superjsonParse,
  },
})

const superjsonIn = defineSerializer({
  name: 'superjson',
  json: {
    output: 'preserve',
    serialize: superjsonStringify,
    parse: superjsonParse,
    input: {
      output: 'preserve',
      serialize: superjsonStringify,
      parse: superjsonParse,
    },
  },
})

describe('header negotiation', () => {
  const t = serialization(superjson)
  const app = new Hono()
    .use(t)
    .get('/item', (c) => t.json(c, { createdAt: date }))

  test('no header → vanilla JSON, Date is an ISO string, header not echoed', async () => {
    const res = await app.request('/item')
    expect(res.headers.get(DEFAULT_HEADER)).toBeNull()
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    const data = await res.json()
    expect(data).toEqual({ createdAt: date.toISOString() })
  })

  test('header + json() → encoded body, header echoed, Date revived', async () => {
    const res = await app.request('/item', {
      headers: { [DEFAULT_HEADER]: 'superjson' },
    })
    expect(res.headers.get(DEFAULT_HEADER)).toBe('superjson')
    const text = await res.text()
    const data = superjsonParse(text) as { createdAt: Date }
    expect(data.createdAt).toBeInstanceOf(Date)
    expect(data.createdAt.toISOString()).toBe(date.toISOString())
  })
})

describe('c.json stays ordinary Hono', () => {
  const app = new Hono()
    .use(serialization(superjson))
    .get('/item', (c) => c.json({ createdAt: date }))

  test('header + c.json keeps JSON.stringify and no negotiation header', async () => {
    const res = await app.request('/item', {
      headers: { [DEFAULT_HEADER]: 'superjson' },
    })
    expect(res.headers.get(DEFAULT_HEADER)).toBeNull()
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    const data = await res.json()
    expect(data.createdAt).toBe(date.toISOString())
  })
})

describe('context methods stay untouched', () => {
  const app = new Hono()
    .use(serialization(superjson))
    .get('/hello', (c) => c.text('hello'))
    .get('/page', (c) => c.html('<p>hi</p>'))

  test('c.text() is untouched, even with the header', async () => {
    const res = await app.request('/hello', {
      headers: { [DEFAULT_HEADER]: 'superjson' },
    })
    expect(await res.text()).toBe('hello')
    expect(res.headers.get('content-type')).toMatch(/text\/plain/)
    expect(res.headers.get(DEFAULT_HEADER)).toBeNull()
  })

  test('c.html() is untouched, even with the header', async () => {
    const res = await app.request('/page', {
      headers: { [DEFAULT_HEADER]: 'superjson' },
    })
    expect(await res.text()).toBe('<p>hi</p>')
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    expect(res.headers.get(DEFAULT_HEADER)).toBeNull()
  })
})

describe('input omitted (default)', () => {
  const t = serialization(superjson)
  const app = new Hono().use(t).post('/echo', async (c) => {
    const body = await c.req.json<{ createdAt: unknown }>()
    return t.json(c, {
      createdAt: body.createdAt,
      isDate: body.createdAt instanceof Date,
    })
  })

  test('request JSON is JSON.parse — Dates arrive as strings', async () => {
    const res = await app.request('/echo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [DEFAULT_HEADER]: 'superjson',
      },
      body: superjsonStringify({ createdAt: date }),
    })
    const data = superjsonParse(await res.text()) as {
      createdAt: unknown
      isDate: boolean
    }
    expect(data.isDate).toBe(false)
  })
})

describe('input object', () => {
  const t = serialization(superjsonIn)
  const app = new Hono().use(t).post('/echo', async (c) => {
    const body = await c.req.json<{ createdAt: Date }>()
    return t.json(c, {
      isDate: body.createdAt instanceof Date,
      createdAt: body.createdAt,
    })
  })

  test('client serializes args.json; server handler sees Date', async () => {
    const client = createClient<typeof app>('http://localhost', superjsonIn, {
      fetch: app.request as typeof fetch,
    })
    const res = await client.echo.$post({ json: { createdAt: date } })
    const data = await res.json()
    expect(data.isDate).toBe(true)
    expect(data.createdAt).toBeInstanceOf(Date)
    expect(data.createdAt.toISOString()).toBe(date.toISOString())
  })
})

describe('input can differ from output', () => {
  const mixed = defineSerializer({
    name: 'js',
    json: {
      output: 'preserve',
      serialize: uneval,
      parse: (s: string) => (0, eval)(`(${s})`) as unknown,
      contentType: 'application/devalue',
      input: {
        output: 'preserve',
        serialize: superjsonStringify,
        parse: superjsonParse,
      },
    },
  })
  const t = serialization(mixed)
  const app = new Hono().use(t).post('/echo', async (c) => {
    const body = await c.req.json<{ createdAt: Date }>()
    return t.json(c, {
      isDate: body.createdAt instanceof Date,
      createdAt: body.createdAt,
    })
  })

  test('POST body uses input pair; response uses output pair', async () => {
    const client = createClient<typeof app>('http://localhost', mixed, {
      fetch: app.request as typeof fetch,
    })
    const res = await client.echo.$post({ json: { createdAt: date } })
    expect(res.headers.get('content-type')).toMatch(/devalue/)
    const data = await res.json()
    expect(data.isDate).toBe(true)
    expect(data.createdAt).toBeInstanceOf(Date)
  })
})

describe('uneval-style json output', () => {
  const js = defineSerializer({
    name: 'js',
    json: {
      output: 'preserve',
      serialize: uneval,
      parse: (s: string) => (0, eval)(`(${s})`) as unknown,
      contentType: 'application/devalue',
    },
  })
  const t = serialization(js)
  const app = new Hono()
    .use(t)
    .get('/item', (c) => t.json(c, { createdAt: date }))

  test('round-trips on the serializer client', async () => {
    const client = createClient<typeof app>('http://localhost', js, {
      fetch: app.request as typeof fetch,
    })
    const res = await client.item.$get()
    expect(res.headers.get('content-type')).toMatch(/devalue/)
    const data = await res.json()
    expect(data.createdAt).toBeInstanceOf(Date)
    expect(data.createdAt.toISOString()).toBe(date.toISOString())
  })
})

describe('string serializer with private contentType', () => {
  const custom = defineSerializer({
    name: 'seroval',
    json: {
      output: 'preserve',
      serialize: serovalSerialize,
      parse: serovalDeserialize,
      contentType: 'application/seroval',
    },
  })
  const t = serialization(custom)
  const app = new Hono()
    .use(t)
    .get('/item', (c) => t.json(c, { createdAt: date }))

  test('round-trips as text despite non-textual contentType', async () => {
    const client = createClient<typeof app>('http://localhost', custom, {
      fetch: app.request as typeof fetch,
    })
    const res = await client.item.$get()
    expect(res.headers.get('content-type')).toMatch(/application\/seroval/)
    const data = await res.json()
    expect(data.createdAt).toBeInstanceOf(Date)
    expect(data.createdAt.toISOString()).toBe(date.toISOString())
  })
})

describe('stock hc against a header-gated route', () => {
  const t = serialization(superjson)
  const app = new Hono()
    .use(t)
    .get('/item', (c) => t.json(c, { createdAt: date }))

  test('stock hc (no header) receives vanilla JSON', async () => {
    const client = hc<JsonApp<typeof app>>('http://localhost', {
      fetch: app.request as typeof fetch,
    })
    const res = await client.item.$get()
    expect(res.headers.get(DEFAULT_HEADER)).toBeNull()
    const data = await res.json()
    expect(typeof data.createdAt).toBe('string')
    expect(data.createdAt).toBe(date.toISOString())
  })
})

describe('serializer client response wrapping', () => {
  const t = serialization(superjson)
  const app = new Hono()
    .use(t)
    .get('/item', (c) => t.json(c, { createdAt: date }))

  test('json() revives Date', async () => {
    const client = createClient<typeof app>('http://localhost', superjson, {
      fetch: app.request as typeof fetch,
    })
    const res = await client.item.$get()
    const data = await res.json()
    expect(data.createdAt).toBeInstanceOf(Date)
  })

  test('body can be read as json then text', async () => {
    const client = createClient<typeof app>('http://localhost', superjson, {
      fetch: app.request as typeof fetch,
    })
    const res = await client.item.$get()
    const data = await res.json()
    const text = await res.text()
    expect(data.createdAt).toBeInstanceOf(Date)
    expect(superjsonParse(text)).toEqual(data)
  })

  test('body can be read as text then json', async () => {
    const client = createClient<typeof app>('http://localhost', superjson, {
      fetch: app.request as typeof fetch,
    })
    const res = await client.item.$get()
    const text = await res.text()
    const data = await res.json()
    expect(data.createdAt).toBeInstanceOf(Date)
    expect(superjsonParse(text)).toEqual(data)
  })
})

describe('custom header name', () => {
  const t = serialization(superjson, { header: 'x-custom-serde' })
  const app = new Hono()
    .use(t)
    .get('/item', (c) => t.json(c, { createdAt: date }))

  test('uses the configured header', async () => {
    const res = await app.request('/item', {
      headers: { 'x-custom-serde': 'superjson' },
    })
    expect(res.headers.get('x-custom-serde')).toBe('superjson')
    expect(res.headers.get(DEFAULT_HEADER)).toBeNull()
    const data = superjsonParse(await res.text()) as { createdAt: Date }
    expect(data.createdAt).toBeInstanceOf(Date)
  })
})

const binary = defineSerializer({
  name: 'bin',
  json: {
    output: 'preserve',
    serialize: (value: unknown) =>
      new TextEncoder().encode(superjsonStringify(value)),
    parse: (data: string | Uint8Array) => {
      const text =
        typeof data === 'string' ? data : new TextDecoder().decode(data)
      return superjsonParse(text)
    },
    contentType: 'application/octet-stream',
    binary: true,
    input: {
      output: 'preserve',
      serialize: (value: unknown) =>
        new TextEncoder().encode(superjsonStringify(value)),
      parse: (data: string | Uint8Array) => {
        const text =
          typeof data === 'string' ? data : new TextDecoder().decode(data)
        return superjsonParse(text)
      },
      binary: true,
      contentType: 'application/octet-stream',
    },
  },
})

describe('multiple serializers', () => {
  const t = serialization([superjsonIn, binary])
  const app = new Hono()
    .use(t)
    .get('/item', (c) => t.json(c, { createdAt: date }))
    .post('/echo', async (c) => {
      const body = await c.req.json<{ createdAt: Date }>()
      return t.json(c, {
        isDate: body.createdAt instanceof Date,
        createdAt: body.createdAt,
      })
    })

  test('json client uses the superjson slot', async () => {
    const client = createClient<typeof app>('http://localhost', superjsonIn, {
      fetch: app.request as typeof fetch,
    })
    const res = await client.item.$get()
    expect(res.headers.get(DEFAULT_HEADER)).toBe('superjson')
    expect(res.headers.get('content-type')).toMatch(/json/)
    const data = await res.json()
    expect(data.createdAt).toBeInstanceOf(Date)
  })

  test('bin client uses the binary slot', async () => {
    const client = createClient<typeof app>('http://localhost', binary, {
      fetch: app.request as typeof fetch,
    })
    const res = await client.item.$get()
    expect(res.headers.get(DEFAULT_HEADER)).toBe('bin')
    expect(res.headers.get('content-type')).toMatch(/octet-stream/)
    const data = await res.json()
    expect(data.createdAt).toBeInstanceOf(Date)
    expect(data.createdAt.toISOString()).toBe(date.toISOString())
  })

  test('unknown name is vanilla JSON', async () => {
    const res = await app.request('/item', {
      headers: { [DEFAULT_HEADER]: 'nope' },
    })
    expect(res.headers.get(DEFAULT_HEADER)).toBeNull()
    const data = await res.json()
    expect(data.createdAt).toBe(date.toISOString())
  })

  test('binary input round-trips Date on POST', async () => {
    const client = createClient<typeof app>('http://localhost', binary, {
      fetch: app.request as typeof fetch,
    })
    const res = await client.echo.$post({ json: { createdAt: date } })
    const data = await res.json()
    expect(data.isDate).toBe(true)
    expect(data.createdAt).toBeInstanceOf(Date)
  })
})

describe('defineSerializer / serialization() validation', () => {
  test('rejects an empty name', () => {
    expect(() =>
      defineSerializer({
        name: '',
        json: {
          output: 'preserve',
          serialize: JSON.stringify,
          parse: JSON.parse,
        },
      }),
    ).toThrow(/name/)
  })

  test('rejects a serializer without a json codec', () => {
    expect(() =>
      defineSerializer({ name: 'empty' } as never),
    ).toThrow(/json codec is required/)
  })

  test('rejects unsupported slots', () => {
    expect(() =>
      defineSerializer({
        name: 'extra',
        json: {
          output: 'preserve',
          serialize: JSON.stringify,
          parse: JSON.parse,
        },
        // @ts-expect-error text is not part of the JSON-only contract.
        text: { serialize: String, parse: String },
      }),
    ).toThrow(/unsupported field "text"/)
  })

  test('rejects duplicate names', () => {
    expect(() => serialization([superjson, superjson])).toThrow(/duplicate/)
  })
})
