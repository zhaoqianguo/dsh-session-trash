import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

/**
 * Copies the plugin next to a temporary DSH_HOME with fake Host services, then
 * drives the web route over a real local HTTP server. The plugin intentionally
 * imports nothing from DSH packages (they only exist inside the app bundle), so
 * the copy needs no node_modules.
 */
async function harness() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-trash-host-'))
  const harnessDir = join(root, 'plugin')
  mkdirSync(harnessDir, { recursive: true })
  const source = (name) => new URL('../' + name, import.meta.url)
  for (const name of ['index.js', 'sessions-scan.js', 'trash-store.js', 'tool-schema.js']) {
    copyFileSync(source(name), join(harnessDir, name))
  }

  const home = join(root, 'home')
  const sessionsRoot = join(home, 'sessions')
  const projectDir = join(sessionsRoot, '--Users-me-code-demo--')
  mkdirSync(projectDir, { recursive: true })
  process.env.DSH_HOME = home

  const sessionId = 'session-aaaabbbb-cccc-dddd-eeee-ffff00001111'
  const otherId = 'session-bbbbcccc-dddd-eeee-ffff00002222'
  mkdirSync(join(projectDir, sessionId), { recursive: true })
  writeFileSync(join(projectDir, sessionId, 'session.v4.jsonl.zstd'), 'log-bytes')
  mkdirSync(join(projectDir, otherId), { recursive: true })
  writeFileSync(join(projectDir, otherId, 'session.v4.jsonl.zstd'), 'other-bytes')
  mkdirSync(join(home, 'storages'), { recursive: true })
  const workspaceFile = join(home, 'storages', 'workspace.json')
  writeFileSync(workspaceFile, JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { archivedSessionIds: [] },
    tables: { workspaces: { ws1: { path: '/Users/me/code/demo', sessionIds: [sessionId, otherId] } } },
  }))
  const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(join(cacheDir, sessionId + '.json'), JSON.stringify({
    version: 7,
    record: { identity: { formatVersion: 4, createdAt: '2026-01-01T00:00:00.000Z', cwd: '/Users/me/code/demo' }, rows: { title: { ver: 1, seq: 1, val: '缓存标题' } } },
  }))

  const activeId = 'session-active-one'
  mkdirSync(join(projectDir, activeId), { recursive: true })
  writeFileSync(join(projectDir, activeId, 'session.v4.jsonl.zstd'), 'busy')

  // The fake registry mirrors the real one: archive state is persisted into
  // workspace.json, so the plugin's workspace.json reader sees it too.
  const archived = []
  const persistArchive = () => {
    const data = JSON.parse(readFileSync(workspaceFile, 'utf8'))
    data.global.archivedSessionIds = archived.slice()
    writeFileSync(workspaceFile, JSON.stringify(data))
  }
  const registry = {
    get archivedSessionIds() { return archived.slice() },
    async archiveSession(id) {
      if (id === 'session-active-one') {
        const error = new Error('session has active work')
        error.code = 'session-active'
        throw error
      }
      if (!archived.includes(id)) archived.push(id)
      persistArchive()
    },
    async unarchiveSession(id) {
      const index = archived.indexOf(id)
      if (index >= 0) {
        archived.splice(index, 1)
        persistArchive()
      }
    },
  }

  const tools = []
  const disposers = []
  let route = null
  const ctx = {
    sessionPersistence: { root: sessionsRoot },
    workspaceRegistry: registry,
    tools: { register: (tool) => tools.push(tool) },
    webServer: {
      register: (registered) => {
        route = registered
        return () => { route = null }
      },
    },
    effect: (run) => {
      const dispose = run()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    logger: { info() {}, warn() {}, error() {} },
  }

  const plugin = await import('file://' + join(harnessDir, 'index.js'))
  plugin.apply(ctx)
  assert.ok(route, 'the plugin did not register a web route')

  const server = createServer((req, res) => route.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port

  const rpc = async (payload, options = {}) => {
    const response = await fetch(origin + '/api/session-trash', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', Origin: origin }, options.headers),
      body: JSON.stringify(payload),
    })
    return { status: response.status, body: await response.json() }
  }
  const request = async (path, options) => {
    const response = await fetch(origin + path, options)
    return { status: response.status, body: await response.json() }
  }

  return {
    sessionId, otherId, projectDir, sessionsRoot, home, registry, archived, tools, route, rpc, request, origin,
    async close() {
      for (const dispose of disposers) {
        try { dispose() } catch { /* ignore */ }
      }
      await new Promise((resolve) => server.close(resolve))
      rmSync(root, { recursive: true, force: true })
      delete process.env.DSH_HOME
    },
  }
}

test('delete archives, moves files, lists, restores and purges over the web route', async () => {
  const app = await harness()
  try {
    const deleted = await app.rpc({ action: 'delete', id: app.sessionId, title: '演示会话' })
    assert.equal(deleted.body.ok, true, JSON.stringify(deleted.body))
    assert.equal(deleted.body.item.title, '演示会话')
    assert.equal(deleted.body.item.workspacePath, '/Users/me/code/demo')
    assert.equal(deleted.body.item.sizeBytes, 9)
    assert.deepEqual(app.archived, [app.sessionId])
    assert.equal(existsSync(join(app.projectDir, app.sessionId)), false)
    assert.equal(existsSync(join(app.home, 'session-trash', 'items', app.sessionId, 'session', 'session.v4.jsonl.zstd')), true)

    const listed = await app.request('/api/session-trash', { headers: { Origin: app.origin } })
    assert.equal(listed.status, 200)
    assert.equal(listed.body.ok, true)
    assert.equal(listed.body.items.length, 1)
    assert.equal(listed.body.settings.retentionDays, 30)
    assert.ok(listed.body.root.endsWith('session-trash'))

    const restored = await app.rpc({ action: 'restore', id: app.sessionId })
    assert.equal(restored.body.ok, true)
    assert.equal(existsSync(join(app.projectDir, app.sessionId, 'session.v4.jsonl.zstd')), true)
    assert.deepEqual(app.archived, [])
    assert.equal(restored.body.items.length, 0)

    await app.rpc({ action: 'delete', id: app.sessionId })
    const purged = await app.rpc({ action: 'purge', id: app.sessionId })
    assert.equal(purged.body.purged, true)
    assert.equal(existsSync(join(app.home, 'session-trash', 'items', app.sessionId)), false)
    assert.deepEqual(app.archived, [], 'a purge clears the archived id so workspace.json keeps no ghost entry')
  } finally {
    await app.close()
  }
})

test('deleting a missing session fails without touching the archive set', async () => {
  const app = await harness()
  try {
    const result = await app.rpc({ action: 'delete', id: 'session-nope' })
    assert.equal(result.body.ok, false)
    assert.match(result.body.error, /找不到/)
    assert.deepEqual(app.archived, [])
  } finally {
    await app.close()
  }
})

test('an active session is refused and reported in Chinese', async () => {
  const app = await harness()
  try {
    const result = await app.rpc({ action: 'delete', id: 'session-active-one' })
    assert.equal(existsSync(join(app.projectDir, 'session-active-one')), true, 'a refused delete must not move files')
    assert.equal(result.body.ok, false)
    assert.equal(result.body.code, 'session-active')
    assert.match(result.body.error, /正在运行/)
  } finally {
    await app.close()
  }
})

test('retention settings and empty are served over the route and reject unknown actions', async () => {
  const app = await harness()
  try {
    await app.rpc({ action: 'delete', id: app.sessionId })
    const changed = await app.rpc({ action: 'settings', retentionDays: 7 })
    assert.equal(changed.body.settings.retentionDays, 7)
    assert.ok(changed.body.items[0].expiresAt)
    assert.equal(
      changed.body.items[0].expiresAt,
      new Date(Date.parse(changed.body.items[0].deletedAt) + 7 * 86400000).toISOString(),
    )

    const emptied = await app.rpc({ action: 'empty' })
    assert.equal(emptied.body.purged, 1)
    assert.deepEqual(app.archived, [], 'emptying the bin also clears the archive set')

    const unknown = await app.rpc({ action: 'nope' })
    assert.equal(unknown.body.ok, false)
    assert.match(unknown.body.error, /未知操作/)

    const badJson = await app.request('/api/session-trash', {
      method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json' }, body: '{oops',
    })
    assert.equal(badJson.body.ok, false)
    assert.match(badJson.body.error, /JSON/)
  } finally {
    await app.close()
  }
})

test('cross-origin writes are rejected with 403', async () => {
  const app = await harness()
  try {
    const result = await app.request('/api/session-trash', {
      method: 'POST',
      headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: app.sessionId }),
    })
    assert.equal(result.status, 403)
    assert.equal(result.body.ok, false)
    assert.equal(existsSync(join(app.projectDir, app.sessionId)), true)
  } finally {
    await app.close()
  }
})

test('writes are accepted without an Origin header and from any loopback spelling', async () => {
  const app = await harness()
  try {
    // The desktop shell posts without an Origin header. Demanding one broke
    // every write from the real client while curl/tests kept working.
    const noOrigin = await app.request('/api/session-trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: app.sessionId }),
    })
    assert.equal(noOrigin.status, 200, 'POST without Origin must not be rejected')
    assert.equal(noOrigin.body.ok, true)
    assert.equal(existsSync(join(app.projectDir, app.sessionId)), false)

    // The same loopback server reached as localhost instead of 127.0.0.1 is
    // still local.
    const alias = await app.request('/api/session-trash', {
      method: 'POST',
      headers: { Origin: 'http://localhost:' + new URL(app.origin).port, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore', id: app.sessionId }),
    })
    assert.equal(alias.status, 200)
    assert.equal(alias.body.ok, true)
    assert.equal(existsSync(join(app.projectDir, app.sessionId)), true)

    // A desktop shell can load the UI from a custom scheme; only a web page
    // can produce an http(s) origin, so anything else is local.
    const shell = await app.request('/api/session-trash', {
      method: 'POST',
      headers: { Origin: 'app://dsh', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: app.sessionId }),
    })
    assert.equal(shell.status, 200)
    assert.equal(shell.body.ok, true)
  } finally {
    await app.close()
  }
})

test('a sandboxed null origin is still rejected unless the browser says same-origin', async () => {
  const app = await harness()
  try {
    const rejected = await app.request('/api/session-trash', {
      method: 'POST',
      headers: { Origin: 'null', 'sec-fetch-site': 'cross-site', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: app.sessionId }),
    })
    assert.equal(rejected.status, 403)
    assert.equal(rejected.body.ok, false)
    assert.equal(existsSync(join(app.projectDir, app.sessionId)), true, 'a rejected write must not touch the session')
  } finally {
    await app.close()
  }
})

test('posting a non-json body is rejected before any work runs', async () => {
  const app = await harness()
  try {
    // A hostile page can only send CORS-safelisted content types cross-site;
    // requiring JSON turns that into a preflight this route never answers.
    const result = await app.request('/api/session-trash', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'delete', id: app.sessionId }),
    })
    assert.equal(result.status, 415)
    assert.equal(result.body.ok, false)
    assert.equal(existsSync(join(app.projectDir, app.sessionId)), true)
  } finally {
    await app.close()
  }
})

test('agent tools are registered and drive the same store', async () => {
  const app = await harness()
  try {
    const names = app.tools.map((tool) => tool.name).sort()
    assert.deepEqual(names, [
      'session_trash_archive_delete', 'session_trash_archive_list', 'session_trash_archive_restore',
      'session_trash_delete', 'session_trash_empty', 'session_trash_list',
      'session_trash_purge', 'session_trash_purge_many', 'session_trash_restore', 'session_trash_settings',
    ])
    for (const tool of app.tools) {
      assert.equal(typeof tool.execute, 'function')
      assert.equal(typeof tool.description, 'string')
      assert.equal(tool.output.schema.type, 'string')
      const rendered = tool.output.render({}, 'x')
      assert.deepEqual(rendered, [{ type: 'text', text: 'x' }])
    }

    const del = app.tools.find((tool) => tool.name === 'session_trash_delete')
    assert.match(await del.execute({ session_id: app.sessionId, title: 'T' }), /moved to recycle bin/)
    const list = app.tools.find((tool) => tool.name === 'session_trash_list')
    const listing = await list.execute({})
    assert.match(listing, /count: 1/)
    assert.match(listing, /total size: 9 B/)
    assert.match(listing, /archived: 0 session/)
    assert.match(listing, /T/)
    const restore = app.tools.find((tool) => tool.name === 'session_trash_restore')
    assert.match(await restore.execute({ session_id: app.sessionId }), /restored/)
    const settings = app.tools.find((tool) => tool.name === 'session_trash_settings')
    assert.match(await settings.execute({ retention_days: 0 }), /never auto-delete/)
    assert.match(await settings.execute({}), /never auto-delete/)
  } finally {
    await app.close()
  }
})

test('the first sweep purges expired entries after the retention window', async () => {
  const app = await harness()
  try {
    await app.rpc({ action: 'settings', retentionDays: 0 })
    await app.rpc({ action: 'delete', id: app.sessionId })
    await app.rpc({ action: 'settings', retentionDays: 1 })
    const metaFile = join(app.home, 'session-trash', 'items', app.sessionId, 'meta.json')
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'))
    meta.deletedAt = new Date(Date.now() - 3 * 86400000).toISOString()
    meta.expiresAt = new Date(Date.now() - 2 * 86400000).toISOString()
    writeFileSync(metaFile, JSON.stringify(meta))
    const result = await app.rpc({ action: 'purge-expired' })
    assert.deepEqual(result.body.purged, [app.sessionId])
    assert.equal(result.body.items.length, 0)
    assert.deepEqual(app.archived, [], 'the expiry sweep clears the archive set too')
  } finally {
    await app.close()
  }
})

test('panel reports bin, archive and active sizes in one round trip', async () => {
  const app = await harness()
  try {
    await app.rpc({ action: 'delete', id: app.sessionId, title: '演示会话' })
    await app.registry.archiveSession(app.otherId)
    const panel = await app.rpc({ action: 'panel' })
    assert.equal(panel.body.ok, true, JSON.stringify(panel.body))
    assert.equal(panel.body.items.length, 1)
    assert.equal(panel.body.archived.length, 1)
    assert.equal(panel.body.archived[0].id, app.otherId)
    assert.equal(panel.body.stats.trash.count, 1)
    assert.equal(panel.body.stats.trash.bytes, 9)
    assert.equal(panel.body.stats.archived.count, 1)
    assert.equal(panel.body.stats.archived.bytes, 11)
    assert.equal(panel.body.stats.active.count, 1, 'only session-active-one is neither binned nor archived')
    assert.equal(panel.body.settings.retentionDays, 30)

    // A session without an explicit title falls back to the projection cache.
    await app.rpc({ action: 'restore', id: app.sessionId })
    const again = await app.rpc({ action: 'delete', id: app.sessionId })
    assert.equal(again.body.item.title, '缓存标题')
  } finally {
    await app.close()
  }
})

test('batch restore and batch purge handle several sessions in one call', async () => {
  const app = await harness()
  try {
    await app.rpc({ action: 'delete', id: app.sessionId })
    await app.rpc({ action: 'delete', id: app.otherId })
    const listed = await app.rpc({ action: 'list' })
    assert.equal(listed.body.items.length, 2)

    const restored = await app.rpc({ action: 'restore-many', ids: [app.sessionId, app.otherId] })
    assert.equal(restored.body.ok, true, JSON.stringify(restored.body))
    assert.deepEqual(restored.body.restored.sort(), [app.sessionId, app.otherId].sort())
    assert.deepEqual(restored.body.failed, [])
    assert.deepEqual(app.archived, [])
    assert.equal(existsSync(join(app.projectDir, app.sessionId, 'session.v4.jsonl.zstd')), true)
    assert.equal(existsSync(join(app.projectDir, app.otherId, 'session.v4.jsonl.zstd')), true)

    await app.rpc({ action: 'delete', id: app.sessionId })
    await app.rpc({ action: 'delete', id: app.otherId })
    const purged = await app.rpc({ action: 'purge-many', ids: [app.sessionId, app.otherId] })
    assert.equal(purged.body.purged.length, 2)
    assert.equal(purged.body.items.length, 0)
    assert.deepEqual(app.archived, [], 'batch purge clears every archived id')

    const empty = await app.rpc({ action: 'restore-many', ids: [] })
    assert.equal(empty.body.ok, false)
    assert.match(empty.body.error, /缺少/)
  } finally {
    await app.close()
  }
})

test('archived sessions can be listed, unarchived and moved to the bin', async () => {
  const app = await harness()
  try {
    await app.registry.archiveSession(app.otherId)
    const listed = await app.rpc({ action: 'archive-list' })
    assert.equal(listed.body.ok, true, JSON.stringify(listed.body))
    assert.equal(listed.body.archived.length, 1)
    assert.equal(listed.body.archived[0].id, app.otherId)
    assert.equal(listed.body.archived[0].sizeBytes, 11)
    assert.equal(listed.body.archived[0].workspacePath, '/Users/me/code/demo')

    const moved = await app.rpc({ action: 'archive-delete', id: app.otherId })
    assert.equal(moved.body.ok, true, JSON.stringify(moved.body))
    assert.equal(moved.body.item.id, app.otherId)
    assert.equal(moved.body.items.length, 1)
    assert.equal(moved.body.archived.length, 0)
    assert.deepEqual(app.archived, [], 'the archive flag is dropped when the files move to the bin')
    assert.equal(existsSync(join(app.projectDir, app.otherId)), false)
    assert.equal(existsSync(join(app.home, 'session-trash', 'items', app.otherId, 'session', 'session.v4.jsonl.zstd')), true)

    await app.registry.archiveSession(app.sessionId)
    const unarchived = await app.rpc({ action: 'archive-restore', id: app.sessionId })
    assert.equal(unarchived.body.ok, true)
    assert.equal(unarchived.body.restored, app.sessionId)
    assert.deepEqual(app.archived, [])
    assert.equal(existsSync(join(app.projectDir, app.sessionId, 'session.v4.jsonl.zstd')), true, 'unarchive keeps the files')
  } finally {
    await app.close()
  }
})

test('the purge-many tool deletes a batch and reports the ids', async () => {
  const app = await harness()
  try {
    await app.rpc({ action: 'delete', id: app.sessionId })
    await app.rpc({ action: 'delete', id: app.otherId })
    const tool = app.tools.find((entry) => entry.name === 'session_trash_purge_many')
    assert.ok(tool, 'missing session_trash_purge_many')
    const message = await tool.execute({ session_ids: [app.sessionId, app.otherId] })
    assert.match(message, /permanently deleted 2 session/)
    assert.equal((await app.rpc({ action: 'list' })).body.items.length, 0)
  } finally {
    await app.close()
  }
})
