import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { TrashStore } from '../trash-store.js'

const DAY_MS = 24 * 60 * 60 * 1000

function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-trash-test-'))
  const sessionsRoot = join(root, 'sessions')
  const trashRoot = join(root, 'session-trash')
  const projectDir = join(sessionsRoot, '--Users-me-code-demo--')
  const sessionId = 'session-11112222-3333-4444-5555-666677778888'
  const sessionDir = join(projectDir, sessionId)
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd'), 'x'.repeat(64))
  writeFileSync(join(sessionDir, 'session.lock'), '')
  const store = new TrashStore({ sessionsRoot, trashRoot })
  store.ensure()
  if (options.retentionDays !== undefined) store.setSettings({ retentionDays: options.retentionDays })
  return { root, sessionsRoot, trashRoot, projectDir, sessionId, sessionDir, store }
}

function cleanup(context) {
  rmSync(context.root, { recursive: true, force: true })
}

test('moveToTrash moves the session directory and records metadata', () => {
  const context = fixture()
  try {
    const meta = context.store.moveToTrash({ id: context.sessionId, title: '演示会话', workspacePath: '/Users/me/code/demo' })
    assert.equal(meta.id, context.sessionId)
    assert.equal(meta.title, '演示会话')
    assert.equal(meta.workspacePath, '/Users/me/code/demo')
    assert.equal(meta.projectName, '--Users-me-code-demo--')
    assert.equal(meta.sizeBytes, 64)
    assert.equal(context.store.locate(context.sessionId), null)
    assert.equal(existsSync(context.sessionDir), false)
    assert.equal(existsSync(join(context.trashRoot, 'items', context.sessionId, 'session', 'session.v4.jsonl.zstd')), true)
    const listed = context.store.list()
    assert.equal(listed.length, 1)
    assert.equal(listed[0].hasFiles, true)
    assert.equal(listed[0].expiresAt, new Date(Date.parse(meta.deletedAt) + 30 * DAY_MS).toISOString())
  } finally {
    cleanup(context)
  }
})

test('moveToTrash rejects unknown and duplicate sessions', () => {
  const context = fixture()
  try {
    assert.throws(() => context.store.moveToTrash({ id: 'session-missing' }), /找不到/)
    context.store.moveToTrash({ id: context.sessionId })
    assert.throws(() => context.store.moveToTrash({ id: context.sessionId }), /已经在回收站/)
  } finally {
    cleanup(context)
  }
})

test('restore puts the session back where it came from', () => {
  const context = fixture()
  try {
    context.store.moveToTrash({ id: context.sessionId })
    const restored = context.store.restore(context.sessionId)
    assert.equal(restored.sessionDir, context.sessionDir)
    assert.equal(existsSync(join(context.sessionDir, 'session.v4.jsonl.zstd')), true)
    assert.equal(context.store.list().length, 0)
    assert.equal(existsSync(join(context.trashRoot, 'items', context.sessionId)), false)
  } finally {
    cleanup(context)
  }
})

test('restore keeps the deleted title only in metadata and tolerates an existing target', () => {
  const context = fixture()
  try {
    context.store.moveToTrash({ id: context.sessionId, title: '旧标题' })
    mkdirSync(context.sessionDir, { recursive: true })
    assert.throws(() => context.store.restore(context.sessionId), /已存在同名会话目录/)
  } finally {
    cleanup(context)
  }
})

test('purge and empty remove trash items permanently', () => {
  const context = fixture()
  try {
    const second = 'session-99990000-3333-4444-5555-666677778888'
    const secondDir = join(context.projectDir, second)
    mkdirSync(secondDir, { recursive: true })
    writeFileSync(join(secondDir, 'session.v4.jsonl.zstd'), 'y')
    context.store.moveToTrash({ id: context.sessionId })
    context.store.moveToTrash({ id: second })
    assert.equal(context.store.list().length, 2)
    assert.equal(context.store.purge(context.sessionId), true)
    assert.equal(context.store.purge(context.sessionId), false)
    assert.equal(context.store.list().length, 1)
    assert.equal(context.store.empty(), 1)
    assert.equal(context.store.list().length, 0)
  } finally {
    cleanup(context)
  }
})

test('retention settings drive expiresAt and purgeExpired', () => {
  const context = fixture()
  try {
    context.store.setSettings({ retentionDays: 0 })
    const forever = context.store.moveToTrash({ id: context.sessionId })
    assert.equal(forever.expiresAt, null)
    assert.deepEqual(context.store.purgeExpired(Date.now() + 365 * DAY_MS), [])

    const settings = context.store.setSettings({ retentionDays: 7 })
    assert.equal(settings.retentionDays, 7)
    const item = context.store.get(context.sessionId)
    assert.equal(item.expiresAt, new Date(Date.parse(item.deletedAt) + 7 * DAY_MS).toISOString())
    assert.deepEqual(context.store.purgeExpired(Date.now() + 8 * DAY_MS), [context.sessionId])
    assert.equal(context.store.list().length, 0)
  } finally {
    cleanup(context)
  }
})

test('path-like ids never escape the trash root', () => {
  const context = fixture()
  try {
    // A malicious/confused agent tool call must not be able to delete outside ~/.dsh/session-trash.
    assert.equal(context.store.purge('../../evil'), false)
    assert.equal(context.store.purge('..'), false)
    assert.equal(context.store.purge(''), false)
    assert.throws(() => context.store.moveToTrash({ id: '../evil' }), /非法会话 id/)
    assert.throws(() => context.store.restore('a/b'), /非法会话 id/)
    assert.throws(() => context.store.locate('..'), /非法会话 id/)
    assert.equal(existsSync(join(context.root, 'evil')), false)
  } finally {
    cleanup(context)
  }
})

test('settings are persisted and clamped', () => {
  const context = fixture()
  try {
    assert.equal(context.store.getSettings().retentionDays, 30)
    assert.equal(context.store.setSettings({ retentionDays: -5 }).retentionDays, 30)
    assert.equal(context.store.setSettings({ retentionDays: 99999 }).retentionDays, 3650)
    assert.equal(JSON.parse(readFileSync(context.store.settingsFile, 'utf8')).retentionDays, 3650)
    const reopened = new TrashStore({ sessionsRoot: context.sessionsRoot, trashRoot: context.trashRoot })
    assert.equal(reopened.getSettings().retentionDays, 3650)
  } finally {
    cleanup(context)
  }
})
