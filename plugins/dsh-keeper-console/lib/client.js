// dsh-keeper-console — browser half.
//
// Registers a sidebar rail icon (sidebar.panellist) and a central panel (main)
// addressed by the same id. All data comes from this package's host half over
// the /keeper-console RPC channel — no model round-trip anywhere.
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
    const { useState, useEffect, useCallback } = React
    const h = React.createElement

    // ---------------------------------------------------- localized text --

    const DICT = {
      panelName: ['守岸人设置', 'Keeper Settings'],
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
.dsh-keeper-console-root{height:100%;overflow-y:auto;box-sizing:border-box;padding:20px 24px 40px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
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

    // --------------------------------------------------------------- panel --

    function KeeperPanel({ call }) {
      const [snap, setSnap] = useState(null)
      const [error, setError] = useState('')
      const [busyKey, setBusyKey] = useState('')
      const [flash, setFlash] = useState('')
      const [draftLimit, setDraftLimit] = useState(null)
      const [draftRate, setDraftRate] = useState(null)

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
          setBusyKey(key)
          setFlash('')
          setError('')
          try {
            await call(action, payload)
            const value = await call('snapshot', {})
            setSnap(value)
            setFlash(tr('saved'))
            setTimeout(() => setFlash(''), 2000)
          } catch (e) {
            setError(String((e && e.message) || e))
          } finally {
            setBusyKey('')
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
          h('div', { className: 'dsh-keeper-console-title' }, tr('panelName')),
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
                h(ToggleRow, {
                  key: 'ra',
                  name: tr('readAloudOn'),
                  hint: tr('readAloudHint'),
                  checked: snap.voice.readAloudOn,
                  busy: busy('ra'),
                  onChange: (v) => void run('ra', 'setVoice', { readAloudOn: v }),
                }),
              ]
            : h('div', { className: 'dsh-keeper-console-hint' }, tr('settingsUnavailable')),
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

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: 'keeper-console',
            inject: () => ({ call }),
          },
          KeeperPanel,
        ),
      )
    }

    return { apply, inject }
  },
})
