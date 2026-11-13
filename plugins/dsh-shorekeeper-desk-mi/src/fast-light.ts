/** 微信守岸人会话的灯控快路径。只认「点名的一盏灯 + 一个动作」，其余交给模型。 */

export type LightName = '灯带' | '台灯' | '挂灯'

export interface LightCommand {
  name: LightName
  action: 'on' | 'off' | 'brightness'
  brightness?: number
  /** 相对调光的口头说法，回复用它，不报一个编出来的绝对亮度 */
  phrase?: '亮一点' | '暗一点'
}

const TYPOS: Array<[string, LightName]> = [
  ['灯袋', '灯带'],
  ['灯戴', '灯带'],
  ['登带', '灯带'],
  ['当代', '灯带'],
  ['台登', '台灯'],
  ['太灯', '台灯'],
  ['抬灯', '台灯'],
]

const NAMES: LightName[] = ['灯带', '台灯', '挂灯']

const FILLERS = /^(?:请|帮|帮忙|把|给|我|你|一下|下|吧|了|的|先|就|啊|呀|哦|都|也|要|想|让|将|嗯)+$/

export function matchLightCommand(text: string): LightCommand | null {
  const raw = String(text ?? '').trim()
  if (raw === '') return null
  if (/[吗么？?]/.test(raw) || /开着|关着|是不是/.test(raw)) return null

  let normalized = raw
  for (const [from, to] of TYPOS) normalized = normalized.split(from).join(to)

  const hits = NAMES.filter((name) => normalized.includes(name))
  if (hits.length !== 1) return null
  const name = hits[0]
  if (name === undefined) return null

  const numbered = /(?:调到|亮度)\s*(\d{1,3})/.exec(normalized)
  let command: LightCommand | null = null
  if (numbered) {
    const brightness = Number(numbered[1])
    if (brightness < 1 || brightness > 100) return null
    command = { name, action: 'brightness', brightness }
  } else if (/亮一点|调亮/.test(normalized)) {
    command = { name, action: 'brightness', brightness: 80, phrase: '亮一点' }
  } else if (/暗一点|调暗/.test(normalized)) {
    command = { name, action: 'brightness', brightness: 35, phrase: '暗一点' }
  } else if (/(?:关掉|关上|关闭|关灯|熄掉|熄了)/.test(normalized) || adjacent(normalized, name, '关')) {
    command = { name, action: 'off' }
  } else if (/(?:打开|开灯|点亮|开启)/.test(normalized) || adjacent(normalized, name, '开')) {
    command = { name, action: 'on' }
  }
  if (!command) return null
  if (leftover(normalized, name, command)) return null
  return command
}

function adjacent(text: string, name: string, verb: '开' | '关'): boolean {
  if (text.includes('开关')) return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = verb === '开'
    ? new RegExp(`${escaped}\\s*开(?!关|着)|(?<!关)开\\s*${escaped}`)
    : new RegExp(`${escaped}\\s*关(?!闭|掉|上|灯|着)|关\\s*${escaped}`)
  return pattern.test(text)
}

function leftover(text: string, name: string, command: LightCommand): boolean {
  let rest = text.split(name).join('')
  const phrases = ['打开', '开灯', '点亮', '开启', '关掉', '关上', '关闭', '关灯', '熄掉', '熄了', '亮一点', '调亮', '暗一点', '调暗', '调到', '亮度']
  for (const phrase of phrases) rest = rest.split(phrase).join('')
  if (command.brightness !== undefined) rest = rest.replace(String(command.brightness), '')
  rest = rest.replace(/[\s，,。.!！~～、]/g, '')
  if (rest === '' || FILLERS.test(rest)) return false
  return true
}

export function lightReply(command: LightCommand, ok: boolean): string {
  if (!ok) return '这次没动成。'
  if (command.action === 'on') return `好。${command.name}给你留亮了。`
  if (command.action === 'off') return `好。${command.name}关掉了。`
  if (command.phrase) return `好。${command.name}${command.phrase}。`
  return `好。${command.name}调到 ${command.brightness}。`
}
