import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const DEFAULT_SETTINGS = { retentionDays: 30 }
export const MAX_RETENTION_DAYS = 3650
const DAY_MS = 24 * 60 * 60 * 1000

/** DSH home directory; same rule the Host uses (DSH_HOME overrides ~/.dsh). */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** A user-facing failure with a stable machine code. */
export class TrashError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TrashError'
    this.code = code
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

export function directorySize(dir) {
  let total = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const child = join(dir, entry.name)
    try {
      if (entry.isDirectory()) total += directorySize(child)
      else if (entry.isFile()) total += statSync(child).size
    } catch {
      /* an unreadable member simply does not count */
    }
  }
  return total
}

/** Rename, falling back to copy+delete across filesystems. */
function moveDirectory(from, to) {
  try {
    renameSync(from, to)
    return
  } catch (error) {
    if (error && error.code !== 'EXDEV') throw error
  }
  cpSync(from, to, { recursive: true })
  rmSync(from, { recursive: true, force: true })
}

/**
 * Reject anything that is not a plain session id: the id becomes a directory
 * name under the trash root, so a value like "../../etc" must never reach
 * join(). Ids look like "session-<uuid>".
 */
function assertSessionId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
    throw new TrashError('invalid-id', '缺少或非法会话 id')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes('..')) {
    throw new TrashError('invalid-id', '非法会话 id：' + id)
  }
  return id
}

function normalizeDays(value) {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_SETTINGS.retentionDays
  return Math.min(parsed, MAX_RETENTION_DAYS)
}

/**
 * The on-disk trash. Layout:
 *   <trashRoot>/settings.json               { retentionDays }
 *   <trashRoot>/items/<sessionId>/meta.json  one deleted session
 *   <trashRoot>/items/<sessionId>/session/   the moved session directory
 *
 * Pure node:fs, no DSH imports, so it can be unit tested outside the Host.
 */
export class TrashStore {
  constructor(options = {}) {
    const home = dshHome()
    this.sessionsRoot = options.sessionsRoot || join(home, 'sessions')
    this.trashRoot = options.trashRoot || join(home, 'session-trash')
    this.itemsRoot = join(this.trashRoot, 'items')
    this.settingsFile = join(this.trashRoot, 'settings.json')
  }

  ensure() {
    mkdirSync(this.itemsRoot, { recursive: true })
    return this
  }

  getSettings() {
    const stored = readJson(this.settingsFile, {})
    return { retentionDays: normalizeDays(stored.retentionDays ?? DEFAULT_SETTINGS.retentionDays) }
  }

  setSettings(patch = {}) {
    const next = { ...this.getSettings() }
    const changed = patch.retentionDays !== undefined
    if (changed) next.retentionDays = normalizeDays(patch.retentionDays)
    writeJson(this.settingsFile, next)
    if (changed) this.applyRetention()
    return next
  }

  /** ISO time when an item deleted at deletedAt becomes purgeable (null = keep forever). */
  expiresAtFor(deletedAt) {
    const days = this.getSettings().retentionDays
    if (!days) return null
    const time = Date.parse(deletedAt)
    if (!Number.isFinite(time)) return null
    return new Date(time + days * DAY_MS).toISOString()
  }

  /** Every trashed session, newest deletion first. */
  list() {
    if (!existsSync(this.itemsRoot)) return []
    const items = []
    for (const name of readdirSync(this.itemsRoot)) {
      const itemDir = join(this.itemsRoot, name)
      try {
        if (!statSync(itemDir).isDirectory()) continue
      } catch {
        continue
      }
      const meta = readJson(join(itemDir, 'meta.json'), null)
      if (!meta || !meta.id) continue
      items.push({ ...meta, hasFiles: existsSync(join(itemDir, 'session')) })
    }
    items.sort((left, right) => String(right.deletedAt).localeCompare(String(left.deletedAt)))
    return items
  }

  get(id) {
    return this.list().find((item) => item.id === id) || null
  }

  /** Absolute directory of one bin entry; refuses ids that could escape the root. */
  itemDirOf(id) {
    return join(this.itemsRoot, assertSessionId(id))
  }

  /** Find a live session directory: <sessionsRoot>/<project>/<sessionId>. */
  locate(id) {
    assertSessionId(id)
    if (!existsSync(this.sessionsRoot)) return null
    for (const name of readdirSync(this.sessionsRoot)) {
      const projectDir = join(this.sessionsRoot, name)
      try {
        if (!statSync(projectDir).isDirectory()) continue
      } catch {
        continue
      }
      const sessionDir = join(projectDir, id)
      if (existsSync(sessionDir)) return { projectDir, sessionDir }
    }
    return null
  }

  /** Move a live session into the trash and write its metadata. */
  moveToTrash(input = {}) {
    const id = assertSessionId(input.id)
    if (this.get(id)) throw new TrashError('already-trashed', '该会话已经在回收站里了')
    const located = this.locate(id)
    if (!located) throw new TrashError('session-not-found', '找不到这个会话的存储目录：' + id)
    this.ensure()
    const itemDir = join(this.itemsRoot, id)
    mkdirSync(itemDir, { recursive: true })
    const sizeBytes = directorySize(located.sessionDir)
    try {
      moveDirectory(located.sessionDir, join(itemDir, 'session'))
    } catch (error) {
      rmSync(itemDir, { recursive: true, force: true })
      throw error
    }
    const deletedAt = new Date().toISOString()
    const meta = {
      id,
      title: input.title || id,
      workspacePath: input.workspacePath || null,
      projectDir: located.projectDir,
      projectName: basename(located.projectDir),
      deletedAt,
      expiresAt: this.expiresAtFor(deletedAt),
      sizeBytes,
    }
    writeJson(join(itemDir, 'meta.json'), meta)
    return meta
  }

  /** Move a trashed session back to its original project directory. */
  restore(id) {
    assertSessionId(id)
    const item = this.get(id)
    if (!item) throw new TrashError('not-trashed', '回收站里没有这个会话：' + id)
    const itemDir = this.itemDirOf(id)
    const from = join(itemDir, 'session')
    if (!existsSync(from)) throw new TrashError('files-missing', '回收站条目缺少会话文件，无法恢复')
    const projectDir = item.projectDir || join(this.sessionsRoot, item.projectName || '')
    mkdirSync(projectDir, { recursive: true })
    const to = join(projectDir, id)
    if (existsSync(to)) throw new TrashError('target-exists', '原位置已存在同名会话目录，请先处理：' + to)
    moveDirectory(from, to)
    rmSync(itemDir, { recursive: true, force: true })
    return { id, projectDir, sessionDir: to }
  }

  /** Delete one trashed session for good. */
  purge(id) {
    let itemDir
    try {
      itemDir = this.itemDirOf(id)
    } catch {
      return false
    }
    if (!existsSync(itemDir)) return false
    rmSync(itemDir, { recursive: true, force: true })
    return true
  }

  /** Delete everything in the trash. */
  empty() {
    let purged = 0
    for (const item of this.list()) {
      if (this.purge(item.id)) purged += 1
    }
    return purged
  }

  /** Purge every item whose retention window has elapsed. */
  purgeExpired(now = Date.now()) {
    const purged = []
    for (const item of this.list()) {
      if (!item.expiresAt) continue
      const at = Date.parse(item.expiresAt)
      if (Number.isFinite(at) && at <= now) {
        if (this.purge(item.id)) purged.push(item.id)
      }
    }
    return purged
  }

  /** Recompute expiresAt for every item after the retention setting changed. */
  applyRetention() {
    for (const item of this.list()) {
      const expiresAt = this.expiresAtFor(item.deletedAt)
      if (expiresAt === item.expiresAt) continue
      const { hasFiles, ...meta } = item
      writeJson(join(this.itemsRoot, item.id, 'meta.json'), { ...meta, expiresAt })
    }
    return this.list()
  }
}
