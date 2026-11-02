/** 微信桥归一化类型。桥（Windows 挂机侧，wcferry 实现）按 docs/bridge-contract.md 提供这层。 */

export interface DigestGroup {
  /** 桥侧会话稳定 id（wxid 或别名） */
  contactId: string
  /** 显示名（备注名优先） */
  contactName: string
  unread: number
  /** 最近一条摘要（桥侧已截断 ≤120 字） */
  lastMessage: string
  lastAt: string
}

export interface BridgeMessage {
  /** 发送者：群聊里是成员名，私聊同 contactName */
  senderName: string
  text: string
  at: string
  /** 归一化消息类型；桥侧不认识的一律 'text' */
  kind: 'text' | 'image' | 'voice' | 'video' | 'file' | 'system'
}

/** 红线扫描结论 */
export interface SensitiveVerdict {
  kind: 'normal' | 'otp' | 'payment'
  reason: string
}
