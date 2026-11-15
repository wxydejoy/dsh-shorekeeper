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
.k20-bg-section{margin-top:28px;padding-top:18px;border-top:1px solid var(--dsw-alias-border-l1);max-width:920px;margin-left:auto;margin-right:auto}
.k20-bg-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px}
.k20-bg-text{width:110px;padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;font-size:12px}
.k20-bg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.k20-bg-card{display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.k20-bg-card.current{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary) inset}
.k20-bg-thumb{position:relative;height:92px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#0b1016;color:#93a4b8;font-size:22px}
.k20-bg-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.k20-bg-meta{display:flex;flex-direction:column;gap:6px;padding:8px;font-size:12px}
.k20-bg-name{line-height:1.3;word-break:break-all}
.k20-bg-sub{color:var(--dsw-alias-label-secondary);font-size:11px}
.k20-bg-actions{display:flex;flex-wrap:wrap;gap:6px}
.k20-bg-badge{position:absolute;left:6px;top:6px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:#fff;font-size:10px}
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
      const [bg, setBg] = useState(null)
      const [bgBusy, setBgBusy] = useState(false)
      const [bgMsg, setBgMsg] = useState('')
      const [bgErr, setBgErr] = useState(null)
      const [realName, setRealName] = useState('守岸人')
      const fileRef = useRef(null)

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

      // ── 背景壁纸：列表走 RPC，字节（缩略图/上传）走 /k20-bg 路由 ──
      const loadBackgrounds = useCallback(async () => {
        setBgBusy(true)
        try {
          setBg(await call('backgrounds'))
          setBgErr(null)
        } catch (err) {
          setBgErr(err instanceof Error ? err.message : String(err))
        } finally {
          setBgBusy(false)
        }
      }, [call])

      useEffect(() => { void loadBackgrounds() }, [loadBackgrounds])

      const bgAction = async (action, payload, note) => {
        setBgBusy(true)
        setBgErr(null)
        setBgMsg('')
        try {
          setBg(await call(action, payload || {}))
          setBgMsg(note || '')
        } catch (err) {
          setBgErr(err instanceof Error ? err.message : String(err))
        } finally {
          setBgBusy(false)
        }
      }

      const uploadBackground = async (file) => {
        if (!file) return
        const who = realName.trim()
        if (who.length < 2) {
          setBgErr('先填署名：2 到 20 个字，不能带数字（手机端会核验）')
          return
        }
        setBgBusy(true)
        setBgErr(null)
        setBgMsg(`正在上传 ${file.name}…`)
        try {
          const query = new URLSearchParams({ name: file.name, realname: who })
          const response = await fetch(`/k20-bg/upload?${query.toString()}`, { method: 'POST', body: file })
          const data = await response.json().catch(() => null)
          if (!response.ok || !data || data.ok !== true) {
            throw new Error((data && data.error) || `上传失败：HTTP ${response.status}`)
          }
          setBg(data.value)
          setBgMsg(`已上传并生效：${file.name}`)
        } catch (err) {
          setBgErr(err instanceof Error ? err.message : String(err))
        } finally {
          setBgBusy(false)
          if (fileRef.current) fileRef.current.value = ''
        }
      }

      const removeBackground = (item) => {
        if (!window.confirm(`删除「${item.name}」？删了就找不回来了。`)) return
        void bgAction('remove', { id: item.id }, `已删除：${item.name}`)
      }

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
      const bgItems = (bg && Array.isArray(bg.items)) ? bg.items : []
      const bgCurrent = (bg && bg.current) || null
      const mediaUrl = (id) => `/k20-bg/media/${encodeURIComponent(id)}`
      const sizeText = (bytes) => {
        const n = Number(bytes)
        if (!Number.isFinite(n) || n <= 0) return ''
        if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
        return `${Math.max(1, Math.round(n / 1024))}KB`
      }

      const backgroundSection = h(
        'div',
        { className: 'k20-bg-section' },
        h(
          'div',
          { className: 'k20-layout-toolbar' },
          h('div', { className: 'k20-layout-title' }, '背景壁纸'),
          h('span', { className: 'k20-bg-sub' }, bgCurrent ? `当前：${bgCurrent}` : '当前：纯色'),
        ),
        h(
          'div',
          { className: 'k20-bg-row' },
          h('button', { className: 'k20-layout-btn', disabled: bgBusy, onClick: () => void loadBackgrounds() }, '刷新'),
          h('input', {
            className: 'k20-bg-text',
            value: realName,
            placeholder: '署名',
            maxLength: 20,
            title: '手机端要求署名：2 到 20 个字，不能带数字',
            onChange: (event) => setRealName(event.target.value),
          }),
          h('button', {
            className: 'k20-layout-btn primary',
            disabled: bgBusy,
            onClick: () => { if (fileRef.current) fileRef.current.click() },
          }, bgBusy ? '处理中…' : '上传壁纸'),
          h('input', {
            ref: fileRef,
            type: 'file',
            accept: 'image/jpeg,image/png,image/webp,video/mp4',
            style: { display: 'none' },
            onChange: (event) => void uploadBackground(event.target.files && event.target.files[0]),
          }),
          h('button', {
            className: 'k20-layout-btn',
            disabled: bgBusy || !bgCurrent,
            onClick: () => void bgAction('clear', {}, '背景已恢复纯色'),
          }, '恢复纯色'),
        ),
        bgMsg ? h('div', { className: 'k20-layout-msg' }, bgMsg) : null,
        bgErr ? h('div', { className: 'k20-layout-msg err' }, bgErr) : null,
        bgItems.length === 0
          ? h('div', { className: 'k20-layout-msg' }, bgBusy ? '正在读手机…' : '手机里还没有壁纸，点「上传壁纸」传一张')
          : h(
            'div',
            { className: 'k20-bg-grid' },
            bgItems.map((item) => {
              const isVideo = item.kind === 'video'
              return h(
                'div',
                { key: item.id, className: `k20-bg-card${item.id === bgCurrent ? ' current' : ''}` },
                h(
                  'div',
                  {
                    className: 'k20-bg-thumb',
                    title: isVideo ? '点开看视频' : item.name,
                    style: isVideo ? { cursor: 'pointer' } : undefined,
                    onClick: isVideo ? () => window.open(mediaUrl(item.id), '_blank') : undefined,
                  },
                  isVideo
                    ? h('span', null, '▶')
                    : h('img', { src: mediaUrl(item.id), alt: item.name, loading: 'lazy' }),
                  item.id === bgCurrent ? h('span', { className: 'k20-bg-badge' }, '使用中') : null,
                ),
                h(
                  'div',
                  { className: 'k20-bg-meta' },
                  h('div', { className: 'k20-bg-name' }, item.name),
                  h('div', { className: 'k20-bg-sub' },
                    `${isVideo ? '视频' : '图片'}${sizeText(item.bytes) ? ` · ${sizeText(item.bytes)}` : ''}${item.owner ? ` · ${item.owner}` : ''}`),
                  h(
                    'div',
                    { className: 'k20-bg-actions' },
                    h('button', {
                      className: 'k20-layout-btn',
                      disabled: bgBusy || item.id === bgCurrent,
                      onClick: () => void bgAction('select', { id: item.id }, `已切换：${item.name}`),
                    }, item.id === bgCurrent ? '使用中' : '切换'),
                    h('button', {
                      className: 'k20-layout-btn',
                      disabled: bgBusy,
                      onClick: () => removeBackground(item),
                    }, '删除'),
                  ),
                ),
              )
            }),
          ),
      )

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
        backgroundSection,
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
