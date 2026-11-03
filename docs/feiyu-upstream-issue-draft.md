# feiyu-memory 上游 issue 草稿（B5/W11 产出，待漂泊者过目后提交）

> 状态：**草稿**。提交与否、提交到哪个仓库（feiyu-memory 的 issue 区）由漂泊者决定。
> 本仓库内部的临时缓解：web profile 对 feiyu-memory@4.0.2 打了 pnpm patch（见下「修复」），重装不丢（patchedDependencies 留痕）。

---

## 标题

固化/补总结在「provider 拒绝 reasoningEffort」时整体静默失效：失败以 finish chunk（`reason.kind`）到达，但代码只检查 throw 与 `finish.kind`

## 环境

- feiyu-memory 4.0.2；宿主 dsh 0.2.1-rc.5（Node 25.9.0，macOS arm64）
- provider：dsh-llm-pi-ai，`api: openai-completions`，模型 zhipu GLM-4-Flash（glm-4-flash-250414，open.bigmodel.cn）
- 触发条件：任何**不声明 thinking 档位映射**的 provider 模型（pi-ai 对未声明模型目录默认 `reasoning: true`，`resolveReasoningLevel` 会拒绝 `off`）。走 openrouter 的环境不触发（其模型声明了档位），所以此前未暴露。

## 症状

- 固化、补总结（summary backfill）全部静默不产出：debug log 显示「模型返回 1 个 chunk / 0 字符 → 日记解析失败，丢弃：模型没有输出任何内容」，三批空后补总结自停。
- judge 判断同样拿不到模型输出，但 judge 的失败默认是「按默认记」（keep=true），所以判断环节看不出异常。
- 写侧整体表现为**无报错的沉默**——与 README 里描述过的「600 个 chunk / 0 字符」症状不同源（那次的根因是思考档位跟随；这次是档位被拒后**兜底重试从未触发**）。

## 根因链（`src/host/index.mjs`）

1. `consolidate` 按设计给固化调用传 `opts.reasoningEffort = 'off'`（注释明确：结构化抽取不需要思考，且 provider 不认档位时应「退回不指定重试一次」）。
2. pi-ai 适配层对未声明档位的模型**抛** `LlmError(..., "UNSUPPORTED_REASONING_EFFORT")`；dsh-llm 的 `adapterStream` 把这次 throw 转成**流内终结 chunk**：`{ type: "finish", reason: { kind: "error", failure: { code: "UNSUPPORTED_REASONING_EFFORT", message: ... } } }`（`adapterFailureChunk`）。
3. 现有代码的两处检查都接不住它：
   - `runStream` 外层的 `try/catch` 只能接住**抛出**的异常——这里没有异常抛给调用方；
   - 流结束后的检查读的是 `finish?.kind === 'error'`，而错误信息在 `finish.reason.kind` / `finish.reason.failure` 里——`finish.kind` 恒为 `'finish'`，检查永远落空。
4. 于是 `text === ''` 走进 `parseConsolidation` → 「模型没有输出任何内容」→ 丢弃。专为这个场景写的「退回不指定重试」兜底成了死代码。

## 证据（debugLog 实录，形状级，无对话内容）

```text
调用模型（system 1721 字 / user 323 字 / maxTokens 900 / 思考 off）
收到第一个 chunk（finish）
模型返回 1 个 chunk / 0 字符
finish 原样：{"type":"finish","reason":{"kind":"error","failure":{"message":"provider \"zhipu\" model \"glm-4-flash-250414\" does not support reasoning effort \"off\"","code":"UNSUPPORTED_REASONING_EFFORT"}}}
日记解析失败，丢弃：模型没有输出任何内容
补总结：这批一条都没解析出来（连续 1..3 次）→ 停手
```

补一点旁证：同一 provider/model 上**主链聊天**（agent 正常对话）一直正常——失败只发生在固化这类带 `reasoningEffort: 'off'` 的带外调用上。

## 修复建议（已在本机 patch 验证）

在 `runStream` 返回后、走 `parseConsolidation` 之前，把 chunk 形态的失败接住并触发既有退档重试：

```js
const failKind = finish?.reason?.kind ?? finish?.kind;
const failCode = finish?.reason?.failure?.code ?? finish?.failure?.code;
const failMsg  = finish?.reason?.failure?.message ?? finish?.failure?.message ?? '';
if (failKind === 'error' && opts.reasoningEffort !== undefined
    && /REASONING_EFFORT/i.test(String(failCode) + ' ' + failMsg)) {
  delete opts.reasoningEffort;            // 退回不指定，重试一次
  run = await runStream(opts); ...
}
else if (failKind === 'error' || failKind === 'aborted') { /* 原有的失败日志路径 */ }
```

验证结果：同一环境修后连续三轮对话，`判断：记 → 退回不指定重试 → 真实流式（block-start…stop）→ 记下一条（salience 0.60）`，日记 5→7 条；补总结待下次启动自跑。

## 顺带一个非 bug 观察

feiyu 的 messages 用块数组 content（`[{type:'text',…}]`）——pi-ai 内部契约需要它，wire 层自会拍平成字符串（对 openai-completions 抓包确认），无需改动；我们曾误改成字符串，pi-ai 直接 `content.some is not a function`，改回后正常。
