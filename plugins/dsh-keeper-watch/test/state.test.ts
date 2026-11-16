import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileGateStore, parseGateState } from '../src/state.ts'

describe('parseGateState', () => {
  it('正常状态读回来', () => {
    expect(parseGateState('{"day":"2026-11-16","count":3,"alerted":{"pm25":"2026-11-16"}}')).toEqual({
      day: '2026-11-16',
      count: 3,
      alerted: { pm25: '2026-11-16' },
    })
  })
  it('坏了/缺字段一律当没有（宁可多说一句，不能永远闭嘴）', () => {
    expect(parseGateState('not json')).toBeNull()
    expect(parseGateState('null')).toBeNull()
    expect(parseGateState('[]')).toBeNull()
    expect(parseGateState('{"count":1}')).toBeNull()
    expect(parseGateState('{"day":"2026-11-16"}')).toBeNull()
    expect(parseGateState('{"day":"2026-11-16","count":-1}')).toBeNull()
    expect(parseGateState('{"day":"2026-11-16","count":"3"}')).toBeNull()
  })
  it('alerted 里的脏值只丢那一条，不影响整体', () => {
    expect(parseGateState('{"day":"2026-11-16","count":1,"alerted":{"pm25":"2026-11-16","x":5}}')).toEqual({
      day: '2026-11-16',
      count: 1,
      alerted: { pm25: '2026-11-16' },
    })
  })
})

describe('createFileGateStore', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'keeper-watch-state-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('文件还没写过：load 回 null', () => {
    expect(createFileGateStore(join(dir, 'state.json')).load()).toBeNull()
  })

  it('存了能读回来（重启场景）', () => {
    const path = join(dir, 'state.json')
    createFileGateStore(path).save({ day: '2026-11-16', count: 2, alerted: { pm25: '2026-11-16' } })
    // 新实例 = 新进程：从同一个文件读
    expect(createFileGateStore(path).load()).toEqual({
      day: '2026-11-16',
      count: 2,
      alerted: { pm25: '2026-11-16' },
    })
  })

  it('文件内容坏了：load 回 null 而不是抛错', () => {
    const path = join(dir, 'state.json')
    writeFileSync(path, '{oops')
    expect(createFileGateStore(path).load()).toBeNull()
  })

  it('目录不可写：save 只 warn，不抛', () => {
    const warnings: string[] = []
    const store = createFileGateStore(join(dir, 'nope', 'deep', 'state.json'), (m) => warnings.push(m))
    expect(() => store.save({ day: '2026-11-16', count: 1, alerted: {} })).not.toThrow()
    expect(warnings).toHaveLength(1)
  })
})
