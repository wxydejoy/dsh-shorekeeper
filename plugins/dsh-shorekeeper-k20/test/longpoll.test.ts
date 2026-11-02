import { describe, expect, it, vi } from 'vitest'
import { SnapshotWatcher } from '../src/longpoll.ts'
import type { HubClient } from '../src/hub-client.ts'
import type { Snapshot } from '../src/types.ts'

function stubClient(sequence: number[], failFirst = 0): HubClient & { calls: number; sincings: (number | undefined)[] } {
  let index = 0
  let calls = 0
  const sincings: (number | undefined)[] = []
  const client = {
    get calls() {
      return calls
    },
    sincings,
    async snapshot(options: { since?: number; wait?: number } = {}): Promise<Snapshot> {
      calls += 1
      sincings.push(options.since)
      if (calls <= failFirst) throw new Error('hub down')
      const seq = sequence[Math.min(index, sequence.length - 1)] ?? 0
      index += 1
      return { protocol: 1, seq, hub: { name: 'study', mijia: 'ok', message: null }, temperature: null, devices: [] } as Snapshot
    },
  }
  return client as HubClient & { calls: number; sincings: (number | undefined)[] }
}

describe('SnapshotWatcher', () => {
  it('按 seq 依次推送快照，成功后清零退避', async () => {
    const client = stubClient([1, 2, 3])
    const seen: number[] = []
    const watcher = new SnapshotWatcher({
      client,
      waitSec: 0,
      pollIntervalMs: 5,
      onSnapshot: (snap) => seen.push(snap.seq ?? -1),
    })
    watcher.start()
    await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(3))
    watcher.stop()
    expect(seen.slice(0, 3)).toEqual([1, 2, 3])
  })

  it('报错走退避重试，恢复后继续推送', async () => {
    const client = stubClient([10], 2)
    const seen: number[] = []
    const errors: unknown[] = []
    const watcher = new SnapshotWatcher({
      client,
      waitSec: 0,
      pollIntervalMs: 5,
      errorBackoffStartMs: 10,
      onSnapshot: (snap) => seen.push(snap.seq ?? -1),
      onError: (error) => errors.push(error),
    })
    watcher.start()
    await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(1))
    watcher.stop()
    expect(seen[0]).toBe(10)
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })

  it('since 跟随最新 seq 传给下一轮', async () => {
    const client = stubClient([7, 9])
    const watcher = new SnapshotWatcher({
      client,
      waitSec: 0,
      pollIntervalMs: 5,
      onSnapshot: () => {},
    })
    watcher.start()
    await vi.waitFor(() => expect(client.calls).toBeGreaterThanOrEqual(3))
    watcher.stop()
    // 第一轮没有 since；之后每轮带上上一轮的 seq
    expect(client.sincings[0]).toBeUndefined()
    expect(client.sincings[1]).toBe(7)
    expect(client.sincings[2]).toBe(9)
  })
})
