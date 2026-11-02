# T4 决策记录 · 克隆音色接入面（2026-11-03 · 值班 agent）

> 阶段一产物。基于 `dsh-voice-mode@0.7.34` 与 `@goodandready/dsh-tts@0.4.37` 源码实测（装包读实现，非 README 转述）。

## 结论

**主选：@goodandready/dsh-tts 的 `custom` provider → keeper-tts `/v1/audio/speech`。纯配置接线，零宿主代码改动。**

- dsh-tts 的 provider 列表原生含 `custom`（"Custom OpenAI-compatible"，README §1.1：「Any `/v1/audio/speech` endpoint」），配置键 `customBaseUrl`（`lib/index.js:82`）、API key 走 env `CUSTOM_TTS_API_KEY`（`keys.js:29`）
- dsh-tts 自带：fallback 链、流式 <300ms 播放器、**barge-in**、播放速率、子代理分音色——打断闭环的「播到一半停」由它接管
- keeper-tts 侧（本任务已实现，dock 仓库 `tts-openai-endpoint` 分支 b80bc98）：`POST /v1/audio/speech`（wav/pcm、路由层语速钳位、`InterruptedError → 502 stopped`）；打断复用既有 `POST /v1/stop`

**voice-mode 不做 TTS 改造**：朗读引擎封闭三选一（`ttsEngine: edge | vits | kokoro`，README 配置表 122 行），无自定义 provider 扩展点。它与 dsh-tts 职责正交叠装：voice-mode 管全双工链路（STT + 打断检测 + 字幕），TTS 面归 dsh-tts → keeper-tts。方案 v1 里「与 dsh-tts 二选一或叠装」的判断成立，落「叠装」。

## profile 接线片段（T8 收编）

```yaml
# cordis.patch.yml（dsh-tts 段）
tts:
  provider: custom
  customBaseUrl: http://127.0.0.1:18100
  customModel: keeper            # keeper-tts 忽略 model，占位
  customVoice: shorekeeper       # 克隆模式同样忽略；非克隆音色时生效
# env: CUSTOM_TTS_API_KEY=<keeper-tts 的 --token>（服务端未设 token 则可省）
```

> ⏸ 真机校准（T1）：`customBaseUrl` 是否要带 `/v1/audio/speech` 路径以 dsh-tts client.js 的拼装为准（`index.js:444/457` 只见 baseUrl 参与 URL 组装）；voice → 我们的引擎在克隆模式下忽略该参数。

## barge-in 桥（阶段三剩余项）

- 第一层：dsh-tts 播放器自带 barge-in（本地打断，不动 keeper-tts）
- 第二层（兜底）：voice-mode 打断事件 → `keeper.stop()`（清 keeper 本机喇叭队列 + 作废在途合成）。voice-mode README 未露出公开的打断事件钩子——⏸ T1 真机看它的 SSE/事件面有没有可订阅的打断信号，没有则此层降级为「keeper.stop 工具手动可用」

## 遗留

- 8bit 情绪 tag 透传：keeper-tts 拓展区，待音色服务支持情绪参数
- 唤醒词决策（阶段四）：依赖 T1 的 voice-mode 免提模式实测
