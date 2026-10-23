import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { defineTool } from './tool-schema.js'

import { describeSession, readCachedTitle, readWorkspaceState, scanSessionDirs } from './sessions-scan.js'
import { TrashError, TrashStore, dshHome } from './trash-store.js'

export const name = 'session-trash'
// webServer serves the panel + menu; the two DSH services let us archive a
// session (so it leaves the sidebar) and find the session log root.
export const inject = ['tools', 'webServer', 'workspaceRegistry', 'sessionPersistence']

const ROUTE = '/api/session-trash'
const JSON_LIMIT = 256 * 1024
const SWEEP_INTERVAL_MS = 60 * 60 * 1000
const FIRST_SWEEP_DELAY_MS = 10 * 1000

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'])

function hostnameOnly(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return ''
  if (text.startsWith('[')) {
    const end = text.indexOf(']')
    return end > 0 ? text.slice(0, end + 1).toLowerCase() : text.toLowerCase()
  }
  const colon = text.lastIndexOf(':')
  return (colon > 0 ? text.slice(0, colon) : text).toLowerCase()
}

/**
 * The desktop shell talks to this route the way the web UI does, but it does
 * not always send an Origin header and does not always spell the loopback
 * host the same way as Host (127.0.0.1 vs localhost, proxy port vs shell
 * port). Rejecting those broke every write from the real client, so the rule
 * is now: reject only what a hostile web page can actually produce.
 */
function sameOrigin(req) {
  const headers = (req && req.headers) || {}
  const raw = headers.origin
  // Browsers omit Origin on same-origin GET/HEAD; nothing to compare against.
  if (raw === undefined || raw === null || raw === '') return true
  const text = String(raw).trim()
  if (text === '') return true
  const site = typeof headers['sec-fetch-site'] === 'string' ? headers['sec-fetch-site'] : ''
  // Origin: null cannot be resolved, so trust the browser's own verdict; the
  // JSON content-type guard below is the real anti-CSRF line of defence.
  if (text.toLowerCase() === 'null') return site !== 'cross-site'
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    return false
  }
  // Only a web page can forge an http(s) origin; a custom scheme can only come
  // from the desktop shell, which is local by definition.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
  if (site && site !== 'same-origin' && site !== 'same-site' && site !== 'none') return false
  const host = headers.host
  if (typeof host !== 'string' || !host) return true
  if (parsed.host.toLowerCase() === host.toLowerCase()) return true
  // Same loopback server reached under another name/port is still local.
  const originName = parsed.hostname.toLowerCase()
  const requestName = hostnameOnly(host)
  return LOOPBACK_HOSTS.has(originName) && LOOPBACK_HOSTS.has(requestName)
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function readJsonBody(req, limit = JSON_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new TrashError('payload-too-large', '请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new TrashError('invalid-json', '请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0
  if (size < 1024) return size + ' B'
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
  if (size < 1024 * 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + ' MB'
  return (size / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

export function apply(ctx) {
  const home = dshHome()
  const store = new TrashStore({
    sessionsRoot: (ctx.sessionPersistence && ctx.sessionPersistence.root) || join(home, 'sessions'),
    trashRoot: join(home, 'session-trash'),
  })
  store.ensure()

  const effect = (run) => {
    if (typeof ctx.effect === 'function') return ctx.effect(run)
    return run()
  }
  const log = (level, message) => {
    try {
      const logger = typeof ctx.logger === 'function' ? ctx.logger(name) : ctx.logger
      if (logger && typeof logger[level] === 'function') logger[level](message)
    } catch {
      /* logging must never break the plugin */
    }
  }

  // ---- workspace archive integration -------------------------------------
  const isArchived = (id) => {
    const registry = ctx.workspaceRegistry
    const ids = registry && registry.archivedSessionIds
    return Array.isArray(ids) ? ids.includes(id) : false
  }

  async function archive(id) {
    const registry = ctx.workspaceRegistry
    if (!registry || typeof registry.archiveSession !== 'function') return
    if (isArchived(id)) return
    await registry.archiveSession(id)
  }

  async function unarchive(id) {
    const registry = ctx.workspaceRegistry
    if (!registry || typeof registry.unarchiveSession !== 'function') return
    await registry.unarchiveSession(id)
  }

  // Permanent deletion removes the files, so the id must also leave the
  // registry archive set: otherwise workspace.json keeps a ghost entry forever.
  // Removing an id is the one direction the registry performs without an
  // existence check (an archived session whose files are gone still resolves),
  // which is exactly why this cleanup is safe after a purge.
  async function forgetArchive(ids) {
    for (const id of ids) await unarchive(id).catch(() => {})
  }

  function describeError(error) {
    const message = (error && error.message) || String(error)
    const code = error && error.code
    if (code === 'session-active' || /session[\s_-]?active|活动|busy/i.test(message)) {
      return {
        code: 'session-active',
        error: '这个会话还有正在运行的工作，先停止它再删除。',
      }
    }
    return { code: code || 'internal-error', error: message }
  }

  // ---- operations ---------------------------------------------------------
  async function deleteSession(payload) {
    const id = typeof payload.id === 'string' ? payload.id : ''
    if (!id) throw new TrashError('invalid-id', '缺少会话 id')
    const located = store.locate(id)
    if (!located) throw new TrashError('session-not-found', '找不到这个会话的存储目录（可能已被删除）')
    // Archive first: the sidebar drops the row immediately, and the gate keeps
    // any still-running agent from writing into a session whose files moved.
    await archive(id)
    try {
      const item = store.moveToTrash({
        id,
        title: payload.title || readCachedTitle(home, id) || undefined,
        workspacePath: payload.workspacePath || readWorkspaceState(home).paths.get(id) || null,
      })
      return { item }
    } catch (error) {
      await unarchive(id).catch(() => {})
      throw error
    }
  }

  async function restoreSession(payload) {
    const id = typeof payload.id === 'string' ? payload.id : ''
    const restored = store.restore(id)
    await unarchive(id).catch(() => {})
    return { id: restored.id, projectDir: restored.projectDir }
  }

  /** Archived sessions that still have files on disk, described for the panel. */
  function archivedSessions() {
    const state = readWorkspaceState(home)
    const dirs = scanSessionDirs(store.sessionsRoot)
    const rows = []
    for (const id of state.archived) {
      const entry = dirs.get(id)
      if (!entry) continue
      rows.push(describeSession(home, id, entry, state))
    }
    return rows
  }

  /** One round trip for the panel: bin, archive, retention settings and sizes. */
  function panelSnapshot() {
    const state = readWorkspaceState(home)
    const dirs = scanSessionDirs(store.sessionsRoot)
    const archivedIds = new Set(state.archived)
    const items = store.list()
    const archived = []
    let activeCount = 0
    let activeBytes = 0
    for (const [id, entry] of dirs) {
      if (archivedIds.has(id)) continue
      activeCount += 1
      activeBytes += describeSession(home, id, entry, state).sizeBytes
    }
    for (const id of state.archived) {
      const entry = dirs.get(id)
      if (entry) archived.push(describeSession(home, id, entry, state))
    }
    const sum = (rows) => rows.reduce((total, row) => total + (Number(row.sizeBytes) || 0), 0)
    return {
      items,
      settings: store.getSettings(),
      root: store.trashRoot,
      archived,
      stats: {
        trash: { count: items.length, bytes: sum(items) },
        archived: { count: archived.length, bytes: sum(archived) },
        active: { count: activeCount, bytes: activeBytes },
      },
    }
  }

  /** Ids from a batch request, de-duplicated and bounded. */
  function idsOf(payload) {
    const raw = Array.isArray(payload.ids) ? payload.ids : []
    const ids = []
    for (const value of raw) {
      if (typeof value !== 'string' || value.length === 0) continue
      if (!ids.includes(value)) ids.push(value)
    }
    if (ids.length === 0) throw new TrashError('invalid-id', '缺少要处理的会话 id 列表')
    if (ids.length > 1000) throw new TrashError('too-many', '一次最多处理 1000 个会话')
    return ids
  }

  async function purgeSessions(ids) {
    const purged = []
    for (const id of ids) {
      try {
        if (store.purge(id)) purged.push(id)
      } catch {
        /* an unreadable item stays in the bin instead of aborting the batch */
      }
    }
    await forgetArchive(purged)
    return purged
  }

  async function restoreSessions(ids) {
    const restored = []
    const failed = []
    for (const id of ids) {
      try {
        await restoreSession({ id })
        restored.push(id)
      } catch (error) {
        failed.push({ id, error: describeError(error).error })
      }
    }
    return { restored, failed }
  }

  /**
   * Send an archived session to the bin. The archive flag is dropped afterwards:
   * the panel's archive view is driven by the registry set, not by the files.
   */
  async function deleteArchivedSession(payload) {
    const id = typeof payload.id === 'string' ? payload.id : ''
    if (!id) throw new TrashError('invalid-id', '缺少会话 id')
    const located = store.locate(id)
    if (!located) throw new TrashError('session-not-found', '找不到这个会话的存储目录（可能已被删除）')
    const state = readWorkspaceState(home)
    const item = store.moveToTrash({
      id,
      title: payload.title || readCachedTitle(home, id) || undefined,
      workspacePath: payload.workspacePath || state.paths.get(id) || null,
    })
    await forgetArchive([id])
    return { item }
  }

  async function handleAction(payload) {
    const action = payload && payload.action
    switch (action) {
      case 'list':
        // Expired entries are swept on read, so the panel never shows something
        // that is already past its retention window.
        await forgetArchive(store.purgeExpired())
        return { items: store.list(), settings: store.getSettings(), root: store.trashRoot }
      case 'delete':
        return await deleteSession(payload)
      case 'restore': {
        const restored = await restoreSession(payload)
        return { restored: restored.id, items: store.list() }
      }
      case 'purge': {
        const purged = store.purge(payload.id)
        if (purged) await forgetArchive([payload.id])
        return { purged, items: store.list() }
      }
      case 'empty': {
        const ids = store.list().map((item) => item.id)
        const purged = store.empty()
        await forgetArchive(ids)
        return { purged, items: [] }
      }
      case 'settings': {
        const settings = store.setSettings({ retentionDays: payload.retentionDays })
        return { settings, items: store.list() }
      }
      case 'purge-expired': {
        const purged = store.purgeExpired()
        await forgetArchive(purged)
        return { purged, items: store.list() }
      }
      case 'panel':
        // Like 'list', the read sweeps expired entries first so the panel never
        // shows a row that is already past its retention window.
        await forgetArchive(store.purgeExpired())
        return panelSnapshot()
      case 'purge-many': {
        const purged = await purgeSessions(idsOf(payload))
        return { purged, items: store.list() }
      }
      case 'restore-many': {
        const many = await restoreSessions(idsOf(payload))
        return { restored: many.restored, failed: many.failed, items: store.list() }
      }
      case 'archive-list':
        return { archived: archivedSessions() }
      case 'archive-restore': {
        const id = typeof payload.id === 'string' ? payload.id : ''
        if (!id) throw new TrashError('invalid-id', '缺少会话 id')
        await unarchive(id)
        return { restored: id, archived: archivedSessions() }
      }
      case 'archive-delete': {
        const result = await deleteArchivedSession(payload)
        return { item: result.item, items: store.list(), archived: archivedSessions() }
      }
      default:
        throw new TrashError('unknown-action', '未知操作：' + String(action))
    }
  }

  // ---- web route: the client panel + the sidebar menu both use it ---------
  const handler = async (req, res) => {
    if (!sameOrigin(req)) {
      try {
        console.warn('[session-trash] rejected a cross-origin request', {
          origin: req.headers && req.headers.origin,
          host: req.headers && req.headers.host,
          site: req.headers && req.headers['sec-fetch-site'],
        })
      } catch {
        /* logging is best effort */
      }
      sendJson(res, 403, { ok: false, error: '只接受同源请求' })
      return
    }
    try {
      if (req.method === 'GET') {
        const result = await handleAction({ action: 'list' })
        sendJson(res, 200, { ok: true, ...result })
        return
      }
      // A cross-site form or no-cors POST can only send CORS-safelisted
      // content types, so demanding JSON forces a preflight that this route
      // never answers. That, not the Origin header, is what blocks CSRF.
      const contentType = String((req.headers && req.headers['content-type']) || '').toLowerCase()
      if (!contentType.startsWith('application/json')) {
        sendJson(res, 415, { ok: false, error: '请求体必须是 application/json' })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: '只支持 GET 与 POST' })
        return
      }
      const payload = await readJsonBody(req)
      const result = await handleAction(payload)
      sendJson(res, 200, { ok: true, ...result })
    } catch (error) {
      const described = describeError(error)
      log('warn', 'session-trash request failed: ' + described.error)
      sendJson(res, 200, { ok: false, ...described })
    }
  }

  if (ctx.webServer && typeof ctx.webServer.register === 'function') {
    effect(() => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler }))
  } else {
    log('warn', 'session-trash: webServer service is unavailable, only tools are registered')
  }

  // ---- expiry sweeps ------------------------------------------------------
  effect(() => {
    const timer = setInterval(() => {
      try {
        const purged = store.purgeExpired()
        if (purged.length > 0) {
          log('info', 'session-trash: purged ' + purged.length + ' expired session(s)')
          void forgetArchive(purged)
        }
      } catch (error) {
        log('warn', 'session-trash: sweep failed: ' + ((error && error.message) || error))
      }
    }, SWEEP_INTERVAL_MS)
    if (timer.unref) timer.unref()
    return () => clearInterval(timer)
  })

  effect(() => {
    const timer = setTimeout(() => {
      try {
        const purged = store.purgeExpired()
        if (purged.length > 0) void forgetArchive(purged)
      } catch {
        /* best effort */
      }
    }, FIRST_SWEEP_DELAY_MS)
    if (timer.unref) timer.unref()
    return () => clearTimeout(timer)
  })

  // ---- agent tools (also a self-test path right after install) -----------
  const textOutput = (_args, value) => [{ type: 'text', text: String(value == null ? '' : value) }]

  const registerTool = (spec) => {
    ctx.tools.register(defineTool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters || {},
      output: { schema: { type: 'string' }, render: textOutput },
      async execute(args) {
        return spec.run(args || {})
      },
    }))
  }

  registerTool({
    name: 'session_trash_list',
    description: 'List the sessions currently in the DSH recycle bin (deleted sessions awaiting permanent deletion), with their size, deletion time and expiry.',
    parameters: {},
    run() {
      const settings = store.getSettings()
      const items = store.list()
      const lines = items.map((item) => {
        const expiry = item.expiresAt
          ? 'expires ' + new Date(item.expiresAt).toLocaleDateString()
          : 'kept until purged manually'
        return '- ' + item.id + '  "' + item.title + '"  ' + formatBytes(item.sizeBytes) +
          '  deleted ' + new Date(item.deletedAt).toLocaleString() + '  (' + expiry + ')'
      })
      const totalBytes = items.reduce((total, item) => total + (Number(item.sizeBytes) || 0), 0)
      const archived = archivedSessions()
      const archivedBytes = archived.reduce((total, item) => total + (Number(item.sizeBytes) || 0), 0)
      return 'retention: ' + (settings.retentionDays === 0 ? 'never auto-delete' : settings.retentionDays + ' days') +
        '\nbin: ' + store.trashRoot + '\ncount: ' + items.length + '  total size: ' + formatBytes(totalBytes) +
        '\narchived: ' + archived.length + ' session(s), ' + formatBytes(archivedBytes) +
        '\n' + (lines.join('\n') || '(empty)')
    },
  })

  registerTool({
    name: 'session_trash_delete',
    description: 'Move one DSH session into the recycle bin: it disappears from the sidebar, its files are kept in ~/.dsh/session-trash, and it can be restored until the retention window expires.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The session id, such as session-<uuid>.' },
      title: { type: 'string', description: 'A human readable title for the bin entry.' },
    },
    run: async (args) => {
      const result = await deleteSession({ id: args.session_id, title: args.title })
      return 'moved to recycle bin: ' + result.item.id + ' (' + formatBytes(result.item.sizeBytes) + ')'
    },
  })

  registerTool({
    name: 'session_trash_restore',
    description: 'Restore a session from the DSH recycle bin back to its original workspace list.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The session id of a bin entry.' },
    },
    run: async (args) => {
      await restoreSession({ id: args.session_id })
      return 'restored: ' + args.session_id
    },
  })

  registerTool({
    name: 'session_trash_purge',
    description: 'Permanently delete one session from the DSH recycle bin. The session log files are destroyed and cannot be recovered.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The session id of a bin entry.' },
    },
    run: async (args) => {
      const purged = await purgeSessions([args.session_id])
      return purged.length > 0 ? 'permanently deleted: ' + args.session_id : 'not in the bin: ' + args.session_id
    },
  })

  registerTool({
    name: 'session_trash_purge_many',
    description: 'Permanently delete several sessions from the DSH recycle bin in one call. The session log files are destroyed and cannot be recovered.',
    parameters: {
      session_ids: { type: 'array', items: { type: 'string' }, required: true, description: 'Session ids of bin entries, at most 1000.' },
    },
    run: async (args) => {
      const purged = await purgeSessions(idsOf({ ids: args.session_ids }))
      return 'permanently deleted ' + purged.length + ' session(s)' + (purged.length ? ': ' + purged.join(', ') : '')
    },
  })

  registerTool({
    name: 'session_trash_archive_list',
    description: 'List the sessions hidden in the DSH archive (archived, not deleted), with their workspace, size and id, so they can be managed from the recycle bin.',
    parameters: {},
    run() {
      const archived = archivedSessions()
      const totalBytes = archived.reduce((total, item) => total + (Number(item.sizeBytes) || 0), 0)
      const lines = archived.map((item) => '- ' + item.id + '  "' + item.title + '"  ' + formatBytes(item.sizeBytes) +
        '  ' + (item.workspacePath || 'unknown workspace'))
      return 'archived: ' + archived.length + ' session(s), ' + formatBytes(totalBytes) +
        '\n' + (lines.join('\n') || '(empty)')
    },
  })

  registerTool({
    name: 'session_trash_archive_delete',
    description: 'Move one archived session into the DSH recycle bin. It leaves the archive and can be restored or purged from the bin afterwards.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The session id of an archived session.' },
      title: { type: 'string', description: 'A human readable title for the bin entry.' },
    },
    run: async (args) => {
      const result = await deleteArchivedSession({ id: args.session_id, title: args.title })
      return 'archived session moved to the recycle bin: ' + result.item.id + ' (' + formatBytes(result.item.sizeBytes) + ')'
    },
  })

  registerTool({
    name: 'session_trash_archive_restore',
    description: 'Unarchive a session so it shows up in its workspace list again.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The session id of an archived session.' },
    },
    run: async (args) => {
      await unarchive(args.session_id)
      return 'unarchived: ' + args.session_id
    },
  })

  registerTool({
    name: 'session_trash_empty',
    description: 'Permanently delete every session in the DSH recycle bin.',
    parameters: {},
    run: async () => {
      const ids = store.list().map((item) => item.id)
      const purged = store.empty()
      await forgetArchive(ids)
      return 'permanently deleted ' + purged + ' session(s)'
    },
  })

  registerTool({
    name: 'session_trash_settings',
    description: 'Read or change the recycle bin retention: the number of days before a deleted session is purged automatically (0 = never auto-delete).',
    parameters: {
      retention_days: { type: 'number', description: 'New retention in days, 0..3650. Omit to only read the current value.' },
    },
    run(args) {
      const settings = typeof args.retention_days === 'number'
        ? store.setSettings({ retentionDays: args.retention_days })
        : store.getSettings()
      return 'retention: ' + (settings.retentionDays === 0 ? 'never auto-delete' : settings.retentionDays + ' days')
    },
  })
}
