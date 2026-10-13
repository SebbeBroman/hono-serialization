import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
for (const entry of ['client.js', 'client.cjs', 'codec.js', 'codec.cjs']) {
  const seen = new Set()
  async function inspect(path) {
    if (seen.has(path)) return
    seen.add(path)
    const source = await readFile(path, 'utf8')
    assert.doesNotMatch(
      source,
      /\bfunction\s+serialization\s*\(|\b(?:var|const|let)\s+(?:sendEncoded|getActive|setActive)\b/,
      `${entry} includes server implementation`,
    )
    for (const match of source.matchAll(
      /\b(?:from\s*|import\s*|require\s*\(\s*)['"]([^'"]+)['"]/g,
    )) {
      const specifier = match[1]
      if (specifier.startsWith('.')) {
        await inspect(resolve(dirname(path), specifier))
      } else {
        if (entry.startsWith('client')) {
          assert.equal(
            specifier,
            'hono/client',
            `${entry} has an unexpected runtime dependency: ${specifier}`,
          )
        } else {
          assert.fail(
            `${entry} has an unexpected runtime dependency: ${specifier}`,
          )
        }
      }
    }
  }
  await inspect(resolve(dist, entry))
}
console.log('Client and codec package boundaries pass for ESM and CommonJS')
