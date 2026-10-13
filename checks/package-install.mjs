import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'hono-serialization-release-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
function run(command, args, cwd = root) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    if (error.stdout) process.stderr.write(error.stdout)
    if (error.stderr) process.stderr.write(error.stderr)
    throw error
  }
}
try {
  const [packed] = JSON.parse(
    run(npm, [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      temporary,
    ]),
  )
  const paths = packed.files.map((file) => file.path)
  for (const required of [
    'LICENSE',
    'README.md',
    'CHANGELOG.md',
    'package.json',
    'dist/index.js',
    'dist/index.cjs',
    'dist/client.js',
    'dist/client.cjs',
    'dist/codec.js',
    'dist/codec.cjs',
  ])
    assert.ok(paths.includes(required), `Missing package file: ${required}`)
  for (const path of paths)
    assert.ok(
      path.startsWith('dist/') ||
        ['LICENSE', 'README.md', 'CHANGELOG.md', 'package.json'].includes(path),
      `Unexpected package file: ${path}`,
    )
  const hono = JSON.parse(
    await readFile(join(root, 'node_modules/hono/package.json'), 'utf8'),
  )
  const superjson = JSON.parse(
    await readFile(join(root, 'node_modules/superjson/package.json'), 'utf8'),
  )
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({ name: 'release-consumer', private: true, type: 'module' }),
  )
  run(
    npm,
    [
      'install',
      '--ignore-scripts',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      join(temporary, packed.filename),
      `hono@${hono.version}`,
      `superjson@${superjson.version}`,
    ],
    temporary,
  )
  await copyFile(
    join(root, 'checks/package-types.ts'),
    join(temporary, 'consumer.ts'),
  )
  await writeFile(
    join(temporary, 'consumer.cts'),
    `import { Hono } from 'hono'
import { serialization } from 'hono-serialization'
import { defineSerializer } from 'hono-serialization/codec'
import { createClient } from 'hono-serialization/client'
const codec = defineSerializer({ name: 'json', json: { output: 'json', serialize: JSON.stringify, parse: JSON.parse } })
const s = serialization(codec)
const app = new Hono().use(s).get('/item', c => s.json(c, { date: new Date() }, 201))
const client = createClient<typeof app>('http://localhost', codec)
async function check() {
  const response = await client.item.$get()
  const status: 201 = response.status
  const date: string = (await response.json()).date
  void [status, date]
}
void check
`,
  )
  await writeFile(
    join(temporary, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: [],
        lib: ['ES2022', 'DOM'],
      },
      include: ['consumer.ts', 'consumer.cts'],
    }),
  )
  run(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '-p',
      join(temporary, 'tsconfig.json'),
    ],
    temporary,
  )
  await copyFile(
    join(root, 'checks/package-runtime.mjs'),
    join(temporary, 'runtime.mjs'),
  )
  process.stdout.write(run(process.execPath, ['runtime.mjs'], temporary))
  console.log(
    `Tarball validated: ${packed.name}@${packed.version}, ${packed.files.length} files`,
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
