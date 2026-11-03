# T4 决策记录 · 唤醒词链路（框架，待实测填空）

> 2026-11-03 · 值班 agent · 对比框架成文；**拍板等 T1 人工项 3（语音链路真机实测）的数据**。

## 待对比的两条路线

| | 路线甲：安卓保留「小岸」唤醒 → 推文本 | 路线乙：voice-mode 免提模式全接管 |
|---|---|---|
| 唤醒 | k20 本地 sherpa-onnx 唤醒模型（现有资产），唤醒后转写文本推给 dsh | voice-mode 自带 STT 常听 + 免提自动发送（方案 §1.1 已列能力） |
| 打断 | 现有 companion/stop 链路（岸亭已验证） | voice-mode barge-in + dsh-tts 播放器停 + keeper.stop 兜底（T4 已接） |
| 依赖 | k20 安卓端小改（推文本通道，走 lan-protocol 增补或 companion 面） | 零安卓改动；依赖 voice-mode 免提模式的中文实测质量 |
| 隐私 | 唤醒词本地检测，不上传 | 常听录音在本地 STT（voice-mode 口径：本地合成/识别） |
| 风险 | sherpa-onnx 模型维护；k20 麦克风阵列质量 | 免提误触发/家庭噪音下的识别率 |

## 决策维度（实测后填）

1. voice-mode 免提模式下中文唤醒→对话→打断全链路的实测体验（T1 人工项 3）
2. k20 麦克风拾音距离/噪声表现（对比 Mac Mini 麦克风）
3. 误触发率与「她被家里其他人唤醒」的处置
4. 双路并存的兼容性：k20 唤醒推文本 + voice-mode 免提同时开是否打架（回声/双入口）

## 倾向（待实测验证后正式拍板）

**初步倾向路线乙（voice-mode 免提全接管）**：零安卓改动、打断闭环已通（T4）、voice-mode 是 T1 钉版清单成员；路线甲作为 k20 麦克风显著更优时的备选。**岸亭仓库的 sherpa-onnx 资产保留不删**，决策翻回甲时随时可用。

## 关联

- 打断闭环：`plugins/dsh-keeper-voice/docs/decisions-voice-provider.md`（barge-in 分层）
- 安卓侧（若走甲）：岸亭仓库另开分支，对照 `reference/lan-protocol.md` 增补
