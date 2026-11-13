// dsh-shorekeeper-k20 — 主屏布局页。
//
// 侧栏「主屏布局」。读手机 BackgroundServer 的画布/槽位/默认值，
// 保存走 /k20-layout，写进本进程网关并落盘。不经过 hub。

window.__ModuleLoader__.load({
  id: 'dsh-shorekeeper-k20',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useCallback, useRef } = React
    const h = React.createElement

    const EPS = 1e-4
    const MIN_SIZE = 0.08

    const CSS = `
.k20-layout-root{height:100%;overflow:auto;box-sizing:border-box;padding:20px 24px 40px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.k20-layout-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.k20-layout-title{font-size:16px;font-weight:600;flex:1}
.k20-layout-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer}
.k20-layout-btn:disabled{opacity:.55;cursor:default}
.k20-layout-btn.primary{background:var(--dsw-alias-brand-primary);color:#fff;border-color:transparent}
.k20-layout-msg{color:var(--dsw-alias-label-secondary);font-size:12px;margin-bottom:10px}
.k20-layout-msg.err{color:var(--dsw-alias-danger, #e35d6a)}
.k20-layout-board{position:relative;margin:0 auto;width:100%;max-width:920px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);user-select:none;touch-action:none}
.k20-layout-tile{position:absolute;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-base) 82%, transparent);font-size:12px;cursor:move}
.k20-layout-tile.hidden{border-style:dashed;background:transparent;color:var(--dsw-alias-label-secondary)}
.k20-layout-tile.active{outline:2px solid var(--dsw-alias-brand-primary);z-index:2}
.k20-layout-handle{position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;background:var(--dsw-alias-brand-primary);border-top-left-radius:6px}
.k20-layout-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.k20-layout-chip{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer}
.k20-layout-chip.on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.k20-layout-chip.dim{opacity:.55}
.k20-layout-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}
`

    function unwrap(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
      const inner = value.modules
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner
      return value
    }

    function sameRect(a, b) {
      if (!a || !b) return false
      return (
        Math.abs(a.x - b.x) < EPS &&
        Math.abs(a.y - b.y) < EPS &&
        Math.abs(a.w - b.w) < EPS &&
        Math.abs(a.h - b.h) < EPS &&
        a.visible === b.visible &&
        a.chrome === b.chrome
      )
    }

    function clamp01(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return 0
      if (n < 0) return 0
      if (n > 1) return 1
      return n
    }

    function cleanRect(rect) {
      const next = {
        x: clamp01(rect && rect.x),
        y: clamp01(rect && rect.y),
        w: clamp01(rect && rect.w),
        h: clamp01(rect && rect.h),
        visible: !rect || rect.visible !== false,
      }
      if (rect && typeof rect.chrome === 'boolean') next.chrome = rect.chrome
      return next
    }

    function fit(value, min, max) {
      const upper = Math.max(min, max)
      return Math.min(Math.max(value, min), upper)
    }

    function viewRect(id, draft, defaults) {
      const d = draft[id]
      const def = defaults[id]
      if (!d) return def || { x: 0.1, y: 0.1, w: 0.2, h: 0.15, visible: true, chrome: true }
      if (d.w < 0.05 && def) return { ...def, visible: d.visible, chrome: d.chrome }
      return d
    }

    function LayoutPanel({ call }) {
      const [snap, setSnap] = useState(null)
      const [draft, setDraft] = useState({})
      const [selected, setSelected] = useState(null)
      const [error, setError] = useState(null)
      const [status, setStatus] = useState('')
      const [busy, setBusy] = useState(false)
      const boardRef = useRef(null)
      const drag = useRef(null)

      const load = useCallback(async () => {
        setBusy(true)
        try {
          const value = await call('snapshot')
          const phone = value.phone || {}
          const defaults = unwrap(phone.defaults)
          const modules = unwrap(phone.modules)
          const savedModules = unwrap(value.saved)
          const useSaved = Boolean(value.saved && value.saved.modules)
          const slots = Array.isArray(phone.slots) ? phone.slots : []
          const next = { canvas: phone.canvas || { w: 2230, h: 1025 }, slots, defaults, modules }
          const merged = {}
          for (const slot of slots) {
            // 已保存的覆盖优先。手机上的是「已经画出来的」那版，rev 没超过已套用号时它还是旧的。
            const stored = useSaved ? (savedModules[slot.id] || defaults[slot.id]) : modules[slot.id]
            merged[slot.id] = stored || defaults[slot.id] || {
              x: 0.1, y: 0.1, w: 0.2, h: 0.15, visible: true, chrome: true,
            }
          }
          setSnap(next)
          setDraft(merged)
          setSelected(null)
          setError(value.phoneError || (slots.length === 0 ? '手机没有返回槽位' : null))
          setStatus(value.saved ? `已保存第 ${value.saved.rev} 版` : '')
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [call])

      useEffect(() => { void load() }, [load])

      const defaults = (snap && snap.defaults) || {}

      const beginDrag = (id, mode) => (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId)
        const base = { ...viewRect(id, draft, defaults) }
        if (base.w < MIN_SIZE) base.w = MIN_SIZE
        if (base.h < MIN_SIZE) base.h = MIN_SIZE
        drag.current = { id, mode, px: event.clientX, py: event.clientY, base }
        setSelected(id)
      }

      const onPointerMove = (event) => {
        const current = drag.current
        const box = boardRef.current && boardRef.current.getBoundingClientRect()
        if (!current || !box || box.width <= 0 || box.height <= 0) return
        const dx = (event.clientX - current.px) / box.width
        const dy = (event.clientY - current.py) / box.height
        const base = current.base
        setDraft((prev) => {
          if (current.mode === 'move') {
            return {
              ...prev,
              [current.id]: {
                ...base,
                x: fit(base.x + dx, 0, 1 - base.w),
                y: fit(base.y + dy, 0, 1 - base.h),
              },
            }
          }
          const maxW = Math.max(0, 1 - Math.max(base.x, 0))
          const maxH = Math.max(0, 1 - Math.max(base.y, 0))
          return {
            ...prev,
            [current.id]: {
              ...base,
              w: fit(base.w + dx, Math.min(MIN_SIZE, maxW), maxW),
              h: fit(base.h + dy, Math.min(MIN_SIZE, maxH), maxH),
            },
          }
        })
      }

      const endDrag = () => { drag.current = null }

      const toggle = (key) => {
        if (!selected) return
        setDraft((prev) => {
          const current = viewRect(selected, prev, defaults)
          return { ...prev, [selected]: { ...current, [key]: !current[key] } }
        })
      }

      const save = async () => {
        if (!snap) return
        setBusy(true)
        try {
          const overrides = {}
          for (const [id, rect] of Object.entries(draft)) {
            if (sameRect(rect, defaults[id])) continue
            const def = defaults[id]
            const posSame = def &&
              Math.abs(rect.x - def.x) < EPS &&
              Math.abs(rect.y - def.y) < EPS &&
              Math.abs(rect.w - def.w) < EPS &&
              Math.abs(rect.h - def.h) < EPS
            const clean = cleanRect(rect)
            overrides[id] = posSame
              ? { x: 0, y: 0, w: 0, h: 0, visible: clean.visible, chrome: clean.chrome }
              : clean
          }
          const saved = await call('save', { modules: overrides })
          setStatus(`已保存第 ${saved.rev} 版，手机下一轮会套用`)
          setError(null)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      const slots = (snap && snap.slots) || []
      const canvasW = (snap && snap.canvas && snap.canvas.w) || 2230
      const canvasH = (snap && snap.canvas && snap.canvas.h) || 1025
      const selectedRect = selected ? viewRect(selected, draft, defaults) : null
      const labelOf = (id) => {
        const slot = slots.find((item) => item.id === id)
        return (slot && slot.label) || id
      }

      return h(
        'div',
        { className: 'k20-layout-root' },
        h(
          'div',
          { className: 'k20-layout-toolbar' },
          h('div', { className: 'k20-layout-title' }, '主屏布局'),
          h('button', { className: 'k20-layout-btn', disabled: busy, onClick: () => void load() }, '重读'),
          h('button', {
            className: 'k20-layout-btn',
            disabled: busy || !snap,
            onClick: () => { setDraft({ ...defaults }); setSelected(null) },
          }, '恢复默认'),
          h('button', { className: 'k20-layout-btn primary', disabled: busy || !snap, onClick: () => void save() }, '保存'),
        ),
        status ? h('div', { className: 'k20-layout-msg' }, status) : null,
        error ? h('div', { className: 'k20-layout-msg err' }, error) : null,
        snap && slots.length > 0
          ? h(
            React.Fragment,
            null,
            h(
              'div',
              {
                className: 'k20-layout-board',
                ref: boardRef,
                style: { aspectRatio: `${canvasW} / ${canvasH}` },
                onPointerMove,
                onPointerUp: endDrag,
                onPointerCancel: endDrag,
              },
              slots.map((slot) => {
                const rect = viewRect(slot.id, draft, defaults)
                const active = selected === slot.id
                return h(
                  'div',
                  {
                    key: slot.id,
                    className: `k20-layout-tile${rect.visible ? '' : ' hidden'}${active ? ' active' : ''}`,
                    style: {
                      left: `${rect.x * 100}%`,
                      top: `${rect.y * 100}%`,
                      width: `${rect.w * 100}%`,
                      height: `${rect.h * 100}%`,
                    },
                    onPointerDown: beginDrag(slot.id, 'move'),
                  },
                  `${slot.label}${rect.visible ? '' : ' · 隐'}${rect.chrome ? '' : ' · 裸'}`,
                  active
                    ? h('span', { className: 'k20-layout-handle', onPointerDown: beginDrag(slot.id, 'resize') })
                    : null,
                )
              }),
            ),
            h(
              'div',
              { className: 'k20-layout-chips' },
              slots.map((slot) => {
                const rect = viewRect(slot.id, draft, defaults)
                return h(
                  'button',
                  {
                    key: slot.id,
                    className: `k20-layout-chip${selected === slot.id ? ' on' : ''}${rect.visible ? '' : ' dim'}`,
                    onClick: () => setSelected(selected === slot.id ? null : slot.id),
                  },
                  `${slot.label}${rect.visible ? '' : '（隐）'}`,
                )
              }),
            ),
            selected && selectedRect
              ? h(
                'div',
                { className: 'k20-layout-bar' },
                h('strong', null, labelOf(selected)),
                h('span', null, `${Math.round(selectedRect.w * 100)}×${Math.round(selectedRect.h * 100)}%`),
                h('button', { className: 'k20-layout-btn', onClick: () => toggle('visible') }, selectedRect.visible ? '显示中' : '已隐藏'),
                h('button', { className: 'k20-layout-btn', onClick: () => toggle('chrome') }, selectedRect.chrome ? '有边框' : '无边框'),
                h('span', { className: 'k20-layout-msg' }, '拖卡片移动，拖右下角缩放'),
              )
              : h('div', { className: 'k20-layout-msg' }, '点一个磁贴再拖。保存只提交改过的槽位。'),
          )
          : h('div', { className: 'k20-layout-msg' }, busy ? '正在读手机…' : '还没有布局数据'),
      )
    }

    function PanelIcon() {
      return h(
        'svg',
        { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 },
        h('rect', { x: 2, y: 2, width: 6, height: 6, rx: 1 }),
        h('rect', { x: 10, y: 2, width: 6, height: 4, rx: 1 }),
        h('rect', { x: 10, y: 8, width: 6, height: 8, rx: 1 }),
        h('rect', { x: 2, y: 10, width: 6, height: 6, rx: 1 }),
      )
    }

    const inject = ['connection', 'slots']

    function apply(ctx) {
      ctx.effect(() => {
        const element = document.createElement('style')
        element.setAttribute('data-plugin', 'dsh-shorekeeper-k20-layout')
        element.textContent = CSS
        document.head.appendChild(element)
        return () => element.remove()
      }, 'k20-layout: styles')

      const connection = ctx.get('connection')
      const call = async (action, payload) => {
        const res = await connection.rpc.call('/k20-layout', action, payload || {})
        if (!res || typeof res !== 'object' || res.ok !== true) {
          throw new Error((res && res.error && res.error.message) || '主屏布局调用失败')
        }
        return res.value
      }

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'k20-layout',
            order: 44,
            label: () => '主屏布局',
          },
          PanelIcon,
        ),
      )

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: 'k20-layout',
            inject: () => ({ call }),
          },
          LayoutPanel,
        ),
      )
    }

    return { apply, inject }
  },
})
