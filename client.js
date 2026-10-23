window.__ModuleLoader__.load({
  id: '@local/dsh-session-trash',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const PANEL_ID = 'session-trash'
    const ROUTE = '/api/session-trash'
    const STYLE_ID = 'dsh-session-trash-style'
    const TOAST_ID = 'dsh-session-trash-toast'
    const DAY_MS = 24 * 60 * 60 * 1000

    const CSS = `
.dshst-menu-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;line-height:1.4;text-align:left;cursor:pointer}
.dshst-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dshst-menu-item[data-danger=true]:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(214,69,69,.12));color:var(--dsw-alias-state-error-primary,#d64545)}
.dshst-menu-item:disabled{opacity:.6;cursor:default}
.dshst-menu-error{padding:2px 10px 6px;font-size:12px;line-height:1.4;color:var(--dsw-alias-state-error-primary,#d64545)}
.dshst-page{display:flex;flex-direction:column;gap:12px;height:100%;min-height:0;box-sizing:border-box;padding:20px 28px 24px;color:var(--dsw-alias-label-primary,inherit)}
.dshst-page *{box-sizing:border-box}
.dshst-header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.dshst-title{margin:0;font-size:17px;font-weight:600}
.dshst-sub{font-size:12px;color:var(--dsw-alias-label-tertiary,inherit)}
.dshst-stats{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshst-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,inherit);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}
.dshst-chip[data-active=true]{color:var(--dsw-alias-label-primary,inherit);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l3,rgba(127,127,127,.3))}
.dshst-tabs{display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.dshst-tab{padding:6px 12px;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:13px;line-height:1.4;cursor:pointer}
.dshst-tab[data-active=true]{color:var(--dsw-alias-label-primary,inherit);border-bottom-color:var(--dsw-alias-label-primary,currentColor);font-weight:600}
.dshst-tab:disabled{opacity:.5;cursor:default}
.dshst-settings{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:10px;background:var(--dsw-alias-bg-layer-2,transparent);font-size:13px}
.dshst-input{width:78px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.3));border-radius:6px;background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:13px}
.dshst-btn{padding:4px 12px;border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.3));border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;line-height:1.4;white-space:nowrap;cursor:pointer}
.dshst-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dshst-btn:disabled{opacity:.5;cursor:default}
.dshst-btn[data-danger=true]{color:var(--dsw-alias-state-error-primary,#d64545);border-color:var(--dsw-alias-state-error-primary,#d64545)}
.dshst-btn[data-danger=true]:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(214,69,69,.12))}
.dshst-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-tertiary,inherit)}
.dshst-check{width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-label-primary,currentColor);cursor:pointer}
.dshst-list{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.dshst-row{display:flex;align-items:center;gap:10px;padding:12px 4px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.dshst-row[data-selected=true]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06))}
.dshst-row-icon{display:flex;color:var(--dsw-alias-label-tertiary,inherit)}
.dshst-row-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}
.dshst-row-title{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshst-row-meta{font-size:12px;color:var(--dsw-alias-label-tertiary,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshst-empty{padding:36px 4px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-tertiary,inherit)}
.dshst-error{padding:8px 12px;border-radius:8px;font-size:13px;line-height:1.5;color:var(--dsw-alias-state-error-primary,#d64545);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(214,69,69,.1))}
.dshst-hint{padding:8px 12px;border-radius:8px;font-size:13px;line-height:1.5;color:var(--dsw-alias-state-success-primary,#2f9e63);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}
.dshst-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;color:var(--dsw-alias-label-tertiary,inherit)}
.dshst-toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,8px);z-index:2147483000;max-width:min(560px,calc(100vw - 48px));padding:9px 16px;border-radius:999px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#fff);background:var(--dsw-alias-bg-inverse,#2b2b2b);box-shadow:0 8px 24px rgba(0,0,0,.28);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease}
.dshst-toast[data-visible=true]{opacity:1;transform:translate(-50%,0)}
.dshst-toast[data-tone=error]{background:var(--dsw-alias-state-error-primary,#d64545);color:#fff}
.dshst-modal-backdrop{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.42)}
.dshst-modal{width:min(420px,100%);display:flex;flex-direction:column;gap:10px;padding:18px 20px;border-radius:14px;background:var(--dsw-alias-bg-layer-1,#1f1f1f);box-shadow:0 18px 48px rgba(0,0,0,.4);color:var(--dsw-alias-label-primary,inherit)}
.dshst-modal-title{font-size:15px;font-weight:600}
.dshst-modal-body{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,inherit)}
.dshst-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}
`

    function ensureStyle() {
      try {
        if (document.getElementById(STYLE_ID)) return
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        document.head.appendChild(style)
      } catch (error) {
        /* styling is best effort */
      }
    }

    /**
     * Short-lived feedback for actions started outside the panel. The panel
     * has its own inline hint bars, but a menu item closes its menu, so a
     * floating toast is the only place to say what just happened.
     */
    let toastTimer = null
    function showToast(message, tone) {
      if (typeof document === 'undefined' || !document.body) return
      const text = String(message === undefined || message === null ? '' : message)
      if (!text) return
      try {
        ensureStyle()
        let node = document.getElementById(TOAST_ID)
        if (!node) {
          node = document.createElement('div')
          node.id = TOAST_ID
          node.className = 'dshst-toast'
          node.setAttribute('role', 'status')
          document.body.appendChild(node)
        }
        node.textContent = text
        node.setAttribute('data-tone', tone === 'error' ? 'error' : 'success')
        node.setAttribute('data-visible', 'true')
        if (toastTimer !== null) clearTimeout(toastTimer)
        toastTimer = setTimeout(() => {
          toastTimer = null
          try {
            const current = document.getElementById(TOAST_ID)
            if (current) current.setAttribute('data-visible', 'false')
          } catch (error) {
            /* the node may be gone */
          }
        }, 3200)
      } catch (error) {
        /* feedback is best effort */
      }
    }

    const CHANGED_EVENT = 'session-trash:changed'
    const TAB_EVENT = 'session-trash:tab'

    /** Tab requested by a sidebar menu item; the panel may mount after the navigation. */
    let pendingTab = 'trash'
    function requestTab(tab) {
      pendingTab = tab === 'archive' ? 'archive' : 'trash'
      return pendingTab
    }

    /** Tell any mounted panel that the bin changed (the menu edits without it being visible). */
    function announceChange() {
      try {
        window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
      } catch (error) {
        /* older embeddings have no CustomEvent */
      }
    }

    async function call(action, payload, options) {
      const opts = options || {}
      const body = JSON.stringify(Object.assign({ action: action }, payload || {}))
      let response
      try {
        response = await fetch(ROUTE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
        })
      } catch (error) {
        throw new Error('无法连接 DSH 主进程，请确认插件已启用后重启 DSH。')
      }
      let data = null
      try {
        data = await response.json()
      } catch (error) {
        data = null
      }
      if (!data || data.ok !== true) {
        throw new Error((data && data.error) || '操作失败：HTTP ' + response.status)
      }
      if (opts.announce !== false) announceChange()
      return data
    }

    function formatBytes(bytes) {
      const size = Number(bytes) || 0
      if (size < 1024) return size + ' B'
      if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
      if (size < 1024 * 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + ' MB'
      return (size / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    }

    function formatTime(iso) {
      const time = Date.parse(iso)
      if (!Number.isFinite(time)) return String(iso || '')
      try {
        return new Date(time).toLocaleString('zh-CN', { hour12: false })
      } catch (error) {
        return new Date(time).toISOString()
      }
    }

    function remaining(expiresAt) {
      const time = Date.parse(expiresAt)
      if (!Number.isFinite(time)) return '不会自动删除'
      const left = time - Date.now()
      if (left <= 0) return '已过期，等待清理'
      const days = Math.ceil(left / DAY_MS)
      return days >= 1 ? '还剩 ' + days + ' 天' : '不到 1 天'
    }

    function TrashIcon(props) {
      const size = (props && props.size) || 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
      }, h('path', {
        d: 'M3 4.4h10M6.4 4.4V3.2c0-.4.3-.7.7-.7h1.8c.4 0 .7.3.7.7v1.2M4.5 4.4l.5 7.5c0 .7.5 1.2 1.2 1.2h3.6c.7 0 1.2-.5 1.2-1.2l.5-7.5M6.8 6.8v3.9M9.2 6.8v3.9',
        stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    function ArchiveIcon(props) {
      const size = (props && props.size) || 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
      }, h('path', {
        d: 'M2.4 5.2h11.2v7.4c0 .5-.4.9-.9.9H3.3c-.5 0-.9-.4-.9-.9V5.2ZM2 2.8h12v2.4H2V2.8ZM6.4 8h3.2',
        stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    /** Close the sidebar context menu that hosted this item, when the slot exposes it. */
    function useMenuCloser(useMenuOpenState) {
      const setterRef = React.useRef(null)
      try {
        if (typeof useMenuOpenState === 'function') {
          const pair = useMenuOpenState()
          if (pair && typeof pair[1] === 'function') setterRef.current = pair[1]
        }
      } catch (error) {
        setterRef.current = null
      }
      return useCallback(() => {
        const setter = setterRef.current
        if (typeof setter === 'function') {
          try {
            setter(false)
          } catch (error) {
            /* the menu may already be closed */
          }
        }
      }, [])
    }

    function ArchiveOpenMenuItem(props) {
      const openTrash = props && props.openTrash
      return h('button', {
        type: 'button',
        className: 'dshst-menu-item',
        onClick: () => {
          try {
            if (typeof openTrash === 'function') openTrash('archive')
          } catch (error) {
            /* navigation is best effort */
          }
        },
      }, h(ArchiveIcon, { size: 14 }), h('span', null, '查看归档会话'))
    }

    /**
     * Deleting from the row menu is one click: the session lands in the bin
     * (recoverable for the whole retention window), so a second click would be
     * friction rather than safety. Irreversible actions stay confirmed, but in
     * the panel where there is room for a real dialog.
     */
    function TrashDeleteMenuItem(props) {
      const sessionId = props && props.sessionId
      const displayTitle = props && props.displayTitle
      const requestDelete = props && props.requestDelete
      const closeMenu = useMenuCloser(props && props.useMenuOpenState)
      const [busy, setBusy] = useState(false)

      const onClick = async () => {
        if (busy) return
        setBusy(true)
        try {
          await requestDelete(sessionId, displayTitle)
          closeMenu()
          showToast('已移入回收站' + (displayTitle ? '：' + displayTitle : '') + '，可在侧栏「回收站」里恢复')
        } catch (failure) {
          showToast((failure && failure.message) || String(failure), 'error')
          setBusy(false)
        }
      }

      return h('button', {
        type: 'button',
        className: 'dshst-menu-item',
        'data-danger': 'true',
        disabled: busy,
        onClick: onClick,
      }, h(TrashIcon, { size: 14 }), h('span', null, busy ? '正在移入回收站…' : '删除会话'))
    }

    function TrashPanelIcon(props) {
      return h('span', { style: { display: 'flex', alignItems: 'center' } },
        h(TrashIcon, { size: (props && props.size) || 16 }))
    }

    function StatChip(props) {
      return h('span', { className: 'dshst-chip', 'data-active': props.active ? 'true' : 'false' },
        props.label + '：' + props.count + ' 个 · ' + formatBytes(props.bytes))
    }

    /** Modal used for the actions that cannot be undone. */
    function ConfirmDialog(props) {
      const stop = (event) => {
        if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
      }
      return h('div', { className: 'dshst-modal-backdrop', onClick: props.onCancel },
        h('div', { className: 'dshst-modal', role: 'dialog', 'aria-modal': 'true', onClick: stop },
          h('div', { className: 'dshst-modal-title' }, props.title),
          h('div', { className: 'dshst-modal-body' }, props.body),
          h('div', { className: 'dshst-modal-actions' },
            h('button', { type: 'button', className: 'dshst-btn', disabled: props.busy, onClick: props.onCancel }, '取消'),
            h('button', {
              type: 'button',
              className: 'dshst-btn',
              'data-danger': 'true',
              disabled: props.busy,
              onClick: props.onConfirm,
            }, props.busy ? '处理中…' : props.confirmLabel),
          ),
        ),
      )
    }

    function TrashPanel() {
      const [snapshot, setSnapshot] = useState(null)
      const [tab, setTab] = useState(pendingTab)
      const [selected, setSelected] = useState([])
      const [settings, setSettings] = useState({ retentionDays: 30 })
      const [days, setDays] = useState('30')
      const [error, setError] = useState(null)
      const [hint, setHint] = useState(null)
      const [busy, setBusy] = useState(null)
      // Irreversible actions open a real dialog instead of the old "click the
      // same button twice" dance, which nobody could tell apart from a hang.
      const [pending, setPending] = useState(null)
      const daysTouched = React.useRef(false)

      useEffect(() => {
        ensureStyle()
      }, [])

      const load = useCallback(async () => {
        try {
          const data = await call('panel', {}, { announce: false })
          setSnapshot({
            items: Array.isArray(data.items) ? data.items : [],
            archived: Array.isArray(data.archived) ? data.archived : [],
            stats: data.stats || null,
          })
          const next = data.settings || { retentionDays: 30 }
          setSettings(next)
          if (!daysTouched.current) setDays(String(next.retentionDays))
          setError(null)
        } catch (failure) {
          setSnapshot({ items: [], archived: [], stats: null })
          setError((failure && failure.message) || String(failure))
        }
      }, [])

      useEffect(() => {
        load()
        const onChange = () => {
          load()
        }
        window.addEventListener(CHANGED_EVENT, onChange)
        return () => window.removeEventListener(CHANGED_EVENT, onChange)
      }, [load])

      useEffect(() => {
        const onTab = (event) => {
          const next = event && event.detail && event.detail.tab
          if (next === 'trash' || next === 'archive') {
            setTab(next)
            setSelected([])
          }
        }
        window.addEventListener(TAB_EVENT, onTab)
        return () => window.removeEventListener(TAB_EVENT, onTab)
      }, [])

      useEffect(() => {
        setSelected([])
      }, [tab])

      const run = useCallback(async (key, task, done) => {
        setBusy(key)
        setError(null)
        setHint(null)
        try {
          const result = await task()
          await load()
          setSelected([])
          if (typeof done === 'function') done(result)
        } catch (failure) {
          setError((failure && failure.message) || String(failure))
        } finally {
          setBusy(null)
        }
      }, [load])

      const items = (snapshot && snapshot.items) || []
      const archived = (snapshot && snapshot.archived) || []
      const stats = (snapshot && snapshot.stats) || null
      const visible = tab === 'archive' ? archived : items
      const allSelected = visible.length > 0 && visible.every((row) => selected.includes(row.id))
      const selectedCount = selected.length

      const toggle = (id) => {
        setSelected((current) => current.includes(id)
          ? current.filter((value) => value !== id)
          : current.concat(id))
      }
      const toggleAll = () => {
        setSelected(allSelected ? [] : visible.map((row) => row.id))
      }

      const restoreMany = (ids, key) => run(key || 'restore-many', () => call('restore-many', { ids }, { announce: false }), (result) => {
        const restored = (result && result.restored) || []
        const failed = (result && result.failed) || []
        if (restored.length > 0) setHint('已恢复 ' + restored.length + ' 个会话。侧栏若还没出现，刷新页面（⌘R / Ctrl+R）即可。')
        if (failed.length > 0) setError(failed.length + ' 个会话恢复失败：' + failed[0].error)
      })

      const purgeMany = (ids, key) => run(key || 'purge-many', () => call('purge-many', { ids }, { announce: false }), (result) => {
        setHint('已彻底删除 ' + ((result && result.purged) || []).length + ' 个会话，磁盘空间已释放。')
      })

      const unarchiveMany = (ids) => run('archive-restore-many', async () => {
        const failed = []
        for (const id of ids) {
          try {
            await call('archive-restore', { id }, { announce: false })
          } catch (failure) {
            failed.push({ id, error: (failure && failure.message) || String(failure) })
          }
        }
        if (failed.length > 0) throw new Error(failed.length + ' 个会话取消归档失败：' + failed[0].error)
        announceChange()
        return { restored: ids }
      }, (result) => {
        setHint('已取消归档 ' + ((result && result.restored) || []).length + ' 个会话，它们会回到各自的会话列表。')
      })

      const archiveToTrash = (ids) => run('archive-delete-many', async () => {
        const failed = []
        for (const id of ids) {
          try {
            await call('archive-delete', { id }, { announce: false })
          } catch (failure) {
            failed.push({ id, error: (failure && failure.message) || String(failure) })
          }
        }
        announceChange()
        return { moved: ids, failed }
      }, (result) => {
        const failed = (result && result.failed) || []
        setHint('已把 ' + ((result && result.moved) || []).length + ' 个归档会话移入回收站。')
        if (failed.length > 0) setError(failed.length + ' 个会话移动失败：' + failed[0].error)
      })

      const saveSettings = () => run('settings', () => call('settings', { retentionDays: Number(days) }, { announce: false }), () => {
        daysTouched.current = false
        setHint('保留天数已更新：' + (Number(days) === 0 ? '不自动删除' : '删除后 ' + Number(days) + ' 天自动彻底删除'))
      })

      const purgeExpired = () => run('purge-expired', () => call('purge-expired', {}, { announce: false }), (result) => {
        const count = ((result && result.purged) || []).length
        setHint(count > 0 ? '已清理 ' + count + ' 个过期会话。' : '没有过期的会话需要清理。')
      })

      const emptyBin = () => run('empty', () => call('empty', {}, { announce: false }), (result) => {
        setHint('回收站已清空，彻底删除 ' + ((result && result.purged) || 0) + ' 个会话。')
      })

      const askPurge = (ids) => {
        if (!Array.isArray(ids) || ids.length === 0) return
        setPending({ kind: 'purge', ids: ids.slice() })
      }
      const askEmpty = () => {
        if (items.length === 0) return
        setPending({ kind: 'empty', ids: items.map((row) => row.id) })
      }
      const confirmPending = () => {
        if (!pending) return
        const current = pending
        setPending(null)
        if (current.kind === 'empty') emptyBin()
        else purgeMany(current.ids)
      }

      const header = h('div', { className: 'dshst-header' },
        h('h1', { className: 'dshst-title' }, '会话回收站与归档'),
        h('span', { className: 'dshst-sub' }, snapshot === null ? '正在读取…' : '共 ' + (items.length + archived.length) + ' 个可管理的会话'),
      )

      const statsRow = h('div', { className: 'dshst-stats' },
        h(StatChip, { label: '回收站', count: stats ? stats.trash.count : items.length, bytes: stats ? stats.trash.bytes : 0, active: tab === 'trash' }),
        h(StatChip, { label: '归档', count: stats ? stats.archived.count : archived.length, bytes: stats ? stats.archived.bytes : 0, active: tab === 'archive' }),
        stats ? h(StatChip, { label: '活动会话', count: stats.active.count, bytes: stats.active.bytes }) : null,
      )

      const tabs = h('div', { className: 'dshst-tabs' },
        h('button', {
          type: 'button',
          className: 'dshst-tab',
          'data-active': tab === 'trash' ? 'true' : 'false',
          onClick: () => setTab('trash'),
        }, '回收站 (' + items.length + ')'),
        h('button', {
          type: 'button',
          className: 'dshst-tab',
          'data-active': tab === 'archive' ? 'true' : 'false',
          onClick: () => setTab('archive'),
        }, '归档 (' + archived.length + ')'),
      )

      const settingsRow = tab !== 'trash' ? null : h('div', { className: 'dshst-settings' },
        h('span', null, '自动彻底删除：删除后'),
        h('input', {
          className: 'dshst-input',
          type: 'number',
          min: 0,
          max: 3650,
          value: days,
          onChange: (event) => {
            daysTouched.current = true
            setDays(event.target.value)
          },
        }),
        h('span', null, '天（0 = 不自动删除）'),
        h('button', {
          type: 'button',
          className: 'dshst-btn',
          disabled: busy === 'settings',
          onClick: saveSettings,
        }, busy === 'settings' ? '保存中…' : '保存'),
        h('button', {
          type: 'button',
          className: 'dshst-btn',
          disabled: busy === 'refresh',
          onClick: () => run('refresh', () => call('panel', {}, { announce: false })),
        }, busy === 'refresh' ? '刷新中…' : '刷新'),
      )

      const toolbar = h('div', { className: 'dshst-toolbar' },
        h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' } },
          h('input', {
            type: 'checkbox',
            className: 'dshst-check',
            checked: allSelected,
            disabled: visible.length === 0,
            onChange: toggleAll,
          }),
          '全选' + (selectedCount > 0 ? '（已选 ' + selectedCount + '）' : ''),
        ),
        tab === 'trash'
          ? h(React.Fragment, null,
              h('button', {
                type: 'button',
                className: 'dshst-btn',
                disabled: selectedCount === 0 || busy !== null,
                onClick: () => restoreMany(selected.slice()),
              }, busy === 'restore-many' ? '恢复中…' : '恢复选中'),
              h('button', {
                type: 'button',
                className: 'dshst-btn',
                'data-danger': 'true',
                disabled: selectedCount === 0 || busy !== null,
                onClick: () => askPurge(selected.slice()),
              }, busy === 'purge-many' ? '删除中…' : '彻底删除选中'),
              h('button', {
                type: 'button',
                className: 'dshst-btn',
                disabled: busy !== null,
                onClick: purgeExpired,
              }, busy === 'purge-expired' ? '清理中…' : '清理已过期'),
            )
          : h(React.Fragment, null,
              h('button', {
                type: 'button',
                className: 'dshst-btn',
                disabled: selectedCount === 0 || busy !== null,
                onClick: () => unarchiveMany(selected.slice()),
              }, busy === 'archive-restore-many' ? '处理中…' : '取消归档选中'),
              h('button', {
                type: 'button',
                className: 'dshst-btn',
                disabled: selectedCount === 0 || busy !== null,
                onClick: () => archiveToTrash(selected.slice()),
              }, busy === 'archive-delete-many' ? '移动中…' : '移入回收站选中'),
            ),
      )

      const rowNodes = visible.map((row) => {
        const isSelected = selected.includes(row.id)
        const isArchived = tab === 'archive'
        const meta = [
          row.workspacePath || row.projectName,
          formatBytes(row.sizeBytes),
          isArchived ? '已归档 · 不会自动删除' : '删除于 ' + formatTime(row.deletedAt),
          isArchived ? null : remaining(row.expiresAt),
        ].filter(Boolean).join(' · ')
        return h('div', { className: 'dshst-row', key: row.id, 'data-selected': isSelected ? 'true' : 'false' },
          h('input', {
            type: 'checkbox',
            className: 'dshst-check',
            checked: isSelected,
            onChange: () => toggle(row.id),
          }),
          h('span', { className: 'dshst-row-icon' }, isArchived ? h(ArchiveIcon, { size: 18 }) : h(TrashIcon, { size: 18 })),
          h('div', { className: 'dshst-row-main' },
            h('div', { className: 'dshst-row-title', title: row.title }, row.title || row.id),
            h('div', { className: 'dshst-row-meta', title: meta }, meta),
            h('div', { className: 'dshst-row-meta' }, row.id),
          ),
          isArchived
            ? h(React.Fragment, null,
                h('button', {
                  type: 'button',
                  className: 'dshst-btn',
                  disabled: busy !== null,
                  onClick: () => unarchiveMany([row.id]),
                }, '取消归档'),
                h('button', {
                  type: 'button',
                  className: 'dshst-btn',
                  disabled: busy !== null,
                  onClick: () => archiveToTrash([row.id]),
                }, '移入回收站'),
              )
            : h(React.Fragment, null,
                h('button', {
                  type: 'button',
                  className: 'dshst-btn',
                  disabled: busy !== null,
                  onClick: () => restoreMany([row.id], 'restore:' + row.id),
                }, busy === 'restore:' + row.id ? '恢复中…' : '恢复'),
                h('button', {
                  type: 'button',
                  className: 'dshst-btn',
                  'data-danger': 'true',
                  disabled: busy !== null,
                  onClick: () => askPurge([row.id]),
                }, busy === 'purge-many' ? '删除中…' : '彻底删除'),
              ),
        )
      })

      const emptyText = tab === 'archive'
        ? '归档是空的。在侧栏右键会话选「归档」，它会先进入这里，之后可以取消归档或移入回收站。'
        : '回收站是空的。在侧栏右键任意会话选「删除会话」，它会先进入这里，过期后再自动彻底删除。'

      const list = h('div', { className: 'dshst-list' },
        visible.length === 0
          ? h('div', { className: 'dshst-empty' }, snapshot === null ? '正在读取…' : emptyText)
          : rowNodes,
      )

      const footer = h('div', { className: 'dshst-footer' },
        h('span', null, tab === 'archive'
          ? '归档会话仍然占用磁盘；移入回收站后才会按保留天数清理。'
          : '位置：~/.dsh/session-trash · 保留 ' + settings.retentionDays + ' 天'),
        tab === 'trash'
          ? h('button', {
              type: 'button',
              className: 'dshst-btn',
              'data-danger': 'true',
              disabled: items.length === 0 || busy !== null,
              onClick: askEmpty,
            }, busy === 'empty' ? '清空中…' : '清空回收站')
          : null,
      )

      const pendingRow = pending !== null && pending.kind === 'purge' && pending.ids.length === 1
        ? items.find((row) => row.id === pending.ids[0])
        : null
      const dialog = pending === null ? null : h(ConfirmDialog, {
        title: pending.kind === 'empty' ? '清空回收站？' : '彻底删除会话？',
        body: pending.kind === 'empty'
          ? '回收站里的 ' + pending.ids.length + ' 个会话会被彻底删除：磁盘上的会话文件被移除，无法恢复。'
          : pendingRow
            ? '「' + (pendingRow.title || pendingRow.id) + '」会被彻底删除：磁盘上的会话文件被移除，无法恢复。'
            : '选中的 ' + pending.ids.length + ' 个会话会被彻底删除：磁盘上的会话文件被移除，无法恢复。',
        confirmLabel: pending.kind === 'empty' ? '清空回收站' : '彻底删除',
        busy: busy !== null,
        onCancel: () => setPending(null),
        onConfirm: confirmPending,
      })

      return h('div', { className: 'dshst-page' },
        header,
        statsRow,
        tabs,
        settingsRow,
        error ? h('div', { className: 'dshst-error' }, error) : null,
        hint ? h('div', { className: 'dshst-hint' }, hint) : null,
        toolbar,
        list,
        footer,
        dialog,
      )
    }

    /** Register once per slot; a hot reload or a second mount must not throw. */
    function makeRegistrar(ctx) {
      const done = new Set()
      return (slot, options, component) => {
        const key = slot + '#' + (options.id || options.key || '')
        if (done.has(key)) return
        done.add(key)
        try {
          ctx.slots.inject(slot, () => ctx.slots.register(Object.assign({ name: slot }, options), component))
        } catch (error) {
          done.delete(key)
          try {
            console.warn('session-trash: cannot register ' + key, error)
          } catch (ignored) {
            /* logging is best effort */
          }
        }
      }
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        ensureStyle()
        const register = makeRegistrar(ctx)
        const openTrash = (tab) => {
          const next = requestTab(tab)
          try {
            const layout = ctx.layout
            if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
          } catch (error) {
            /* the panel entry may not be mounted yet */
          }
          try {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: { tab: next } }))
            }, 0)
          } catch (error) {
            /* tab switching is best effort */
          }
        }

        // No "open the bin" item here on purpose: the panellist icon already
        // opens the bin, and the row menu keeps only actions that do something
        // to *this* session (view its archive / delete it).
        register('sidebar.workspaces.session.menu.item', {
          id: 'session-trash.archive',
          order: 461,
          registrant: 'dsh-session-trash',
          inject: () => ({ openTrash: openTrash }),
        }, ArchiveOpenMenuItem)

        register('sidebar.workspaces.session.menu.item', {
          id: 'session-trash.delete',
          order: 470,
          registrant: 'dsh-session-trash',
          inject: () => ({
            requestDelete: (sessionId, displayTitle) => call('delete', { id: sessionId, title: displayTitle }),
          }),
        }, TrashDeleteMenuItem)

        register('sidebar.panellist', {
          id: PANEL_ID,
          order: 25,
          label: '回收站',
          registrant: 'dsh-session-trash',
        }, TrashPanelIcon)

        register('main', {
          key: PANEL_ID,
          registrant: 'dsh-session-trash',
        }, TrashPanel)
      },
    }
  },
})
