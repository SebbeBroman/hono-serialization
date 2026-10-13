import { Hono } from 'hono'
import { hc } from 'hono/client'
import SuperJSON from 'superjson'
import { serialization, type JsonApp } from 'hono-serialization'
import { defineSerializer } from 'hono-serialization/codec'
import { createClient } from 'hono-serialization/client'
const codec = defineSerializer({
  name: 'sj',
  json: {
    output: 'preserve',
    serialize: SuperJSON.stringify,
    parse: SuperJSON.parse,
  },
})
const s = serialization(codec)
const app = new Hono()
  .use(s)
  .get('/item', (c) => s.json(c, { date: new Date() }, { status: 201 }))
const client = createClient<typeof app>('http://localhost', codec)
const res = await client.item.$get()
const status: 201 = res.status
const date: Date = (await res.json()).date
const plain = hc<JsonApp<typeof app>>('http://localhost')
const text: string = (await (await plain.item.$get()).json()).date
// @ts-expect-error JSON clients cannot claim their Date string is a Date object.
const wrongDate: Date = (await (await plain.item.$get()).json()).date
void [status, date, text, wrongDate]
