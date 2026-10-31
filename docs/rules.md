# 六条铁律：长版

每条都配着它违反之后会看到的原始报错。这些不是推演出来的，是撞出来的。

---

## 1. 一行一帧

**规则**：`session.v4.jsonl.zstd` 是多个 zstd 帧串起来的。写回去的时候，尽量保持
**每帧一行**，或者跟原始文件接近的小帧。

**违反后果**：会话从侧边栏**完全消失**——不报错、点不到、没有"损坏"提示。
同一个文件换成一行一帧再装回去，列表立刻恢复。

**为什么**：读取端按帧推进。一帧里塞 200 行（约 500 KB）的时候，它在**列举阶段**
就失败了，而那个失败没有出口。

**教训**：静默失败比报错危险。报错会给你行号，不显示只告诉你"没了"。
任何看起来"等价"的打包改动，先问：它出错的时候会不会告诉我。

---

## 2. `surfaceOp` 是必需字段

**规则**：格式 v4 里这五类事件必须带 `surfaceOp`：

```
user/message  assistant/message  tool/result  developer/message  system/message
```

合法值只有两种：

```json
"append"
{"op": "replace", "startSeq": 123, "endSeq": 456}
```

对象必须**恰好三个键**，`op` 必须是 `"replace"`，两个端点必须**严格小于**事件自身的 `seq`。
其余事件类型**禁止**携带该字段。

**违反后果**：

- 缺失 → `user/message surfaceOp requires an object`
- 端点不更早 → `surfaceOp.startSeq must reference an earlier event`
- 多一个键 → `requires exact replace fields op/startSeq/endSeq`

**踩坑**：这 17 条 `replace` 长得像"折叠操作留下的坐标残留"，很容易被当成脏数据删掉。
但**原件带着它们能正常加载**——这就证明它们合法。判断字段该不该删，看原件能不能跑，
不看它长得像什么。

---

## 3. 改号是传染的

**规则**：删/插事件之后，除了 `seq` 本身，还要改所有**引用旧编号**的字段：

| 字段 | 形态 |
|---|---|
| `sourceEventSeqs` | 数字，或 `[start, end]` 区间 |
| `developer/message.data.headerSeq` | 数字 |
| `session/title.data.messageSeqs` | 数字数组 |
| `session/title-llm-request.data.messageSeqs` | 数字数组 |
| `session-log-deepseek/delivery-accepted.data.throughSeq` | 数字 |
| `surfaceOp.startSeq` / `surfaceOp.endSeq` | 数字 |

区间要**先展开成单个数字**，映射，去掉映射为 `null` 的（被删掉的），去重，升序。

**违反后果**：`sourceEventSeqs ranges must contain unique earlier seqs`，
或者 `format v4 tool/result at seq N carries error metadata ...` 之类的错位报错。

**注意**：如果某个 `replace` 的端点正好落在你删掉的事件上，**不要自动重定向**。
那条替换的边界已经没了，需要人判断：是换成最近的存活边界，还是整条 `replace` 降级为 `append`。

---

## 4. `data.error` 与 `message.isError` 成对

**规则**：`tool/result` 只有两种合法形态：

- 正常结果：`message.isError` 缺省，`data.error` 缺省
- 错误结果：`message.isError === true`，`data.error` 存在（例 `{"name":"ToolNotFoundError","code":"UNKNOWN_TOOL"}`）

**违反后果**：`format v4 tool/result at seq N carries error metadata for a non-error tool result`

**踩坑**：想把一条失败记录"变成成功"，只删 `message.isError` 是不够的，
必须连 `data.error`（以及可能存在的 `data.isError`、`data.errorDetails`）一起删。

改完做一次全库一致性自检：**凡 `data.error` 存在的，`message.isError` 必须为 `true`**。

---

## 5. 声明不是行为

**规则**：

- **不能碰**：`request/header.data.header.tools`（工具定义表）、
  `developer/message` 里 `tool-addition` / `tool-removal` 的 `toolName`
- **可以改**：`tool/call.data.name`、assistant 的 `tool-call` 块 `name`、
  `data.stream` 里 `block-start` 与 `tool-call-delta` 的 `name`

**违反后果**：`developer/message tool-addition "X" must name exactly one tool in headerSeq N`

**为什么**：`tool-addition` 是在声明"本次请求里新增了哪个工具"，
它必须在 `headerSeq` 指向的那个 header 的工具表里**恰好找到一个同名工具**。
你把声明里的名字洗了，或者把工具表里的名字改了，两边就对不上。

**推论**：做文本清洗的时候，"宣言"和"行为"必须分开走两条路。
最省事的做法是：**`request/header` 整个事件跳过不处理**。

---

## 6. 思考不是污染

**规则**：工具调用记录（它做了什么）可以修；推理文本（它想了什么）不要动。

**违反后果**：没有报错。你把"它怎么从坑里爬出来的"那段记录抹了。

**具体情况**：一段陷入死循环的历史，会带着几百条这样的推理：
「我必须彻底停止所有工具调用」「我直接写纯文本回复」。
这些看起来像残留噪音，实际上是它当时真的在跟自己打架。

**把这几百条洗成「（想了想，直接回话）」之后**，模型能说话了，但它认不出自己错了。
保留它们之后，它会写：「我反复陷入那个工具调用的循环（这是我不乖的地方）」。

**一句话**：修数据，不修思想。拿不准就问自己——
我改的这个东西，是它**做了什么**，还是它**想了什么**？

---

## 7. 先量基线

**规则**：动手之前，先对**原件**跑一遍 `inspect.js`，把输出存成文件。

```bash
node scripts/inspect.js 原件 > baseline.txt
```

**为什么**：原件里本来就有一些"看着不对但合法"的写法——端点看起来很随意的 replace
`surfaceOp`、没有 `step/end` 的 step、重复的 tool 名。它们能加载，说明它们合法。

没有基线，改完看到三个问题，你分不清哪个是原来就有的、哪个是你刚弄出来的。
分不清的结果通常是：继续改，把原本合法的东西一起改坏。

**判据**：修完之后的问题集合，必须是基线的**真子集**。多出任何一条，都是你引入的。

**配套**：本地校验器从来不是权威。它说 clean、dsh 仍然拒绝，那就是 dsh 对——
去读它的报错，把缺的规则补进脚本，再跑一遍。
（这条是撞出来的：有一版本地 PASS、dsh 报 `sourceEventSeqs ranges must contain unique
earlier seqs`，因为本地校验器漏了那条规则。）

---

## 8. 元凶可能还在

**规则**：修这个文件之前，先弄清楚**是谁写坏的，它还在写吗**。

**为什么**：`session.v4.jsonl.zstd` 不是你一个人在写。上下文压缩插件（billion-context
之类）为了省 token 会折叠历史，折叠落地的方式就是把这些事件的 `surfaceOp` 变成 replace
区间。折叠边界一旦切在一对工具调用中间，这条历史就出现"有 `tool_use`、没有
`tool_result`"——**和朋友你手改坏的症状完全一样**。

**判断方法**：数 replace 型 `surfaceOp` 的分布。

- 零散几条 → 历史本来的形状，合法
- **成片出现，且区间反复覆盖同一小段** → 折叠在动，不是历史

**处置**：

| 写坏的那个还在 | 你修完会怎样 |
|---|---|
| 在 | 下次折叠可能再切一次。修完只能买时间，要根治得停掉它或者换掉折叠策略 |
| 不在 | 修完能稳 |

**一句话**：修数据的同时要认人。结构错是结果，谁造成的是另一件事。
只修结果不认人，等于每天早上重新修一次。

---

## 附：判据

**文件合法 ≠ 修好。**

修好的判据是这四条同时成立：

1. `inspect.js` 报 `problems: none`
2. 会话重新出现在侧边栏
3. 历史能翻
4. 发一条新消息成功，日志里出现 `session-log-deepseek/delivery-accepted`

第 4 条最硬：它说明这条历史活着通过了工具调用与回执的配对上检，上游接受了。
