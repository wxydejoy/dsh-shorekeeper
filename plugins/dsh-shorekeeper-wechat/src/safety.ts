/** 安全红线：脱敏、敏感消息识别、白名单。全部纯函数，单独单测。
 *
 * 红线清单（任务书）：默认只读不发；验证码/转账类消息只提示不代读全文；
 * 发送走审批 + 联系人白名单，白名单外硬拒；脱敏默认开。
 */

import { createHash } from 'node:crypto'
import type { SensitiveVerdict } from './types.ts'

/** 人名脱敏：稳定别名（同名同别名，跨次调用不漂）。『联系人-8f3a』式，不泄露真名。 */
export function maskName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '未知联系人'
  const digest = createHash('sha256').update(trimmed).digest('hex').slice(0, 4)
  return `联系人-${digest}`
}

const OTP_PATTERN = /验证码|校验码|confirmation code|verification code|otp/i
const OTP_CODE_PATTERN = /\b\d{4,8}\b/
const PAYMENT_PATTERN = /转账|转了\s*\d|转你\s*\d|红包|付款|支付|收款|到账|提现/

/** 敏感消息识别：命中即只提示、不代读全文、更不代发。 */
export function scanSensitive(text: string): SensitiveVerdict {
  if (PAYMENT_PATTERN.test(text)) {
    return { kind: 'payment', reason: '消息疑似涉及转账/支付类内容' }
  }
  if (OTP_PATTERN.test(text) && OTP_CODE_PATTERN.test(text)) {
    return { kind: 'otp', reason: '消息疑似包含验证码' }
  }
  return { kind: 'normal', reason: '' }
}

/** 白名单判定：id 或显示名精确命中任一即放行。 */
export function isWhitelisted(contactId: string, contactName: string, whitelist: readonly string[]): boolean {
  if (whitelist.length === 0) return false
  const id = contactId.trim()
  const name = contactName.trim()
  return whitelist.some((entry) => {
    const candidate = entry.trim()
    return candidate !== '' && (candidate === id || candidate === name)
  })
}
