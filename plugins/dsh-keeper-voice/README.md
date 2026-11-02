# dsh-keeper-voice

> 状态：**未开工（T4）** · 任务文档：[docs/tasks/T4-keeper-voice.md](../../docs/tasks/T4-keeper-voice.md)

守岸人的声音：把自有 Qwen3-TTS 克隆音色服务（`:18100`，独立进程保留）注册为 dsh-voice-mode / dsh-tts 的 TTS provider，让守岸人用她自己的声音说话，并打通「说话中被打断立即停」的闭环。

## 计划工具面

| 工具/能力 | 职责 |
|---|---|
| TTS provider 注册 | OpenAI 兼容 `/v1/audio/speech` 桥接到 keeper-tts |
| `keeper.voice_test` | 试听当前音色/语速 |
| barge-in 桥 | voice-mode 打断事件 → keeper-tts 停播 |
| 唤醒词链路 | 安卓「小岸」唤醒 vs voice-mode 免提模式，T4 内做决策落地 |

## 技术要点

- keeper-tts 侧加 OpenAI 兼容端点（Python 独立进程改动最小化）
- 流式分句、播放速率、8bit 情绪 tag 透传
- 打断时序对照 `reference/tts/server.py` 与岸亭 docs/companion.md 的既定行为
- 风险预案：若 voice-mode / dsh-tts 扩展点不够深，全量自写语音插件接管
