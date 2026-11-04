/** W6 真机联调（k20.lan 在线时跑）。默认跳过；设 REAL_K20=1 + K20_TOKEN 才执行。
 * 覆盖五工具：snapshot / caption / wallpaper / layout / media。lock 是高危项，不入本文件
 * （走 gateway.live.test.ts 的 lock 用例 + 漂泊者点头）。
 *
 *   REAL_K20=1 K20_TOKEN=… HUB_URL=http://127.0.0.1:17890 \
 *     npx vitest run test/real-device.live.test.ts
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { HubClient } from '../src/hub-client.ts'
import { BackgroundClient } from '../src/background-client.ts'
import { GatewayClient } from '../src/gateway.ts'
import type { PhoneModuleRect } from '../src/types.ts'

const TOKEN = process.env.K20_TOKEN ?? ''
const HUB = process.env.HUB_URL ?? 'http://127.0.0.1:17890'
const BG = process.env.BG_URL ?? 'http://k20.lan:17920'
const d = process.env.REAL_K20 === '1' && TOKEN ? describe : describe.skip

/** 64x64 的纯色探针 PNG（base64），upload 用完即删 */
const PROBE_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAKklEQVR4nO3NMQEAIAzAsIF/z0OGBx4S' +
      '0b4AAAAAAACAe1l1AwAAAAAAAABg5wEeaQABhUt9cgAAAABJRU5ErkJggg==',
    'base64',
  ),
)

d('W6 真机联调（k20.lan）', () => {
  let hub: HubClient
  let bg: BackgroundClient
  let gw: GatewayClient

  beforeEach(() => {
    hub = new HubClient({ baseUrl: HUB, token: TOKEN })
    bg = new BackgroundClient({ baseUrl: BG, token: TOKEN })
    gw = new GatewayClient({ baseUrl: HUB, token: TOKEN })
  })

  it('k20_snapshot：真机在线，snapshot 有真数据', async () => {
    const snap = await hub.snapshot()
    expect(snap.hub.name).toBeTruthy()
    expect(Array.isArray(snap.devices)).toBe(true)
  })

  it('k20_caption：推真字幕 → 屏上可见 → 清除', async () => {
    await gw.caption('W6 真机联调 · 守岸人', { scale: 110 })
    const pushed = await hub.snapshot()
    expect(pushed.caption?.text).toBe('W6 真机联调 · 守岸人')
    await gw.clearCaption()
    expect((await hub.snapshot()).caption).toBeNull()
  })

  it('k20_wallpaper：list → 上传探针图（即生效）→ 还原 → 删探针', async () => {
    const before = await bg.backgrounds()
    const original = before.current
    const uploaded = await bg.upload('w6-probe.png', PROBE_PNG, '真机联调探针')
    expect(uploaded.current).not.toBeNull()
    expect(uploaded.current).not.toBe(original)
    if (original) await bg.select(original)
    else await bg.clear()
    const restored = await bg.backgrounds()
    expect(restored.current).toBe(original)
    const afterRemove = await bg.remove(uploaded.items.find((i) => i.name === 'w6-probe.png')?.id ?? '')
    expect(afterRemove.items.find((i) => i.name === 'w6-probe.png')).toBeUndefined()
  })

  it('k20_layout：读现状 → 原样回写 → rev 递增', async () => {
    // 安卓 /api/layout 的形状：{ canvas, slots, defaults, modules: { version: 1, modules: {…} } }
    // 网关校验 modules 每项必须是对象，所以回写只取嵌在里面的真模块表
    const beforeSnap = await hub.snapshot()
    const revBefore = beforeSnap.phone?.layout?.rev ?? 0
    const raw = (await bg.layout()) as {
      modules?: { modules?: Record<string, Partial<PhoneModuleRect>> }
    }
    const moduleMap = raw.modules?.modules ?? {}
    await gw.setPhoneLayout({ modules: moduleMap })
    const snap = await hub.snapshot()
    const rev = snap.phone?.layout?.rev
    expect(rev).toBeGreaterThan(revBefore)
  })

  it('k20_media：toggle 两次回到原播放态，命令面通', async () => {
    const before = (await hub.snapshot()).media?.playing ?? false
    await hub.media('toggle')
    const second = await hub.media('toggle')
    expect(second.playing).toBe(before)
  })
})
