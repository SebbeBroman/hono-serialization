import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Hono } from 'hono'
import SuperJSON from 'superjson'
import { serialization } from 'hono-serialization'
import { defineSerializer } from 'hono-serialization/codec'
import { createClient } from 'hono-serialization/client'

assert.match(
  import.meta.resolve('hono-serialization'),
  /node_modules\/hono-serialization\//,
)
const date = new Date('2024-01-01T00:00:00Z')
const codec = defineSerializer({
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
const s = serialization(codec)
const app = new Hono()
  .use(s)
  .get('/item', (c) => s.json(c, { date }, 201))
  .post('/echo', async (c) => s.json(c, await c.req.json()))
const server = createServer(async (req, res) => {
  try {
    const headers = new Headers()
    for (const [name, value] of Object.entries(req.headers)) {
      for (const item of Array.isArray(value)
        ? value
        : value === undefined
          ? []
          : [value])
        headers.append(name, item)
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const response = await app.fetch(
      new Request(`http://localhost${req.url}`, {
        method: req.method,
        headers,
        ...(['GET', 'HEAD'].includes(req.method)
          ? {}
          : { body: Buffer.concat(chunks) }),
      }),
    )
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    res.writeHead(500)
    res.end(String(error))
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
try {
  const url = `http://127.0.0.1:${server.address().port}`
  const client = createClient(url, codec)
  const response = await client.item.$get()
  assert.equal(response.status, 201)
  assert.deepEqual(await response.clone().json(), { date })
  assert.deepEqual(await response.json(), { date })
  assert.deepEqual(
    await (await client.item.$get(undefined, { fetch })).json(),
    { date },
  )
  const body = { date, count: 123n, tags: new Set(['a', 'b']) }
  assert.deepEqual(await (await client.echo.$post({ json: body })).json(), body)
  const plain = await fetch(`${url}/item`)
  assert.deepEqual(await plain.json(), { date: date.toISOString() })
  assert.match(plain.headers.get('vary'), /x-hono-serialization/)
  console.log('Installed ESM exports and real HTTP GET/POST round trips pass')
} finally {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
