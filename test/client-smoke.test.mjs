import assert from 'node:assert/strict'
import { test } from 'node:test'

/**
 * Executes client.js the way the DSH web client loader does (window.__ModuleLoader__),
 * with a fake require + a fake slots service, and checks the registrations.
 */
/** The bundle is an ES module, so Node caches it: build the factory once. */
let cachedBundle = null

function loadClientBundle() {
  if (cachedBundle) return Promise.resolve(cachedBundle)
  let payload = null
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        payload = definition
      },
    },
  }
  const reactStub = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: Symbol('Fragment'),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
  }
  const require = (specifier) => {
    if (specifier === 'react') return reactStub
    throw new Error('unexpected require: ' + specifier)
  }
  return import(new URL('../client.js', import.meta.url).href).then(() => {
    assert.ok(payload, 'client.js did not call window.__ModuleLoader__.load')
    cachedBundle = payload.factory(require)
    return cachedBundle
  })
}

test('client bundle registers the menu items, the panel-list entry and the panel page', async () => {
  const plugin = await loadClientBundle()
  assert.deepEqual(plugin.inject, ['slots', 'layout'])
  assert.equal(typeof plugin.apply, 'function')

  const registrations = []
  const injected = []
  const ctx = {
    layout: { selectPanel() {} },
    slots: {
      inject(name, callback) {
        injected.push(name)
        const dispose = callback()
        assert.equal(typeof dispose, 'function', 'slot callback must return a disposer')
        return dispose
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  assert.deepEqual(injected, [
    'sidebar.workspaces.session.menu.item',
    'sidebar.workspaces.session.menu.item',
    'sidebar.panellist',
    'main',
  ])

  const find = (predicate) => {
    const hit = registrations.find((entry) => predicate(entry.options))
    assert.ok(hit, 'missing registration')
    return hit
  }
  const archiveItem = find((options) => options.id === 'session-trash.archive')
  const deleteItem = find((options) => options.id === 'session-trash.delete')
  const panellist = find((options) => options.name === 'sidebar.panellist')
  const page = find((options) => options.name === 'main')

  // The bin itself is reached from the panellist icon, so the row menu must not
  // carry a redundant "open the bin" item.
  assert.equal(registrations.some((entry) => entry.options.id === 'session-trash.open'), false)
  assert.equal(archiveItem.options.name, 'sidebar.workspaces.session.menu.item')
  assert.equal(archiveItem.options.order, 461)
  assert.equal(deleteItem.options.order, 470)
  assert.equal(panellist.options.id, 'session-trash')
  assert.equal(panellist.options.label, '回收站')
  assert.equal(page.options.key, 'session-trash')
  for (const entry of registrations) assert.equal(typeof entry.component, 'function')

  // Business faces the slot machinery injects into each component.
  const deleteFace = deleteItem.options.inject()
  assert.equal(typeof deleteFace.requestDelete, 'function')
  assert.equal(typeof archiveItem.options.inject().openTrash, 'function')

  // The archive item opens the bin already switched to the archive tab.
  const tabs = []
  globalThis.window.CustomEvent = class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init && init.detail }
  }
  globalThis.window.dispatchEvent = (event) => tabs.push(event.detail && event.detail.tab)
  globalThis.setTimeout = (fn) => { fn(); return 0 }
  archiveItem.options.inject().openTrash('archive')
  assert.deepEqual(tabs, ['archive'])

  // Components must render a plain element tree with the fake React.
  const deleteTree = deleteItem.component({
    sessionId: 'session-1',
    displayTitle: '标题',
    requestDelete: async () => {},
  })
  assert.ok(deleteTree, 'delete menu item rendered nothing')
  const pageTree = page.component({})
  assert.equal(pageTree.props.className, 'dshst-page')
  assert.ok(Array.isArray(pageTree.children))
})

function fakeDocument() {
  const nodes = new Map()
  const make = (tagName) => ({
    tagName,
    id: '',
    className: '',
    textContent: '',
    attrs: {},
    children: [],
    setAttribute(name, value) { this.attrs[name] = value },
    appendChild(child) {
      this.children.push(child)
      if (child && child.id) nodes.set(child.id, child)
      return child
    },
  })
  return {
    head: make('head'),
    body: make('body'),
    getElementById: (id) => nodes.get(id) || null,
    createElement: (tagName) => make(tagName),
    querySelector: () => null,
  }
}

const textsOf = (node) => {
  if (node === null || node === undefined) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(textsOf)
  return textsOf(node.children)
}

test('the row menu moves a session to the bin in one click and reports it as a toast', async () => {
  const plugin = await loadClientBundle()
  const registrations = []
  plugin.apply({
    layout: {},
    slots: {
      inject(name, callback) { return callback() },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  })
  const deleteItem = registrations.find((entry) => entry.options.id === 'session-trash.delete')
  const page = registrations.find((entry) => entry.options.name === 'main')
  assert.ok(deleteItem && page, 'missing registrations')

  globalThis.document = fakeDocument()
  globalThis.setTimeout = () => 0
  try {
    const calls = []
    const tree = deleteItem.component({
      sessionId: 'session-1',
      displayTitle: '演示会话',
      requestDelete: async (sessionId, displayTitle) => { calls.push([sessionId, displayTitle]) },
    })
    assert.equal(tree.props['data-danger'], 'true')
    assert.deepEqual(textsOf(tree), ['删除会话'], 'the label must not ask for a second click')
    await tree.props.onClick()
    assert.deepEqual(calls, [['session-1', '演示会话']], 'one click must be enough')

    const toast = globalThis.document.getElementById('dsh-session-trash-toast')
    assert.ok(toast, 'a successful delete must leave a toast behind')
    assert.equal(toast.attrs['data-tone'], 'success')
    assert.match(toast.textContent, /已移入回收站.*演示会话.*恢复/)

    const failing = deleteItem.component({
      sessionId: 'session-2',
      displayTitle: '跑着的会话',
      requestDelete: async () => { throw new Error('这个会话还有正在运行的工作，先停止它再删除。') },
    })
    await failing.props.onClick()
    assert.equal(toast.attrs['data-tone'], 'error')
    assert.match(toast.textContent, /正在运行的工作/)

    // No destructive button may still use the old "click again" confirmation.
    // The panel remembers the tab requested by a menu item, so reset it first.
    registrations.find((entry) => entry.options.id === 'session-trash.archive')
      .options.inject().openTrash('trash')
    const panelTexts = textsOf(page.component({}))
    assert.equal(panelTexts.some((text) => text.includes('再点一次')), false)
    assert.ok(panelTexts.includes('彻底删除选中'))
  } finally {
    delete globalThis.document
  }
})

test('client bundle loads without touching the real dom at import time', async () => {
  const fs = await import('node:fs')
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.ok(source.startsWith("window.__ModuleLoader__.load({"))
  assert.ok(source.includes('document.'), 'the style injector should touch the document lazily')
})
