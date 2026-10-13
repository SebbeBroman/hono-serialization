import { Hono } from 'hono'
import { cors } from 'hono/cors'
import SuperJSON from 'superjson'
import { describe, expect, test } from 'vitest'
import { createClient } from '../src/client'
import {
  DEFAULT_HEADER,
  defineSerializer,
  serialization,
  type Serializer,
} from '../src/index'

const date = new Date('2024-01-15T12:00:00Z')
const rich = defineSerializer({
  name: 'superjson',
  json: {
    types: 'preserve',
    serialize: SuperJSON.stringify,
    parse: SuperJSON.parse,
    input: {
      types: 'preserve',
      serialize: SuperJSON.stringify,
      parse: SuperJSON.parse,
    },
  },
})
const headers = { [DEFAULT_HEADER]: rich.name }
const fetchOf = (app: Hono) => app.request as typeof fetch

describe('wire regressions', () => {
  test.each([undefined, 'superjson', 'unknown'])(
    'Vary applies with header %s and preserves existing entries',
    async (name) => {
      const t = serialization(rich)
      const app = new Hono().use(t).get('/', (c) => {
        c.header('Vary', 'Origin')
        return t.json(c, { date })
      })
      const r = await app.request('/', {
        headers: name ? { [DEFAULT_HEADER]: name } : {},
      })
      expect(r.headers.get('Vary')).toBe(`Origin, ${DEFAULT_HEADER}`)
    },
  )

  test('CORS exposes all protocol headers even when it runs after serialization', async () => {
    const t = serialization(rich)
    const app = new Hono()
      .use(t)
      .use(cors({ exposeHeaders: ['X-Other'] }))
      .get('/', (c) => t.json(c, { ok: true }))
    const r = await app.request('/', { headers })
    const exposed = r.headers.get('access-control-expose-headers')!
    expect(exposed).toContain('X-Other')
    for (const suffix of ['', '-types'])
      expect(exposed).toContain(DEFAULT_HEADER + suffix)
  })

  test('credentialed CORS explicitly exposes protocol headers alongside a wildcard', async () => {
    const t = serialization(rich)
    const app = new Hono()
      .use(t)
      .use(cors({ credentials: true, exposeHeaders: ['*'] }))
      .get('/', (c) => t.json(c, { ok: true }))
    const r = await app.request('/', { headers })
    const exposed = r.headers.get('access-control-expose-headers')!
    for (const suffix of ['', '-types'])
      expect(exposed).toContain(DEFAULT_HEADER + suffix)
  })

  test.each([{}, undefined, 123, new Uint8Array([1])])(
    'invalid json output fails rather than silently corrupting the body (%s)',
    async (value) => {
      const codec = {
        name: 'invalid',
        json: { serialize: () => value, parse: JSON.parse },
      } as unknown as Serializer
      const t = serialization(codec)
      const app = new Hono()
        .use(t)
        .onError((e) => new Response(e.message, { status: 500 }))
        .get('/', (c) => t.json(c, {}))
      const r = await app.request('/', {
        headers: { [DEFAULT_HEADER]: 'invalid' },
      })
      expect(r.status).toBe(500)
      expect(await r.text()).toMatch(/must return a string/)
    },
  )

  test('binary output must be bytes', async () => {
    const codec = {
      name: 'invalid',
      json: { binary: true, serialize: () => 'bad', parse: () => null },
    } as unknown as Serializer
    const t = serialization(codec)
    const app = new Hono()
      .use(t)
      .onError((e) => new Response(e.message, { status: 500 }))
      .get('/', (c) => t.json(c, {}))
    expect(
      (await app.request('/', { headers: { [DEFAULT_HEADER]: 'invalid' } }))
        .status,
    ).toBe(500)
  })

  test('explicit status and ResponseInit agree with helper output and preserve headers', async () => {
    const t = serialization(rich)
    const app = new Hono()
      .use(t)
      .get('/default', (c) => {
        c.status(202)
        return t.json(c, { date })
      })
      .get('/created', (c) =>
        t.json(
          c,
          { date },
          {
            status: 201,
            headers: { 'X-Test': 'yes', 'Content-Type': 'wrong' },
          },
        ),
      )
    expect((await app.request('/default', { headers })).status).toBe(200)
    const r = await app.request('/created', { headers })
    expect(r.status).toBe(201)
    expect(r.headers.get('X-Test')).toBe('yes')
    expect(r.headers.get('content-type')).toMatch(/application\/json/)
  })

  test('repeated input parsing reuses the same decoded object', async () => {
    const t = serialization(rich)
    const app = new Hono().use(t).post('/', async (c) => {
      const first = await c.req.json<{ date: Date }>()
      const second = await c.req.json<{ date: Date }>()
      return t.json(c, { same: first === second, date: first.date })
    })
    const client = createClient<typeof app>('http://localhost', rich, {
      fetch: fetchOf(app),
    })
    expect(await (await client.index.$post({ json: { date } })).json()).toEqual(
      { same: true, date },
    )
  })
})

describe('client regressions', () => {
  const t = serialization(rich)
  const app = new Hono()
    .use(t)
    .get('/item', (c) => t.json(c, { date }))
    .post('/echo', async (c) => t.json(c, await c.req.json<{ date: Date }>()))
  const client = createClient<typeof app>('http://localhost', rich, {
    fetch: fetchOf(app),
  })

  test('clones decode without consuming the original', async () => {
    const r = await client.item.$get()
    expect(await r.clone().json()).toEqual({ date })
    expect((await r.json()).date).toEqual(date)
  })
  test('per-call fetch is wrapped for GET and POST', async () => {
    const options = { fetch: fetchOf(app) }
    expect(
      (await (await client.item.$get(undefined, options)).json()).date,
    ).toEqual(date)
    expect(
      (await (await client.echo.$post({ json: { date } }, options)).json())
        .date,
    ).toEqual(date)
  })
  test('protocol header cannot be overridden by init.headers', async () => {
    const r = await client.echo.$post(
      { json: { date } },
      { init: { headers: { [DEFAULT_HEADER]: 'unknown' } } },
    )
    expect((await r.json()).date).toEqual(date)
  })
  test('missing middleware fails closed', async () => {
    const missing = new Hono().get('/item', (c) => t.json(c, { date }))
    const client = createClient<typeof missing>('http://localhost', rich, {
      fetch: fetchOf(missing),
    })
    await expect((await client.item.$get()).json()).rejects.toThrow(
      /did not negotiate/,
    )
  })
  test('unknown serializer and mismatched codec types fail closed', async () => {
    const client = createClient<typeof app>('http://localhost', rich, {
      fetch: (async () => new Response('{}')) as typeof fetch,
    })
    await expect((await client.item.$get()).json()).rejects.toThrow(
      /did not negotiate/,
    )
    const mismatch = createClient<typeof app>('http://localhost', rich, {
      fetch: (async () =>
        new Response('{}', {
          headers: {
            [DEFAULT_HEADER]: rich.name,
            [`${DEFAULT_HEADER}-types`]: 'json-parsed',
          },
        })) as typeof fetch,
    })
    await expect((await mismatch.item.$get()).json()).rejects.toThrow(
      /types differ/,
    )
  })
  test('plain c.json routes fail closed on the serializer client', async () => {
    const plain = new Hono().use(t).get('/item', (c) => c.json({ date }))
    const client = createClient<typeof plain>('http://localhost', rich, {
      fetch: fetchOf(plain),
    })
    await expect((await client.item.$get()).json()).rejects.toThrow(
      /did not negotiate/,
    )
    // The untouched context method still serves ordinary JSON clients.
    const stock = await plain.request('/item', { headers })
    expect((await stock.json()).date).toBe(date.toISOString())
  })
  test('JSON codec returns JSON-converted values', async () => {
    const codec = defineSerializer({
      name: 'json',
      json: { types: 'json-parsed', serialize: JSON.stringify, parse: JSON.parse },
    })
    const t = serialization(codec)
    const plain = new Hono().use(t).get('/item', (c) => t.json(c, { date }))
    expect(
      (
        await (
          await createClient<typeof plain>('http://localhost', codec, {
            fetch: fetchOf(plain),
          }).item.$get()
        ).json()
      ).date,
    ).toBe(date.toISOString())
  })
  test('$url and $path remain available', () => {
    expect(client.item.$url().pathname).toBe('/item')
    expect(client.item.$path()).toBe('/item')
  })
})
