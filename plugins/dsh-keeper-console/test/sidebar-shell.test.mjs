// 侧栏合并的契约测试：三个插件的浏览器半区各跑一遍 apply()，
// 看它们把面板注册到哪儿——守岸人只有一个侧栏入口，其余都挂进 keeper.tabs。
//
// 不用真浏览器：__ModuleLoader__ / React / document / ctx 都打桩，
// 只验注册契约（谁注册了哪个槽、id/order/children 对不对）。
// 渲染本身（标签栏长什么样）靠人工看一眼。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGINS = join(HERE, '..', '..')

const BUNDLES = {
  console: join(PLUGINS, 'dsh-keeper-console', 'lib', 'client.js'),
  k20: join(PLUGINS, 'dsh-shorekeeper-k20', 'client.js'),
  reading: join(PLUGINS, 'dsh-shorekeeper-reading', 'client.js'),
}

/** 假 React：组件是普通函数，hooks 返回稳定值，建元素只留类型与 props */
function fakeReact() {
  const states = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'Fragment',
    useState: (initial) => {
      const value = typeof initial === 'function' ? initial() : initial
      return [value, () => undefined]
    },
    useEffect: () => undefined,
    useCallback: (fn) => fn,
    useRef: (initial) => ({ current: initial }),
    useMemo: (fn) => fn(),
  }
  states.length = 0
  return React
}

function runBundle(path) {
  const source = readFileSync(path, 'utf8')
  const registrations = []
  let mod
  const window = {
    __ModuleLoader__: { load: (definition) => { mod = definition } },
    localStorage: { getItem: () => null, setItem: () => undefined },
    confirm: () => false,
    open: () => undefined,
    addEventListener: () => undefined,
  }
  const document = {
    createElement: () => ({ setAttribute: () => undefined, remove: () => undefined }),
    head: { appendChild: () => undefined },
  }
  const fakeRequire = (name) => {
    if (name === 'react') return fakeReact()
    throw new Error(`未打桩的模块：${name}`)
  }
  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'document', 'globalThis', 'navigator', 'fetch', source)
  run(window, document, window, { language: 'zh-CN' }, () => Promise.reject(new Error('测试里不该发请求')))
  assert.ok(mod, `${path} 没有调用 __ModuleLoader__.load`)
  assert.equal(typeof mod.factory, 'function')

  const exported = mod.factory(fakeRequire)

  const slots = {
    inject: (name, callback) => { callback() },
    register: (spec, component) => {
      registrations.push({ ...spec, component })
      return () => undefined
    },
    entriesOfSlot: () => [],
    subscribe: () => () => undefined,
    provideRoot: () => () => undefined,
  }
  const ctx = {
    slots,
    get: (name) => (name === 'connection' ? { rpc: { call: async () => ({ ok: true, value: {} }) } } : undefined),
    effect: (fn) => { fn(); return () => undefined },
    logger: () => ({ info: () => undefined, warn: () => undefined }),
  }
  exported.apply(ctx)
  return { registrations, exported }
}

describe('侧栏只剩一个守岸人入口', () => {
  const console_ = runBundle(BUNDLES.console)
  const k20 = runBundle(BUNDLES.k20)
  const reading = runBundle(BUNDLES.reading)

  it('三个包合起来只注册一行 sidebar.panellist', () => {
    const rows = [...console_.registrations, ...k20.registrations, ...reading.registrations]
      .filter((entry) => entry.name === 'sidebar.panellist')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, 'keeper-console')
    assert.equal(rows[0].order, 42)
  })

  it('console 的 main 面板声明 keeper.tabs 子槽', () => {
    const main = console_.registrations.filter((entry) => entry.name === 'main')
    assert.equal(main.length, 1)
    assert.equal(main[0].key, 'keeper-console')
    assert.deepEqual(main[0].children, { 'keeper.tabs': { kind: 'list', scope: 'root' } })
  })

  it('k20 与阅读不再抢 main / 侧栏，只往 keeper.tabs 挂一格', () => {
    for (const bundle of [k20, reading]) {
      assert.equal(bundle.registrations.filter((entry) => entry.name === 'main').length, 0)
      assert.deepEqual(
        bundle.registrations.filter((entry) => entry.name === 'keeper.tabs').map((entry) => entry.id),
        bundle === k20 ? ['k20-layout'] : ['shorekeeper-reading'],
      )
    }
  })

  it('标签顺序：设置 10 < 主屏布局 20 < 阅读 30', () => {
    const tabs = [...console_.registrations, ...k20.registrations, ...reading.registrations]
      .filter((entry) => entry.name === 'keeper.tabs')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    assert.deepEqual(tabs.map((entry) => [entry.id, entry.order]), [
      ['keeper-settings', 10],
      ['k20-layout', 20],
      ['shorekeeper-reading', 30],
    ])
  })

  it('每格都自带 RPC 注入（壳不碰业务）', () => {
    for (const bundle of [console_, k20, reading]) {
      for (const entry of bundle.registrations.filter((item) => item.name === 'keeper.tabs')) {
        assert.equal(typeof entry.inject, 'function', `${entry.id} 缺 inject`)
        assert.equal(typeof entry.inject().call, 'function', `${entry.id} 的 inject 没给 call`)
      }
    }
  })

  it('壳的 tabs 目录由 main 的 inject 提供（不是靠外部塞）', () => {
    const main = console_.registrations.find((entry) => entry.name === 'main')
    assert.equal(typeof main.inject, 'function')
    const injected = main.inject()
    assert.equal(typeof injected.tabs.value, 'function')
    assert.equal(typeof injected.tabs.subscribe, 'function')
    assert.deepEqual(injected.tabs.value(), [])
  })

  it('壳能渲染：标签按钮齐 + 只渲染当前标签', () => {
    const main = console_.registrations.find((entry) => entry.name === 'main')
    assert.ok(main)
    const calls = []
    const tabs = {
      value: () => [
        { id: 'keeper-settings', order: 10, label: '设置' },
        { id: 'k20-layout', order: 20, label: '主屏布局' },
      ],
      subscribe: () => () => undefined,
    }
    // 走真实的 props 组合顺序：kit(renderSlot) + inject(tabs) + ownerProps({})
    const tree = main.component({ ...main.inject(), tabs, renderSlot: (name, props, options) => {
      calls.push({ name, options })
      return { type: 'slot', props: { name } }
    } })
    assert.equal(tree.type, 'div')
    const head = tree.children[0]
    const nav = head.children[1]
    assert.equal(nav.type, 'nav')
    // createElement 不摊平数组：map 出来的按钮是 nav 的唯一一个 child
    const buttons = nav.children[0]
    assert.deepEqual(buttons.map((button) => button.children), [['设置'], ['主屏布局']])
    assert.equal(buttons[0].props.className.includes('on'), true)
    assert.equal(buttons[1].props.className.includes('on'), false)
    assert.deepEqual(calls, [{ name: 'keeper.tabs', options: { only: 'keeper-settings' } }])
  })

  it('每个标签组件都能渲染出东西（属性名/语法没写错）', () => {
    const call = async () => ({})
    for (const bundle of [console_, k20, reading]) {
      for (const entry of bundle.registrations.filter((item) => item.name === 'keeper.tabs')) {
        const injected = entry.inject()
        const node = entry.component({ ...injected, call })
        assert.ok(node && typeof node === 'object', `${entry.id} 没渲染出节点`)
      }
    }
  })

  it('每个包都还是合法的客户端插件（apply + inject）', () => {
    for (const bundle of [console_, k20, reading]) {
      assert.equal(typeof bundle.exported.apply, 'function')
      assert.ok(Array.isArray(bundle.exported.inject))
    }
  })
})
