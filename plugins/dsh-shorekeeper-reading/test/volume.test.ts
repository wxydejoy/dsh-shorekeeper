/** volume.ts 测试：runner 注入，验证钳位与静音读写。 */

import { describe, expect, it } from 'vitest'

import { getVolume, setVolume, setMuted, type OsascriptRunner } from '../src/volume.ts'

function fakeRunner(responses: string[]): { runner: OsascriptRunner; scripts: string[] } {
  const scripts: string[] = []
  let i = 0
  const runner: OsascriptRunner = async (script) => {
    scripts.push(script)
    const value = responses[i % responses.length] ?? ''
    i++
    return value
  }
  return { runner, scripts }
}

describe('volume', () => {
  it('getVolume：解析 osascript 输出', async () => {
    const { runner } = fakeRunner(['42\n', 'false\n'])
    const state = await getVolume(runner)
    expect(state).toEqual({ volume: 42, muted: false })
  })

  it('setVolume：钳位 0–100 并下发', async () => {
    const { runner, scripts } = fakeRunner([''])
    expect(await setVolume(130, runner)).toBe(100)
    expect(await setVolume(-5, runner)).toBe(0)
    expect(scripts[0]).toContain('output volume 100')
    expect(scripts[1]).toContain('output volume 0')
  })

  it('setMuted：true/false 下发', async () => {
    const { runner, scripts } = fakeRunner([''])
    await setMuted(true, runner)
    await setMuted(false, runner)
    expect(scripts[0]).toContain('output muted true')
    expect(scripts[1]).toContain('output muted false')
  })
})
