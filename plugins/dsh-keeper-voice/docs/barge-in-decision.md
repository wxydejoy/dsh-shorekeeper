# 决策记录 · barge-in 第二层调研（Z9 · 2026-11-05）

> 问题：dsh-voice-mode 的打断事件有没有公开钩子，能让 dsh-keeper-voice 在用户开口打断时
> 联动 `POST /v1/stop` 清 keeper-tts 的喇叭队列与在途合成？
> 结论：**没有公开钩子，降级为手动停止工具**（现状 keeper.stop 即该工具），不再找第二层。

## 证据（dsh-voice-mode 0.7.34 dist 反查）

1. **inject 面**：`inject = ['webServer', 'settings', 'sessions']`——纯消费方，不对外提供服务/事件总线。
2. **barge-in 全内部**：`bargeInMode`（detect/auto/manual）+ `interruptLevel` + 回声门控（echoGate）
   都在插件自己的浏览器音频管线里闭环：VAD/回声判定 → 内部中止 TTS 播放队列 → 转识别。
   dist 里没有 `ctx.emit` / 对外 `publish` / 生命周期事件注册点（唯一的 `subscribe(listener)` 是
   TTS 队列的**音频帧广播**（web UI 波形用），不是打断事件；`interrupt()` 是 Sherpa 引擎
   子进程内部方法）。
3. **对 keeper 链路的实际影响**：T4 的语音出声走 `dsh-tts provider(custom→keeper-tts)`，
   字节喂给 dsh-tts 播放器——voice-mode 打断时直接杀播放器，keeper 的**已交付字节**随之停，
   链路天然闭环；唯一浪费是 keeper-tts **在途合成**（服务端 --play 时它自己喇叭也在响）。
4. **冗余保险现状**：`keeper.stop` 工具（POST /v1/stop，幂等 200）已覆盖「清 keeper 喇叭队列 +
   作废在途合成」。没有事件钩子的情况下，自动联动无从谈起，手动工具是当前正确形态。

## 影响

- **不做**：自动「打断事件 → /v1/stop」接线。
- **维持**：keeper.stop 手动工具 + dsh-tts 播放器层的自然停。
- **将来若做**：盯 dsh-voice-mode 上游是否长出公共打断事件（或宿主级 abort 事件），到时一行
  `subscribe → keeper.stop()` 即可接上；本决策届时作废。

## 附：8bit 情绪 tag 探测（Z9 同批）

keeper-tts `/v1/audio/speech` 实际消费的 body 键：`input / voice / speed / response_format /
play / play_only`（server.py 逐行核对）——**没有 emotion/tag/style 参数位**（「8bit」是模型文件名
Qwen3-TTS-12Hz-1.7B-Base-8bit，不是情绪能力）。**跳过透传**；将来引擎升级出情绪面再加。
