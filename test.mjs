// Smoke test: load plugin.js with a stubbed SDK and drive it against a fake MControlProgram /api/v1.
// Run: node test.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'

let pending = [{ id: 'a1', summary: 'web01: systemctl restart nginx', principal: 'token:hermes', reason: 'ask rule', tool: 'ssh_exec', args: {}, created_at: Date.now(), attempts: 1 }]
const decided = []
const srv = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer mcpk_test') { res.writeHead(401).end('{"error":"missing or invalid API key"}'); return }
  const m = /^\/api\/v1\/approvals\/([^/]+)\/(approved|denied)$/.exec(req.url)
  if (m && req.method === 'POST') { decided.push([m[1], m[2]]); pending = pending.filter(a => a.id !== m[1]); res.end('{}'); return }
  if (req.url === '/api/v1/approvals') { res.end(JSON.stringify({ pending, recent: [] })); return }
  res.writeHead(404).end('{}')
})
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${srv.address().port}`

// stub SDK: atoms, a ctx that records contributions and notifications
const atom = v => { let x = v; return { get: () => x, set: n => { x = n } } }
const sdk = { atom, host: { notify() {}, notifyError: (e) => { throw e }, navigate() {} }, useValue: a => a.get(), pluginSettingsHref: id => id, relativeTime: () => 'now',
  PALETTE_AREA: 'palette', ROUTES_AREA: 'routes', SIDEBAR_NAV_AREA: 'nav', STATUSBAR_AREAS: { right: 'sb' } }
for (const c of ['Badge', 'Button', 'EmptyState', 'Input', 'ListRow', 'StatusDot', 'Tip', 'ToggleRow']) sdk[c] = c
globalThis.__sdk = sdk
globalThis.__jsx = { jsx: () => null, jsxs: () => null }
const src = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')
  .replace(/import \{([\s\S]*?)\} from '@hermes\/plugin-sdk'/, (_, names) => `const {${names}} = globalThis.__sdk`)
  .replace(/import \{([\s\S]*?)\} from 'react\/jsx-runtime'/, (_, names) => `const {${names}} = globalThis.__jsx`)
const plugin = (await import('data:text/javascript,' + encodeURIComponent(src))).default

const store = new Map([['prefs', { url, key: 'mcpk_test', pollSec: 60, notify: true }]])
const regs = [], notes = [], timers = []
const ctx = {
  storage: { get: (k, d) => store.get(k) ?? d, set: (k, v) => store.set(k, v) },
  registerMany: cs => regs.push(...cs), registerSettingsPage: p => regs.push(p),
  setInterval: (fn) => { timers.push(fn); return () => {} },
  os: { notify: n => notes.push(n) },
}
const tick = () => new Promise(r => setTimeout(r, 100))
try {
  plugin.register(ctx)
  assert.equal(plugin.id, 'control-tower')
  assert.deepEqual(regs.map(r => r.id), ['page', 'nav', 'chip', 'open', 'settings'])
  await tick()
  assert.equal(notes.length, 0, 'asks already waiting at startup do not notify')
  pending.push({ id: 'a2', summary: 'GET https://example.com/', principal: 'token:hermes', tool: 'web_request', args: {}, created_at: Date.now(), attempts: 1 })
  timers.at(-1)(); await tick()
  assert.equal(notes.length, 1, 'a new ask notifies once'); assert.match(notes[0].body, /example\.com/)
  timers.at(-1)(); await tick()
  assert.equal(notes.length, 1, 'the same ask does not notify again')
  notes[0].actions.find(a => a.id === 'allow').onAction(); await tick()
  assert.deepEqual(decided, [['a2', 'approved']], 'the notification button decides the ask')
  console.log('ok')
} finally { srv.close() }
