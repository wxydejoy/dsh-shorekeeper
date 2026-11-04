import { describe, expect, it } from 'vitest'
import { backgroundBaseUrl, hubBaseUrl, type K20Config } from '../src/config.ts'

function config(overrides: Partial<K20Config> = {}): K20Config {
  return {
    host: 'http://k20.lan',
    port: 17890,
    token: 'tokentokentoken',
    backgroundPort: 17920,
    captionScale: 100,
    lockEnabled: false,
    ...overrides,
  }
}

describe('base URL 拼装', () => {
  it('缺省 hubHost：hub 面与背景面共用 host（同机部署）', () => {
    expect(hubBaseUrl(config())).toBe('http://k20.lan:17890')
    expect(backgroundBaseUrl(config())).toBe('http://k20.lan:17920')
  })

  it('hubHost 空串/纯空白：回落 host，不产出空 host', () => {
    expect(hubBaseUrl(config({ hubHost: '' }))).toBe('http://k20.lan:17890')
    expect(hubBaseUrl(config({ hubHost: '   ' }))).toBe('http://k20.lan:17890')
  })

  it('hub 与 k20 不同机：hub 面走 hubHost，背景面仍走 host', () => {
    const c = config({ hubHost: 'http://127.0.0.1' })
    expect(hubBaseUrl(c)).toBe('http://127.0.0.1:17890')
    expect(backgroundBaseUrl(c)).toBe('http://k20.lan:17920')
  })

  it('hubHost 末尾斜杠与 port 拼接不重复', () => {
    expect(hubBaseUrl(config({ hubHost: 'http://10.14.14.117/' }))).toBe('http://10.14.14.117:17890')
  })
})
