/** 网关⇄客户端真 HTTP 集成测试。默认跳过；设 GW_URL（+可选 GW_TOKEN）指向一个
 * 跑着增补路由的网关实例才执行。CI 不受影响（check-all 不设 GW_URL）。
 *
 *   python3 -m dock_hub --config <测试hub.yaml>   # 网关侧（hub-slim 8503d28+）
 *   GW_URL=http://127.0.0.1:17899 GW_TOKEN=… npx vitest run test/gateway.live.test.ts
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { GatewayClient } from '../src/gateway.ts'
import type { Snapshot } from '../src/types.ts'

const BASE = process.env.GW_URL ?? ''
const TOKEN = process.env.GW_TOKEN ?? ''
const d = BASE ? describe : describe.skip

let snap = async (): Promise<Snapshot> => {
  const response = await fetch(`${BASE}/v1/snapshot`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  return (await response.json()) as Snapshot
}

d('网关⇄客户端集成（真 HTTP）', () => {
  let gw: GatewayClient

  beforeEach(() => {
    gw = new GatewayClient({ baseUrl: BASE, token: TOKEN })
  })

  it('caption 推送 → snapshot.caption 带文本/at/scale', async () => {
    await gw.caption('漂泊者，晚上好。', { scale: 110 })
    const s = await snap()
    expect(s.caption?.text).toBe('漂泊者，晚上好。')
    expect(s.caption?.at).toBeTruthy()
    expect(s.caption?.scale).toBe(110)
  })

  it('caption 清除 → null', async () => {
    await gw.caption('一句话')
    await gw.clearCaption()
    expect((await snap()).caption).toBeNull()
  })

  it('caption 空请求 → 400', async () => {
    await expect(gw.caption('')).rejects.toMatchObject({ status: 400 })
  })

  it('caption scale 越界 → 400', async () => {
    await expect(gw.caption('x', { scale: 300 })).rejects.toMatchObject({ status: 400 })
  })

  it('layout 两次写入 → rev=2 且槽位合并', async () => {
    await gw.setPhoneLayout({ rev: 0, modules: { Weather: { x: 0.6, y: 0.1, w: 0.3, h: 0.3, visible: false } } })
    await gw.setPhoneLayout({
      rev: 0,
      modules: { Weather: { x: 0.55, visible: true }, Clock: { x: 0.05, y: 0.05, w: 0.4, h: 0.4, visible: true } },
    })
    const layout = (await snap()).phone?.layout
    expect(layout?.rev).toBe(2)
    expect(layout?.modules?.Weather).toMatchObject({ x: 0.55, visible: true, w: 0.3 })
    expect(layout?.modules?.Clock?.visible).toBe(true)
  })

  it('layout 非法矩形 → 400', async () => {
    await expect(gw.setPhoneLayout({ rev: 0, modules: { Clock: { x: 5 } } })).rejects.toMatchObject({ status: 400 })
  })

  it('lock 请求 → snapshot.lock.requested_at', async () => {
    await gw.lock()
    expect((await snap()).lock?.requested_at).toBeTruthy()
  })

  it('错 token → 401', async () => {
    await expect(new GatewayClient({ baseUrl: BASE, token: 'wrong' }).caption('x')).rejects.toMatchObject({
      status: 401,
    })
  })
})
