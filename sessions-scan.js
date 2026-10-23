import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { directorySize } from './trash-store.js'

/**
 * Read-only facts about sessions that still live in the DSH session root.
 * Pure node:fs, no DSH imports, so the Host route can describe archived and
 * active sessions without the session persistence service.
 */

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function isSessionId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 200 && SESSION_ID.test(id) && !id.includes('..')
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/**
 * The workspace registry's durable state: which sessions are archived, pinned,
 * and which workspace record owns each session. Only ids that are safe as
 * directory names are kept, because the same values reach fs.join() later.
 */
export function readWorkspaceState(home) {
  const data = readJson(join(home, 'storages', 'workspace.json'), null)
  const global = (data && data.global) || {}
  const archived = Array.isArray(global.archivedSessionIds) ? global.archivedSessionIds.filter(isSessionId) : []
  const pinned = Array.isArray(global.pinnedSessionIds) ? global.pinnedSessionIds.filter(isSessionId) : []
  const workspaces = []
  const table = data && data.tables && data.tables.workspaces
  const rows = Array.isArray(table) ? table : Object.values(table || {})
  for (const row of rows) {
    if (!row || typeof row.path !== 'string') continue
    workspaces.push({
      path: row.path,
      title: typeof row.title === 'string' && row.title ? row.title : basename(row.path),
      sessionIds: Array.isArray(row.sessionIds) ? row.sessionIds.filter(isSessionId) : [],
    })
  }
  const paths = new Map()
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) if (!paths.has(id)) paths.set(id, workspace.path)
  }
  return { archived, pinned, workspaces, paths }
}

/** Every session directory under sessionsRoot: id -> { dir, projectDir }. */
export function scanSessionDirs(sessionsRoot) {
  const found = new Map()
  let projects
  try {
    projects = readdirSync(sessionsRoot, { withFileTypes: true })
  } catch {
    return found
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectDir = join(sessionsRoot, project.name)
    let entries
    try {
      entries = readdirSync(projectDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !isSessionId(entry.name)) continue
      found.set(entry.name, { dir: join(projectDir, entry.name), projectDir })
    }
  }
  return found
}

/**
 * Best-effort title from the projection cache. DSH writes it lazily, and the
 * record carries its own identity, so a missing or stale cache only means the
 * caller falls back to the session id.
 */
export function readCachedTitle(home, id) {
  if (!isSessionId(id)) return null
  const data = readJson(join(home, 'storages', 'session_projcache', 'sessions', id + '.json'), null)
  const rows = data && data.record && data.record.rows
  const title = rows && rows.title ? rows.title.val : null
  return typeof title === 'string' && title.trim() ? title.trim() : null
}

/** One session's display facts; a missing directory reports size 0 and present:false. */
export function describeSession(home, id, entry, state) {
  const workspacePath = (state && state.paths.get(id)) || null
  return {
    id,
    title: readCachedTitle(home, id) || id,
    workspacePath,
    projectName: workspacePath ? basename(workspacePath) : null,
    sizeBytes: entry ? directorySize(entry.dir) : 0,
    present: Boolean(entry),
  }
}
