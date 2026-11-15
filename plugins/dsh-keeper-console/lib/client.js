// dsh-keeper-console — browser half.
//
// 侧栏只留一个入口「守岸人」：本包注册 sidebar.panellist 的一行 + main 面板，
// main 面板是壳（顶部标签栏），并声明 keeper.tabs 子槽；设置/主屏布局/阅读
// 各自往 keeper.tabs 注册一格（本包的「设置」也在里面，和其他包地位相同）。
// 壳不碰业务，数据全走各包自己的 RPC 通道 —— 不经模型。
//
// Sections: 朗读语音（dsh-tts / voice-mode）· 主动关怀（keeper-watch 覆盖）
// · 台灯控制（desk-mi 覆盖）· 状态（keeper-tts 在线）。
//
// Hand-written classic-script bundle; no build step. Styling uses only
// --dsw-alias-* theme tokens.

window.__ModuleLoader__.load({
  id: 'dsh-keeper-console',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useCallback, useRef } = React
    const h = React.createElement

    // ---------------------------------------------------- localized text --

    const DICT = {
      panelName: ['守岸人', 'Shorekeeper'],
      settingsTab: ['设置', 'Settings'],
      settingsHint: ['朗读、提醒、台灯这三个总闸', 'Switches for speech, alerts and the desk lamp'],
      refresh: ['刷新', 'Refresh'],
      loading: ['读取中…', 'Loading…'],
      groupVoice: ['朗读语音', 'Speech'],
      groupWatch: ['主动关怀（异动提醒）', 'Proactive alerts'],
      groupDeskMi: ['台灯与设备控制', 'Device control'],
      groupStatus: ['状态', 'Status'],
      speakReplies: ['自动朗读回复', 'Speak agent replies'],
      speakRepliesHint: ['整条回复生成后朗读（dsh-tts）', 'Read the whole reply after it is generated (dsh-tts)'],
      speakAsItGoes: ['流式逐句朗读', 'Speak as it goes'],
      speakAsItGoesHint: ['边生成边按句朗读，与「自动朗读回复」二选一，同开会读两遍', 'Streams sentence by sentence; pick one of the two or it reads twice'],
      readAloudOn: ['语音模式内朗读', 'Read aloud in voice mode'],
      readAloudHint: ['语音对话里守岸人用浏览器内引擎出声（朗读面已归 dsh-tts，建议关）', 'Voice mode uses its own in-browser engine; global reading is dsh-tts, keep off'],
      watchEnabled: ['异动提醒总开关', 'Alerts master switch'],
      watchEnabledHint: ['天气突变 / PM2.5 / PC 过热 / 内存压力 / 设备离线 → 微信', 'Weather / PM2.5 / overheat / memory / offline → WeChat'],
      quietEnabled: ['免打扰 23:00–07:00', 'Quiet hours 23:00–07:00'],
      quietEnabledHint: ['免打扰时段内一律不主动开口', 'No proactive messages during quiet hours'],
      dailyLimit: ['每日提醒上限', 'Daily alert limit'],
      dailyLimitHint: ['0 = 今天不再提醒（不是不限次数）', '0 = no alerts today (not unlimited)'],
      controlPerMinuteHint: ['0 = 不限流', '0 = no rate limit'],
      apply: ['应用', 'Apply'],
      saved: ['已保存', 'Saved'],
      saveFailed: ['保存失败', 'Save failed'],
      controlEnabled: ['米家写入总闸', 'Mijia writes master switch'],
      controlEnabledHint: ['关着时控灯工具一律拒绝（安全红线）', 'When off, light-control tools refuse (safety rail)'],
      controlPerMinute: ['每分钟控制上限', 'Controls per minute'],
      keeperTts: ['本地克隆音色服务 (keeper-tts)', 'Local voice service (keeper-tts)'],
      online: ['在线', 'online'],
      offline: ['离线', 'offline'],
      settingsUnavailable: ['宿主 settings 服务不可用（重启 dsh 后重试）', 'Host settings service unavailable (restart dsh)'],
      shellEmpty: ['这个入口还没有挂上标签页（等插件加载完再看）', 'No tabs registered yet (wait for plugins to load)'],
      on: ['开', 'On'],
      off: ['关', 'Off'],
    }
    const LANG =
      String((typeof navigator !== 'undefined' && navigator.language) || 'zh').toLowerCase().indexOf('zh') === 0
        ? 0
        : 1
    const tr = (key) => (DICT[key] ? DICT[key][LANG] : key)

    // ------------------------------------------------------------ styles --

    const CSS = `
.dsh-keeper-console-root{height:100%;overflow-y:auto;box-sizing:border-box;padding:16px 24px 40px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.dsh-keeper-console-toolbar{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.dsh-keeper-console-title{font-size:16px;font-weight:600;flex:1}
.dsh-keeper-console-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer}
.dsh-keeper-console-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.dsh-keeper-console-btn:disabled{opacity:.55;cursor:default}
.dsh-keeper-console-section{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px 14px;margin-bottom:12px;background:var(--dsw-alias-bg-layer-1)}
.dsh-keeper-console-h{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;margin-bottom:8px}
.dsh-keeper-console-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-keeper-console-row:first-of-type{border-top:none}
.dsh-keeper-console-label{flex:1;min-width:0}
.dsh-keeper-console-name{font-size:13px}
.dsh-keeper-console-hint{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:2px}
.dsh-keeper-console-switch{position:relative;width:36px;height:20px;border-radius:10px;border:none;cursor:pointer;flex:none;background:var(--dsw-alias-border-l2);transition:background .15s}
.dsh-keeper-console-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.dsh-keeper-console-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
.dsh-keeper-console-switch[aria-checked="true"]::after{transform:translateX(16px)}
.dsh-keeper-console-input{width:76px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px;font-size:12px}
.dsh-keeper-console-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.dsh-keeper-console-msg{color:var(--dsw-alias-label-secondary);font-size:12px;margin-left:8px}
.dsh-keeper-console-error{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);border-radius:6px;padding:8px 10px;margin-bottom:12px;white-space:pre-wrap;word-break:break-word}
.dsh-keeper-shell{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsh-keeper-shell-head{display:flex;align-items:flex-end;gap:16px;padding:12px 20px 0;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-keeper-shell-title{font-size:15px;font-weight:600;white-space:nowrap;padding-bottom:8px}
.dsh-keeper-shell-tabs{display:flex;align-items:center;gap:2px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
.dsh-keeper-shell-tabs::-webkit-scrollbar{display:none}
.dsh-keeper-shell-tab{appearance:none;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;padding:6px 12px;border-radius:6px 6px 0 0;cursor:pointer;white-space:nowrap}
.dsh-keeper-shell-tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.dsh-keeper-shell-tab.on{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary)}
.dsh-keeper-shell-body{flex:1;min-height:0;overflow:hidden;position:relative}
.dsh-keeper-shell-empty{padding:24px;color:var(--dsw-alias-label-secondary);font-size:13px}
`

    // -------------------------------------------------------- panel icon --

    function PanelIcon({ size, active }) {
      const s = size || 18
      return h(
        'svg',
        {
          width: s,
          height: s,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block', color: active ? 'var(--dsw-alias-brand-primary)' : 'currentColor' },
        },
        h('path', {
          d: 'M12 3.2 5 5.6v5.1c0 4.6 2.9 8 7 10.1 4.1-2.1 7-5.5 7-10.1V5.6L12 3.2z',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M9 11.6l2.1 2.1L15.3 9.4',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    // ----------------------------------------------------------- controls --

    function ToggleRow({ name, hint, checked, busy, onChange }) {
      return h(
        'div',
        { className: 'dsh-keeper-console-row' },
        h(
          'div',
          { className: 'dsh-keeper-console-label' },
          h('div', { className: 'dsh-keeper-console-name' }, name),
          hint ? h('div', { className: 'dsh-keeper-console-hint' }, hint) : null,
        ),
        h('button', {
          className: 'dsh-keeper-console-switch',
          role: 'switch',
          'aria-checked': checked === true,
          disabled: busy,
          title: tr('on') + ' / ' + tr('off'),
          onClick: () => onChange(!checked),
        }),
      )
    }

    function NumberRow({ name, hint, value, busy, draft, onDraft, onApply }) {
      return h(
        'div',
        { className: 'dsh-keeper-console-row' },
        h(
          'div',
          { className: 'dsh-keeper-console-label' },
          h('div', { className: 'dsh-keeper-console-name' }, name),
          hint ? h('div', { className: 'dsh-keeper-console-hint' }, hint) : null,
        ),
        h('input', {
          className: 'dsh-keeper-console-input',
          type: 'number',
          min: 0,
          value: draft != null ? draft : value != null ? String(value) : '',
          disabled: busy,
          onChange: (e) => onDraft(e.target.value),
        }),
        h(
          'button',
          {
            className: 'dsh-keeper-console-btn',
            disabled: busy || draft == null || draft === '' || Number(draft) === value,
            onClick: onApply,
          },
          tr('apply'),
        ),
      )
    }

    function Section({ title, children }) {
      return h(
        'div',
        { className: 'dsh-keeper-console-section' },
        h('div', { className: 'dsh-keeper-console-h' }, title),
        children,
      )
    }

    // 按下后立刻改本地画面。热重载前拉回来的快照还是旧值，用同一次点击再盖一层，
    // 开关不会弹回。互斥规则与宿主 normalizeTtsPatch 一致。
    function paintSnap(base, action, payload) {
      if (!base || typeof base !== 'object') return base
      const next = {
        ...base,
        tts: { ...(base.tts || {}) },
        voice: { ...(base.voice || {}) },
        watch: { ...(base.watch || {}) },
        deskMi: { ...(base.deskMi || {}) },
      }
      if (action === 'setTts') {
        if (typeof payload?.speakReplies === 'boolean') next.tts.speakReplies = payload.speakReplies
        if (typeof payload?.speakAsItGoes === 'boolean') next.tts.speakAsItGoes = payload.speakAsItGoes
        if (payload?.speakReplies === true) next.tts.speakAsItGoes = false
        if (payload?.speakAsItGoes === true) next.tts.speakReplies = false
      } else if (action === 'setVoice') {
        if (typeof payload?.readAloudOn === 'boolean') next.voice.readAloudOn = payload.readAloudOn
      } else if (action === 'setKeeper') {
        const watch = payload?.watch
        if (watch && typeof watch === 'object') {
          if (typeof watch.enabled === 'boolean') next.watch.enabled = watch.enabled
          if (typeof watch.quietEnabled === 'boolean') next.watch.quietEnabled = watch.quietEnabled
          if (typeof watch.dailyLimit === 'number' && Number.isFinite(watch.dailyLimit)) {
            next.watch.dailyLimit = Math.max(0, Math.floor(watch.dailyLimit))
          }
        }
        const desk = payload?.deskMi
        if (desk && typeof desk === 'object') {
          if (typeof desk.controlEnabled === 'boolean') next.deskMi.controlEnabled = desk.controlEnabled
          if (typeof desk.controlPerMinute === 'number' && Number.isFinite(desk.controlPerMinute)) {
            next.deskMi.controlPerMinute = Math.max(0, Math.floor(desk.controlPerMinute))
          }
        }
      }
      return next
    }

    // --------------------------------------------------------------- panel --

    function KeeperPanel({ call }) {
      const [snap, setSnap] = useState(null)
      const [error, setError] = useState('')
      const [busyKey, setBusyKey] = useState('')
      const [flash, setFlash] = useState('')
      const [draftLimit, setDraftLimit] = useState(null)
      const [draftRate, setDraftRate] = useState(null)
      const epoch = useRef(0)

      const load = useCallback(async () => {
        setError('')
        try {
          const value = await call('snapshot', {})
          setSnap(value)
        } catch (e) {
          setError(String((e && e.message) || e))
        }
      }, [call])

      useEffect(() => {
        void load()
      }, [load])

      const run = useCallback(
        async (key, action, payload) => {
          const gen = ++epoch.current
          let prior = null
          let written = false
          setSnap((prev) => {
            prior = prev
            return paintSnap(prev, action, payload)
          })
          setBusyKey(key)
          setFlash('')
          setError('')
          try {
            await call(action, payload)
            written = true
            if (epoch.current !== gen) return
            const value = await call('snapshot', {})
            if (epoch.current !== gen) return
            setSnap(paintSnap(value, action, payload))
            setFlash(tr('saved'))
            setTimeout(() => setFlash(''), 2000)
          } catch (e) {
            if (epoch.current !== gen) return
            if (!written) setSnap(prior)
            setError(String((e && e.message) || e))
          } finally {
            if (epoch.current === gen) setBusyKey('')
          }
        },
        [call],
      )

      if (error && !snap) {
        return h(
          'div',
          { className: 'dsh-keeper-console-root' },
          h('div', { className: 'dsh-keeper-console-error' }, error),
          h('button', { className: 'dsh-keeper-console-btn', onClick: () => void load() }, tr('refresh')),
        )
      }
      if (!snap) return h('div', { className: 'dsh-keeper-console-root' }, tr('loading'))

      const busy = (key) => busyKey === key

      return h(
        'div',
        { className: 'dsh-keeper-console-root' },
        h(
          'div',
          { className: 'dsh-keeper-console-toolbar' },
          h('div', { className: 'dsh-keeper-console-title' }, tr('settingsHint')),
          flash ? h('span', { className: 'dsh-keeper-console-msg' }, flash) : null,
          h('button', { className: 'dsh-keeper-console-btn', onClick: () => void load() }, tr('refresh')),
        ),
        error ? h('div', { className: 'dsh-keeper-console-error' }, error) : null,

        h(
          Section,
          { title: tr('groupVoice') },
          snap.tts.available
            ? [
                h(ToggleRow, {
                  key: 'sr',
                  name: tr('speakReplies'),
                  hint: tr('speakRepliesHint'),
                  checked: snap.tts.speakReplies,
                  busy: busy('sr'),
                  onChange: (v) => void run('sr', 'setTts', { speakReplies: v }),
                }),
                h(ToggleRow, {
                  key: 'sg',
                  name: tr('speakAsItGoes'),
                  hint: tr('speakAsItGoesHint'),
                  checked: snap.tts.speakAsItGoes,
                  busy: busy('sg'),
                  onChange: (v) => void run('sg', 'setTts', { speakAsItGoes: v }),
                }),
              ]
            : null,
          snap.voice.available
            ? h(ToggleRow, {
                key: 'ra',
                name: tr('readAloudOn'),
                hint: tr('readAloudHint'),
                checked: snap.voice.readAloudOn,
                busy: busy('ra'),
                onChange: (v) => void run('ra', 'setVoice', { readAloudOn: v }),
              })
            : null,
          !snap.tts.available && !snap.voice.available
            ? h('div', { className: 'dsh-keeper-console-hint' }, tr('settingsUnavailable'))
            : null,
        ),

        h(
          Section,
          { title: tr('groupWatch') },
          h(ToggleRow, {
            name: tr('watchEnabled'),
            hint: tr('watchEnabledHint'),
            checked: snap.watch.enabled,
            busy: busy('w-en'),
            onChange: (v) => void run('w-en', 'setKeeper', { watch: { enabled: v } }),
          }),
          h(ToggleRow, {
            name: tr('quietEnabled'),
            hint: tr('quietEnabledHint'),
            checked: snap.watch.quietEnabled,
            busy: busy('w-qt'),
            onChange: (v) => void run('w-qt', 'setKeeper', { watch: { quietEnabled: v } }),
          }),
          h(NumberRow, {
            name: tr('dailyLimit'),
            hint: tr('dailyLimitHint'),
            value: snap.watch.dailyLimit,
            draft: draftLimit,
            onDraft: setDraftLimit,
            busy: busy('w-limit'),
            onApply: () =>
              void run('w-limit', 'setKeeper', {
                watch: { dailyLimit: Math.max(0, Math.floor(Number(draftLimit) || 0)) },
              }).then(() => setDraftLimit(null)),
          }),
        ),

        h(
          Section,
          { title: tr('groupDeskMi') },
          h(ToggleRow, {
            name: tr('controlEnabled'),
            hint: tr('controlEnabledHint'),
            checked: snap.deskMi.controlEnabled,
            busy: busy('m-en'),
            onChange: (v) => void run('m-en', 'setKeeper', { deskMi: { controlEnabled: v } }),
          }),
          h(NumberRow, {
            name: tr('controlPerMinute'),
            hint: tr('controlPerMinuteHint'),
            value: snap.deskMi.controlPerMinute,
            draft: draftRate,
            onDraft: setDraftRate,
            busy: busy('m-rate'),
            onApply: () =>
              void run('m-rate', 'setKeeper', {
                deskMi: { controlPerMinute: Math.max(0, Math.floor(Number(draftRate) || 0)) },
              }).then(() => setDraftRate(null)),
          }),
        ),

        h(
          Section,
          { title: tr('groupStatus') },
          h(
            'div',
            { className: 'dsh-keeper-console-row' },
            h(
              'div',
              { className: 'dsh-keeper-console-label' },
              h(
                'div',
                { className: 'dsh-keeper-console-name' },
                h('span', {
                  className: 'dsh-keeper-console-dot',
                  style: {
                    background: snap.status.keeperTtsAlive
                      ? 'var(--dsw-alias-state-success-primary, #34a853)'
                      : 'var(--dsw-alias-state-error-primary, #ea4335)',
                  },
                }),
                tr('keeperTts'),
              ),
            ),
            h('span', { className: 'dsh-keeper-console-msg' }, snap.status.keeperTtsAlive ? tr('online') : tr('offline')),
          ),
        ),
      )
    }

    // --------------------------------------------------------------- shell --

    const TAB_KEY = 'dsh-keeper-shell-tab'

    function readStoredTab() {
      try {
        return window.localStorage.getItem(TAB_KEY) || ''
      } catch {
        return ''
      }
    }

    function storeTab(id) {
      try {
        window.localStorage.setItem(TAB_KEY, id)
      } catch {
        // 隐私模式下 localStorage 会抛，标签选择不记也不影响用
      }
    }

    // 侧栏只有一个「守岸人」入口：顶部标签栏 + 下面渲染当前标签的注册内容。
    // 标签来自 keeper.tabs（本包声明），别的插件往那里注册，壳不认具体是谁。
    function KeeperShell({ tabs, renderSlot }) {
      const [list, setList] = useState(() => tabs.value())
      const [active, setActive] = useState(() => {
        const items = tabs.value()
        const stored = readStoredTab()
        if (stored && items.some((tab) => tab.id === stored)) return stored
        return items.length > 0 ? items[0].id : ''
      })

      useEffect(() => {
        const sync = (next) => {
          setList(next)
          setActive((current) => {
            if (current && next.some((tab) => tab.id === current)) return current
            const stored = readStoredTab()
            if (stored && next.some((tab) => tab.id === stored)) return stored
            return next.length > 0 ? next[0].id : ''
          })
        }
        sync(tabs.value())
        return tabs.subscribe(sync)
      }, [tabs])

      const pick = (id) => {
        setActive(id)
        storeTab(id)
      }

      return h(
        'div',
        { className: 'dsh-keeper-shell' },
        h(
          'div',
          { className: 'dsh-keeper-shell-head' },
          h('div', { className: 'dsh-keeper-shell-title' }, tr('panelName')),
          h(
            'nav',
            { className: 'dsh-keeper-shell-tabs', role: 'tablist' },
            list.map((tab) =>
              h(
                'button',
                {
                  key: tab.id,
                  role: 'tab',
                  type: 'button',
                  'aria-selected': tab.id === active,
                  className: `dsh-keeper-shell-tab${tab.id === active ? ' on' : ''}`,
                  onClick: () => pick(tab.id),
                },
                tab.label,
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dsh-keeper-shell-body', role: 'tabpanel' },
          active && typeof renderSlot === 'function'
            ? renderSlot('keeper.tabs', {}, { only: active })
            : h('div', { className: 'dsh-keeper-shell-empty' }, tr('shellEmpty')),
        ),
      )
    }

    // ------------------------------------------------------------- wiring --

    const inject = ['connection', 'slots']

    function apply(ctx) {
      ctx.effect(() => {
        const element = document.createElement('style')
        element.setAttribute('data-plugin', 'dsh-keeper-console')
        element.textContent = CSS
        document.head.appendChild(element)
        return () => element.remove()
      }, 'keeper-console: styles')

      const connection = ctx.get('connection')
      const call = async (action, payload) => {
        let res
        try {
          res = await connection.rpc.call('/keeper-console', action, payload || {})
        } catch (e) {
          throw e
        }
        if (!res || typeof res !== 'object' || res.ok !== true) {
          const err = new Error((res && res.error && res.error.message) || 'keeper-console RPC 调用失败')
          throw err
        }
        return res.value
      }

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'keeper-console',
            order: 42,
            label: () => tr('panelName'),
          },
          PanelIcon,
        ),
      )

      // 标签目录：壳只看 id / order / label，内容由注册方自己渲染。
      // 不做快照缓存，注册表变了重新读一遍（标签数量本来就少）。
      const tabs = {
        value: () => readTabs(ctx),
        subscribe: (listener) => ctx.slots.subscribe('keeper.tabs', () => listener(readTabs(ctx))),
      }

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: 'keeper-console',
            children: { 'keeper.tabs': { kind: 'list', scope: 'root' } },
            inject: () => ({ tabs }),
          },
          KeeperShell,
        ),
      )

      // 自己的设置页也是一个标签，和其他包平级（order 决定顺序）。
      ctx.slots.inject('keeper.tabs', () =>
        ctx.slots.register(
          { name: 'keeper.tabs', id: 'keeper-settings', order: 10, label: tr('settingsTab'), inject: () => ({ call }) },
          KeeperPanel,
        ),
      )
    }

    /** 读 keeper.tabs 的注册项：id/order/label（label 可能是函数） */
    function readTabs(ctx) {
      const items = []
      for (const entry of ctx.slots.entriesOfSlot('keeper.tabs')) {
        const options = entry.options || {}
        if (!options.id) continue
        const raw = options.label
        const label = typeof raw === 'function' ? raw() : raw
        items.push({ id: options.id, order: options.order || 0, label: label || options.id })
      }
      return items.sort((a, b) => a.order - b.order)
    }

    return { apply, inject }
  },
})
