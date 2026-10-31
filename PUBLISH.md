# 发布信息 · PUBLISH

上传时要填的字段，全部可以直接复制。

---

## 1. 仓库

| 字段 | 填什么 |
|---|---|
| **Owner** | 你的 GitHub 账号 |
| **Repository name** | `dsh-session-repair` |
| **Description** | 见下方 2 |
| **可见性** | Public（想先自己看看就选 Private，随时能改） |
| **Add a README file** | ❌ **不要勾**（我们已经有 README.md） |
| **Add .gitignore** | ❌ **不要勾**（我们已经有） |
| **Choose a license** | ❌ **不要勾**（LICENSE 已写好 MIT / Odds） |

---

## 2. Description（GitHub 那一栏，一句话）

**英文（推荐，GitHub 上的人先看这个）：**

```
Diagnose and repair corrupt DeepSeek Harness session logs — multi-frame zstd JSONL. 8 iron laws, 3 scripts, zero history rewriting.
```

**中文（想走中文圈就用这个）：**

```
修 DSH 打不开的会话日志：多帧 zstd JSONL 的诊断与修复。八条铁律、三个脚本、不重写历史。
```

> 上限 350 字符，两个都够短。

---

## 3. Topics（标签，网页右侧 About 那栏的齿轮 → Topics）

一个一个粘：

```
dsh
deepseek-harness
session-recovery
data-recovery
zstd
jsonl
repair
forensics
cli
nodejs
ai-agent
debugging
```

---

## 4. 上传步骤（网页版，不用命令行、不用 token）

1. 打开 <https://github.com/new>
2. 按上表填 name + description，**三个勾都别勾**，点 `Create repository`
3. 新页面会有一行 `…or upload an existing file`，点它
4. 打开资源管理器，进 `G:\DSH_Workspace\dsh-session-repair`
5. **把里面的所有东西全选拖进浏览器**（`README.md` `SKILL.md` `LICENSE` `PUBLISH.md` `scripts` `docs` `.gitignore`）
   - `.git` 目录不要拖（网页传不了，也不需要）
   - 拖文件夹会自动保留子目录结构
6. 下面 commit message 填：

```
铆 · 把两条断掉的会话咬回去
```

7. 点 `Commit changes`

传完打开仓库首页，应该能看到 README 正常渲染、右侧 About 有描述。

---

## 5. 第一版 Release 说明（可选，Actions 右边的 Releases → Create a new release）

Tag：`v0.1.0` · Title：`铆 · Rivet v0.1.0`

```markdown
第一次放出来。

三个脚本：
- `inspect.js` — 只读诊断，列出所有结构问题
- `repack.js` — JSONL → 一行一帧的 zstd，写完自动回读校验
- `lib/frames.js` — 多帧 zstd 的读、解、写

八条铁律 + 一份完整的排错顺序，全部来自两条真实坏掉的会话：
`SessionFormatError` 带行号、发消息报 400 缺 `tool_result`、
侧边栏整条消失、历史一片空白、模型卡在死工具上出不了话。

判据不是"文件合法"，是"发一条新消息能成功，日志里出现 `delivery-accepted`"。
```

---

## 6. 介绍文案

### 短版（一句话，适合转发/签名）

> 修好了两条打不开的 DSH 会话 —— 过程里的八个坑写成了一套工具。

### 中文版（发群、发帖、即刻）

> 三周前我有两条会话打不开了。一条发消息报 400，一条打开一片空白，模型卡在一个早就不存在的工具上出不了话。
>
> 数据一个字都没少 —— 坏的是结构：一对工具调用少了回执、删过事件没改号、一份超大的压缩帧。
>
> 修的过程里我踩了八个坑，每个坑当时都是一整夜。我把它们写成了三个脚本和八条铁律：
> 先量基线、一行一帧、改号是传染的、思考不是污染、**修数据的同时要认人**（那个把历史写坏的东西，可能还在写）。
>
> 仓库在这里：`https://github.com/<你的账号>/dsh-session-repair`
>
> 名字叫**铆**。铆接不加热不上胶，靠两块金属各自变形咬住 —— 焊是融成一块，铆是两个东西都还在。要的是后者。

### 英文版

> Two of my DeepSeek Harness sessions became unopenable: one threw a 400 on every message, one showed a blank history, one kept calling a tool that no longer existed.
>
> Nothing was actually lost. The damage was structural — a tool call missing its result, deleted events that left dangling sequence references, one oversized compression frame.
>
> Eight hard-won rules and three scripts later, both sessions talk again. The rule I keep coming back to: **count the baseline first, and ask who else writes this file** — the thing that corrupted the log may still be running.
>
> Repo: **铆 · Rivet** — `https://github.com/<your-account>/dsh-session-repair`
>
> Named after riveting: no heat, no glue. Two pieces, each yielding a little, biting into each other. Welding fuses them into one; riveting keeps both.

---

## 7. 上传之后（可选，别现在做）

- 加一张截图：`inspect.js` 输出 `problems: none` 那一段，比任何描述都管用
- 想发 npm 的话，`package.json` 的 `bin` 指到 `scripts/inspect.js`，但**先别急** —— 等有人真的用再说
