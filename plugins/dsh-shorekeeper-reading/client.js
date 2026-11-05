// dsh-shorekeeper-reading — browser half（小说朗读面板）。
//
// Registers a sidebar rail icon (sidebar.panellist) and a central panel (main)
// addressed by the same id. All data comes from this package's host half over
// the /reading-panel RPC channel — no model round-trip anywhere.
//
// Sections: 正在朗读（进度 + 停止）· 书架（点书开读 / 续读）· 播放设置（语速 / 定时）。
// 断点与守岸人对话侧（reading.listen / reading.stop 工具）同一条引擎、同一份
// listen-state.json，两边互通。
//
// Hand-written classic-script bundle; no build step. Styling uses only
// --dsw-alias-* theme tokens.

window.__ModuleLoader__.load({
  id: 'dsh-shorekeeper-reading',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useCallback, useRef } = React
    const h = React.createElement

    // ---------------------------------------------------- localized text --

    const DICT = {
      panelName: ['小说朗读', 'Book Reading'],
      refresh: ['刷新', 'Refresh'],
      loading: ['读取中…', 'Loading…'],
      emptyShelf: ['书架还是空的（把 txt 交给守岸人收录）', 'The shelf is empty'],
      groupNow: ['正在朗读', 'Now playing'],
      groupShelf: ['书架', 'Shelf'],
      groupSetup: ['播放设置', 'Playback'],
      idle: ['没在朗读', 'Idle'],
      resumeFrom: ['断点：约 %d 字处', 'Resume at ~%d chars'],
      noResume: ['还没有断点，从书架挑一本吧', 'No bookmark yet; pick a book below'],
      stop: ['停止', 'Stop'],
      play: ['开读', 'Play'],
      speed: ['语速', 'Speed'],
      timer: ['定时（分钟，0 = 不限）', 'Timer (min, 0 = unlimited)'],
      chunk: ['第 %d / %d 段', 'Chunk %d / %d'],
      readTo: ['已读约 %d 字', 'Read ~%d chars'],
      unreadable: ['书文件不在盘上', 'Text file missing'],
      finished: ['已读完', 'Finished'],
      wishlist: ['想读', 'Wishlist'],
      reading: ['在读', 'Reading'],
      tts: ['本地克隆音色服务 (keeper-tts)', 'Local voice service (keeper-tts)'],
      online: ['在线', 'online'],
      offline: ['离线', 'offline'],
      lastStop: ['上次停在哪：', 'Last stop:'],
      byUser: ['手动停止', 'stopped by you'],
      byTimer: ['到点自动停', 'timer elapsed'],
      byEnd: ['读完了', 'reached the end'],
      byError: ['出错', 'error'],
    }
    const LANG =
      String((typeof navigator !== 'undefined' && navigator.language) || 'zh').toLowerCase().indexOf('zh') === 0
        ? 0
        : 1
    const tr = (key) => (DICT[key] ? DICT[key][LANG] : key)
    const fmt = (key, ...args) => {
      const tpl = DICT[key] ? DICT[key][LANG] : key
      let i = 0
      return tpl.replace(/%d|%s/g, () => String(args[i++]))
    }

    // ------------------------------------------------------------ styles --

    const CSS = `
.dsh-reading-root{height:100%;overflow-y:auto;box-sizing:border-box;padding:20px 24px 40px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.dsh-reading-toolbar{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.dsh-reading-title{font-size:16px;font-weight:600;flex:1}
.dsh-reading-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer}
.dsh-reading-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.dsh-reading-btn:disabled{opacity:.55;cursor:default}
.dsh-reading-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-reading-section{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px 14px;margin-bottom:12px;background:var(--dsw-alias-bg-layer-1)}
.dsh-reading-h{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;margin-bottom:8px}
.dsh-reading-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-reading-row:first-of-type{border-top:none}
.dsh-reading-label{flex:1;min-width:0}
.dsh-reading-name{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-reading-hint{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:2px}
.dsh-reading-book{cursor:pointer;border-radius:6px;padding:7px 8px;margin:0 -8px}
.dsh-reading-book:hover{background:var(--dsw-alias-bg-hover, rgba(127,127,127,.12))}
.dsh-reading-book-active{background:var(--dsw-alias-bg-hover, rgba(127,127,127,.12))}
.dsh-reading-book-active .dsh-reading-name{color:var(--dsw-alias-brand-primary)}
.dsh-reading-input{width:76px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px;font-size:12px}
.dsh-reading-select{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 6px;font-size:12px}
.dsh-reading-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.dsh-reading-msg{color:var(--dsw-alias-label-secondary);font-size:12px;margin-left:8px}
.dsh-reading-progress{height:4px;border-radius:2px;background:var(--dsw-alias-border-l1);overflow:hidden;margin:8px 0 2px}
.dsh-reading-progress>div{height:100%;background:var(--dsw-alias-brand-primary);border-radius:2px;transition:width .6s}
.dsh-reading-error{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);border-radius:6px;padding:8px 10px;margin-bottom:12px;white-space:pre-wrap;word-break:break-word}
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
          d: 'M4 5.5C4 4.7 4.7 4 5.5 4H10c1.1 0 2 .9 2 2v13c0-1.1-.9-2-2-2H5.5C4.7 17 4 16.3 4 15.5v-10z',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M20 5.5c0-.8-.7-1.5-1.5-1.5H14c-1.1 0-2 .9-2 2v13c0-1.1.9-2 2-2h4.5c.8 0 1.5-.7 1.5-1.5v-10z',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinejoin: 'round',
        }),
      )
    }

    // ----------------------------------------------------------- helpers --

    const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0]

    function statusLine(snap) {
      const st = snap && snap.status
      if (!st) return snap && snap.resume ? fmt('resumeFrom', snap.resume.offset) : tr('noResume')
      if (st.playing) {
        const chunk = st.totalChunks > 0 ? ' · ' + fmt('chunk', st.chunkIndex + 1, st.totalChunks) : ''
        return '《' + st.title + '》' + chunk + ' · ' + fmt('readTo', st.offset)
      }
      const how = { user: tr('byUser'), timer: tr('byTimer'), end: tr('byEnd'), error: tr('byError') }[st.stoppedBy] || ''
      const at = '《' + st.title + '》' + fmt('readTo', st.offset) + (how ? '（' + how + '）' : '')
      return st.error ? at + ' · ' + st.error : at
    }

    function statusMeta(snap) {
      const st = snap && snap.status
      if (st && st.playing && st.totalChunks > 0) {
        return Math.min(100, Math.round(((st.chunkIndex + 1) / st.totalChunks) * 100))
      }
      return null
    }

    function bookSubtitle(book) {
      const bits = []
      if (book.author) bits.push(book.author)
      if (book.status === 'finished') bits.push(tr('finished'))
      else if (book.status === 'wishlist') bits.push(tr('wishlist'))
      else if (book.status === 'reading') bits.push(tr('reading'))
      if (book.percent !== null && book.percent !== undefined) bits.push(book.percent + '%')
      else if (book.offset > 0) bits.push(fmt('readTo', book.offset))
      if (!book.readable) bits.push(tr('unreadable'))
      return bits.join(' · ')
    }

    // --------------------------------------------------------------- panel --

    function ReadingPanel({ call }) {
      const [snap, setSnap] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [speed, setSpeed] = useState(1.0)
      const [timerDraft, setTimerDraft] = useState(null)
      const aliveRef = useRef(true)

      const load = useCallback(async () => {
        try {
          const value = await call('books', {})
          if (aliveRef.current) {
            setSnap(value)
            setError('')
          }
        } catch (e) {
          if (aliveRef.current) setError(String((e && e.message) || e))
        }
      }, [call])

      useEffect(() => {
        aliveRef.current = true
        void load()
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') void load()
        }, 3000)
        return () => {
          aliveRef.current = false
          clearInterval(timer)
        }
      }, [load])

      const run = useCallback(
        async (action, payload) => {
          setBusy(true)
          setError('')
          try {
            const value = await call(action, payload)
            if (aliveRef.current && value) setSnap(value)
          } catch (e) {
            if (aliveRef.current) setError(String((e && e.message) || e))
          } finally {
            if (aliveRef.current) setBusy(false)
          }
        },
        [call],
      )

      const play = useCallback(
        (bookId) => {
          const payload = { speed }
          const timer = timerDraft != null && timerDraft !== '' ? Number(timerDraft) : null
          if (timer !== null && Number.isFinite(timer)) payload.timerMin = Math.max(0, Math.floor(timer))
          if (bookId) payload.bookId = bookId
          void run('play', payload)
        },
        [run, speed, timerDraft],
      )

      if (!snap) {
        return h(
          'div',
          { className: 'dsh-reading-root' },
          error ? h('div', { className: 'dsh-reading-error' }, error) : null,
          h(
            'div',
            { className: 'dsh-reading-toolbar' },
            h('div', { className: 'dsh-reading-title' }, tr('panelName')),
            h('button', { className: 'dsh-reading-btn', onClick: () => void load() }, tr('refresh')),
          ),
          error ? null : tr('loading'),
        )
      }

      const playing = !!(snap.status && snap.status.playing)
      const progress = statusMeta(snap)
      const resume = snap.resume
      const timerValue = timerDraft != null ? timerDraft : String(snap.timerMin ?? 0)

      return h(
        'div',
        { className: 'dsh-reading-root' },
        h(
          'div',
          { className: 'dsh-reading-toolbar' },
          h('div', { className: 'dsh-reading-title' }, tr('panelName')),
          h('button', { className: 'dsh-reading-btn', disabled: busy, onClick: () => void load() }, tr('refresh')),
        ),
        error ? h('div', { className: 'dsh-reading-error' }, error) : null,

        // -- 正在朗读 --
        h(
          'div',
          { className: 'dsh-reading-section' },
          h('div', { className: 'dsh-reading-h' }, tr('groupNow')),
          h(
            'div',
            { className: 'dsh-reading-row' },
            h(
              'div',
              { className: 'dsh-reading-label' },
              h('div', { className: 'dsh-reading-name' }, playing ? '《' + snap.status.title + '》' : tr('idle')),
              h('div', { className: 'dsh-reading-hint' }, statusLine(snap)),
            ),
            playing
              ? h(
                  'button',
                  { className: 'dsh-reading-btn', disabled: busy, onClick: () => void run('stop', {}) },
                  tr('stop'),
                )
              : resume
                ? h(
                    'button',
                    {
                      className: 'dsh-reading-btn dsh-reading-btn-primary',
                      disabled: busy,
                      onClick: () => play(null),
                    },
                    tr('play'),
                  )
                : null,
          ),
          progress !== null
            ? h('div', { className: 'dsh-reading-progress' }, h('div', { style: { width: progress + '%' } }))
            : null,
        ),

        // -- 书架 --
        h(
          'div',
          { className: 'dsh-reading-section' },
          h('div', { className: 'dsh-reading-h' }, tr('groupShelf')),
          snap.books.length === 0
            ? h('div', { className: 'dsh-reading-hint' }, tr('emptyShelf'))
            : snap.books.map((book) =>
                h(
                  'div',
                  {
                    key: book.id,
                    className:
                      'dsh-reading-book dsh-reading-row' +
                      (playing && snap.status.bookId === book.id ? ' dsh-reading-book-active' : ''),
                    onClick: () => {
                      if (!busy) play(book.id)
                    },
                  },
                  h(
                    'div',
                    { className: 'dsh-reading-label' },
                    h('div', { className: 'dsh-reading-name' }, book.title),
                    h('div', { className: 'dsh-reading-hint' }, bookSubtitle(book)),
                  ),
                  h(
                    'button',
                    {
                      className: 'dsh-reading-btn',
                      disabled: busy,
                      onClick: (e) => {
                        e.stopPropagation()
                        play(book.id)
                      },
                    },
                    tr('play'),
                  ),
                ),
              ),
        ),

        // -- 播放设置 --
        h(
          'div',
          { className: 'dsh-reading-section' },
          h('div', { className: 'dsh-reading-h' }, tr('groupSetup')),
          h(
            'div',
            { className: 'dsh-reading-row' },
            h('div', { className: 'dsh-reading-label' }, h('div', { className: 'dsh-reading-name' }, tr('speed'))),
            h(
              'select',
              {
                className: 'dsh-reading-select',
                value: String(speed),
                onChange: (e) => setSpeed(Number(e.target.value)),
              },
              SPEEDS.map((v) => h('option', { key: v, value: String(v) }, v.toFixed(2) === '1.00' ? '1.0×' : v + '×')),
            ),
          ),
          h(
            'div',
            { className: 'dsh-reading-row' },
            h('div', { className: 'dsh-reading-label' }, h('div', { className: 'dsh-reading-name' }, tr('timer'))),
            h('input', {
              className: 'dsh-reading-input',
              type: 'number',
              min: 0,
              max: 120,
              value: timerValue,
              onChange: (e) => setTimerDraft(e.target.value),
            }),
          ),
          h(
            'div',
            { className: 'dsh-reading-row' },
            h(
              'div',
              { className: 'dsh-reading-label' },
              h(
                'div',
                { className: 'dsh-reading-name' },
                h('span', {
                  className: 'dsh-reading-dot',
                  style: {
                    background: snap.ttsAlive
                      ? 'var(--dsw-alias-state-success-primary, #34a853)'
                      : 'var(--dsw-alias-state-error-primary, #ea4335)',
                  },
                }),
                tr('tts'),
              ),
            ),
            h('span', { className: 'dsh-reading-msg' }, snap.ttsAlive ? tr('online') : tr('offline')),
          ),
        ),
      )
    }

    // ------------------------------------------------------------- wiring --

    const inject = ['connection', 'slots']

    function apply(ctx) {
      ctx.effect(() => {
        const element = document.createElement('style')
        element.setAttribute('data-plugin', 'dsh-shorekeeper-reading')
        element.textContent = CSS
        document.head.appendChild(element)
        return () => element.remove()
      }, 'shorekeeper-reading: styles')

      const connection = ctx.get('connection')
      const call = async (action, payload) => {
        const res = await connection.rpc.call('/reading-panel', action, payload || {})
        if (!res || typeof res !== 'object' || res.ok !== true) {
          throw new Error((res && res.error && res.error.message) || 'reading-panel RPC 调用失败')
        }
        return res.value
      }

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'shorekeeper-reading',
            order: 43,
            label: () => tr('panelName'),
          },
          PanelIcon,
        ),
      )

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: 'shorekeeper-reading',
            inject: () => ({ call }),
          },
          ReadingPanel,
        ),
      )
    }

    return { apply, inject }
  },
})
