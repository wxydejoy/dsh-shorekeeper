// dsh-shorekeeper-reading — browser half（小说朗读面板）。
//
// Registers a sidebar rail icon (sidebar.panellist) and a central panel (main)
// addressed by the same id. All data comes from this package's host half over
// the /reading-panel RPC channel — no model round-trip anywhere.
//
// Sections: 正在朗读（进度 + 停止）· 书架（点书续读 / 目录选章 / 导入 txt）
// · 播放设置（语速 / 定时 / 系统音量）。
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
      emptyShelf: ['书架还是空的——把 txt 拖进下面「导入」', 'The shelf is empty — import a txt below'],
      groupNow: ['正在朗读', 'Now playing'],
      groupShelf: ['书架', 'Shelf'],
      groupImport: ['导入 txt', 'Import txt'],
      groupSetup: ['播放设置', 'Playback'],
      idle: ['没在朗读', 'Idle'],
      resumeFrom: ['断点：约 %d 字处', 'Resume at ~%d chars'],
      noResume: ['还没有断点，从书架挑一本吧', 'No bookmark yet; pick a book below'],
      stop: ['停止', 'Stop'],
      play: ['开读', 'Play'],
      chapters: ['目录', 'Chapters'],
      chaptersNone: ['（没扫出章节结构，只能按断点/从头读）', '(no chapter structure found)'],
      chaptersLoading: ['目录加载中…', 'Loading chapters…'],
      chapterPlay: ['从这章读', 'Read from here'],
      chapterCurrent: ['当前断点在这里', 'bookmark is here'],
      chapterFromStart: ['从头开始（第 1 章前）', 'From the beginning'],
      speed: ['语速', 'Speed'],
      timer: ['定时（分钟，0 = 不限）', 'Timer (min, 0 = unlimited)'],
      timerHint: ['只在本次开读生效，不再沿用上次定时', 'Applies to this play only; no silent carry-over'],
      volume: ['系统音量', 'System volume'],
      muted: ['静音', 'Mute'],
      importPick: ['选 txt 文件导入', 'Pick a txt file'],
      importing: ['导入中…', 'Importing…'],
      importHint: ['支持 UTF-8 / GBK，上限 15MB；导入后出现在书架', 'UTF-8 / GBK, up to 15MB'],
      chunk: ['第 %d / %d 段', 'Chunk %d / %d'],
      readTo: ['已读约 %d 字', 'Read ~%d chars'],
      unreadable: ['书文件不在盘上', 'Text file missing'],
      finished: ['已读完', 'Finished'],
      wishlist: ['想读', 'Wishlist'],
      reading: ['在读', 'Reading'],
      tts: ['本地克隆音色服务 (keeper-tts)', 'Local voice service (keeper-tts)'],
      online: ['在线', 'online'],
      offline: ['离线', 'offline'],
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
.dsh-reading-chapters{margin:6px 0 2px;padding:8px;border:1px dashed var(--dsw-alias-border-l1);border-radius:6px}
.dsh-reading-select{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 6px;font-size:12px;max-width:100%}
.dsh-reading-input{width:76px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px;font-size:12px}
.dsh-reading-range{flex:1;accent-color:var(--dsw-alias-brand-primary)}
.dsh-reading-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.dsh-reading-msg{color:var(--dsw-alias-label-secondary);font-size:12px;margin-left:8px}
.dsh-reading-progress{height:4px;border-radius:2px;background:var(--dsw-alias-border-l1);overflow:hidden;margin:8px 0 2px}
.dsh-reading-progress>div{height:100%;background:var(--dsw-alias-brand-primary);border-radius:2px;transition:width .6s}
.dsh-reading-error{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);border-radius:6px;padding:8px 10px;margin-bottom:12px;white-space:pre-wrap;word-break:break-word}
.dsh-reading-file{font-size:12px;color:var(--dsw-alias-label-secondary)}
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

    function bytesToBase64(bytes) {
      let binary = ''
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
      }
      return btoa(binary)
    }

    // ----------------------------------------------------------- pieces --

    function ChapterPicker({ book, call, busy, onPlayChapter }) {
      const [chapters, setChapters] = useState(null)
      const [pick, setPick] = useState('')
      const load = useCallback(async () => {
        try {
          const value = await call('chapters', { bookId: book.id })
          setChapters(value)
        } catch (e) {
          setChapters({ total: 0, chapters: [], error: String((e && e.message) || e) })
        }
      }, [call, book.id])

      useEffect(() => {
        void load()
      }, [load])

      if (!chapters) return h('div', { className: 'dsh-reading-hint' }, tr('chaptersLoading'))
      if (chapters.error) return h('div', { className: 'dsh-reading-hint' }, chapters.error)
      if (!chapters.total) return h('div', { className: 'dsh-reading-hint' }, tr('chaptersNone'))

      // 默认选中：断点所在章
      const defaultIdx = chapters.chapters.findIndex((c) => book.offset >= c.start && book.offset < c.end)
      const effective = pick !== '' ? Number(pick) : defaultIdx >= 0 ? defaultIdx : -1

      return h(
        'div',
        { className: 'dsh-reading-chapters' },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h(
            'select',
            {
              className: 'dsh-reading-select',
              value: String(effective),
              onChange: (e) => setPick(e.target.value),
              style: { flex: 1 },
            },
            h('option', { value: '-1' }, tr('chapterFromStart')),
            chapters.chapters.map((c) =>
              h('option', { key: c.index, value: String(c.index) }, c.title || '第 ' + (c.index + 1) + ' 节'),
            ),
          ),
          h(
            'button',
            {
              className: 'dsh-reading-btn dsh-reading-btn-primary',
              disabled: busy,
              onClick: () => {
                const ch = effective >= 0 ? chapters.chapters[effective] : null
                onPlayChapter(ch ? ch.start : 0)
              },
            },
            tr('chapterPlay'),
          ),
        ),
        h('div', { className: 'dsh-reading-hint', style: { marginTop: 4 } }, chapters.total + ' 章'),
      )
    }

    // --------------------------------------------------------------- panel --

    function ReadingPanel({ call }) {
      const [snap, setSnap] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [speed, setSpeed] = useState(1.0)
      const [timerDraft, setTimerDraft] = useState(null)
      const [expandedBook, setExpandedBook] = useState(null)
      const [importing, setImporting] = useState(false)
      const [volumeState, setVolumeState] = useState(null)
      const [volumeDraft, setVolumeDraft] = useState(null)
      const aliveRef = useRef(true)
      const fileRef = useRef(null)

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
        void call('volume', {}).then((v) => {
          if (aliveRef.current && v) setVolumeState(v)
        }).catch(() => {})
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') void load()
        }, 3000)
        return () => {
          aliveRef.current = false
          clearInterval(timer)
        }
      }, [load, call])

      const run = useCallback(
        async (action, payload) => {
          setBusy(true)
          setError('')
          try {
            const value = await call(action, payload)
            if (aliveRef.current && value && (action === 'play' || action === 'stop')) setSnap((prev) => value)
            return value
          } catch (e) {
            if (aliveRef.current) setError(String((e && e.message) || e))
            return null
          } finally {
            if (aliveRef.current) setBusy(false)
          }
        },
        [call],
      )

      const play = useCallback(
        async (bookId, fromOffset) => {
          const payload = { speed }
          const timer = timerDraft != null && timerDraft !== '' ? Number(timerDraft) : 0
          payload.timerMin = Number.isFinite(timer) ? Math.max(0, Math.floor(timer)) : 0
          if (bookId) payload.bookId = bookId
          if (typeof fromOffset === 'number') payload.fromOffset = fromOffset
          // 朗读中换书/换章：先停再读（host 会拒绝播放中的 play）
          if (snap && snap.status && snap.status.playing) await run('stop', {})
          const ok = await run('play', payload)
          if (ok) void load()
        },
        [run, speed, timerDraft, snap, load],
      )

      const toggleChapters = useCallback(
        (bookId) => {
          setExpandedBook((prev) => (prev === bookId ? null : bookId))
        },
        [],
      )

      const applyVolume = useCallback(
        async (value) => {
          setVolumeDraft(null)
          setVolumeState((prev) => ({ ...(prev || {}), volume: value }))
          try {
            const v = await call('setVolume', { volume: value })
            if (v && aliveRef.current) setVolumeState(v)
          } catch (e) {
            if (aliveRef.current) setError(String((e && e.message) || e))
          }
        },
        [call],
      )

      const toggleMuted = useCallback(async () => {
        const next = !(volumeState && volumeState.muted)
        setVolumeState((prev) => ({ volume: (prev && prev.volume) || 50, muted: next }))
        try {
          const v = await call('setMuted', { muted: next })
          if (v && aliveRef.current) setVolumeState((prev) => ({ ...(prev || {}), ...v }))
        } catch (e) {
          if (aliveRef.current) setError(String((e && e.message) || e))
        }
      }, [call, volumeState])

      const onImportFile = useCallback(
        async (file) => {
          if (!file) return
          setImporting(true)
          setError('')
          try {
            const bytes = new Uint8Array(await file.arrayBuffer())
            await call('import', { name: file.name, dataBase64: bytesToBase64(bytes) })
            await load()
          } catch (e) {
            if (aliveRef.current) setError('导入失败：' + String((e && e.message) || e))
          } finally {
            if (aliveRef.current) setImporting(false)
            if (fileRef.current) fileRef.current.value = ''
          }
        },
        [call, load],
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
      const timerValue = timerDraft != null ? timerDraft : '0'
      const volume = volumeDraft != null ? volumeDraft : volumeState ? volumeState.volume : 50

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
                      onClick: () => void play(null),
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
                  { key: book.id },
                  h(
                    'div',
                    {
                      className:
                        'dsh-reading-book dsh-reading-row' +
                        (playing && snap.status.bookId === book.id ? ' dsh-reading-book-active' : ''),
                      onClick: () => {
                        if (!busy) void play(book.id)
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
                          toggleChapters(book.id)
                        },
                      },
                      tr('chapters'),
                    ),
                    h(
                      'button',
                      {
                        className: 'dsh-reading-btn',
                        disabled: busy,
                        onClick: (e) => {
                          e.stopPropagation()
                          void play(book.id)
                        },
                      },
                      tr('play'),
                    ),
                  ),
                  expandedBook === book.id
                    ? h(ChapterPicker, {
                        key: 'chapters-' + book.id,
                        book,
                        call,
                        busy,
                        onPlayChapter: (start) => void play(book.id, start),
                      })
                    : null,
                ),
              ),
        ),

        // -- 导入 --
        h(
          'div',
          { className: 'dsh-reading-section' },
          h('div', { className: 'dsh-reading-h' }, tr('groupImport')),
          h(
            'div',
            { className: 'dsh-reading-row' },
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: '.txt,.text,text/plain',
              className: 'dsh-reading-file',
              disabled: importing,
              onChange: (e) => void onImportFile(e.target.files && e.target.files[0]),
            }),
            importing ? h('span', { className: 'dsh-reading-msg' }, tr('importing')) : null,
          ),
          h('div', { className: 'dsh-reading-hint' }, tr('importHint')),
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
            h(
              'div',
              { className: 'dsh-reading-label' },
              h('div', { className: 'dsh-reading-name' }, tr('timer')),
              h('div', { className: 'dsh-reading-hint' }, tr('timerHint')),
            ),
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
              h('div', { className: 'dsh-reading-name' }, tr('volume') + '：' + volume),
            ),
            h('input', {
              className: 'dsh-reading-range',
              type: 'range',
              min: 0,
              max: 100,
              value: volume,
              onChange: (e) => setVolumeDraft(Number(e.target.value)),
              onMouseUp: (e) => void applyVolume(Number(e.target.value)),
              onTouchEnd: (e) => void applyVolume(Number(e.target.value)),
            }),
            h(
              'button',
              { className: 'dsh-reading-btn', onClick: () => void toggleMuted() },
              (volumeState && volumeState.muted ? '取消静音' : tr('muted')),
            ),
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
