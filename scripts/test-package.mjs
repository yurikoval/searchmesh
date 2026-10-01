import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const consumer = mkdtempSync(join(tmpdir(), 'searchmesh-package-'))

try {
  const [{ filename }] = JSON.parse(execFileSync('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', consumer,
  ], { cwd: root, encoding: 'utf8' }))
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', `./${filename}`], {
    cwd: consumer,
    stdio: 'ignore',
  })
  execFileSync(process.execPath, ['--input-type=module', '--eval',
    "import('searchmesh').then(({providerAdapters}) => { if (Object.keys(providerAdapters).join(',') !== 'brave,tavily,exa,yep,kagi') process.exit(1) })",
  ], { cwd: consumer, stdio: 'inherit' })

  writeFileSync(join(consumer, 'consumer.ts'), `
    import { getProviderAdapter, type NormalizedSearchRequest } from 'searchmesh'
    const request: NormalizedSearchRequest = { query: 'test', limit: 1 }
    void request
    void getProviderAdapter('brave')
  `)
  execFileSync(join(root, 'node_modules', '.bin', 'tsc'), [
    '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--lib', 'ES2022,DOM',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.ts',
  ], { cwd: consumer, stdio: 'inherit' })
} finally {
  rmSync(consumer, { recursive: true, force: true })
}
