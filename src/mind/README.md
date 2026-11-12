# 心智核心

心智核心可以在支持 `node:sqlite` 的 Node.js 22.13 或更新版本中独立运行。它接收会话、人物和文字，持久化感知、记忆、身体、情绪和关系。模型由调用方提供，投递和任务调度由调用方负责。

## 独立使用

```js
import { mkdir } from 'node:fs/promises'
import { createMind } from 'dsh-aurabot-qq/mind'

// model 接收 { scene, system, text, maxTokens, signal? }。
// 返回字符串或 { text, tokens? }，tokens 是该次调用的用量。
export async function replyToMessage({ dir, model, deliver, incomingId, text }) {
  await mkdir(dir, { recursive: true })
  const mind = createMind({ dir, model, ownerId: 'demo:owner' })
  const window = 'demo:private:friend'
  try {
    const reply = await mind.conversation.respond({
      window, speaker: 'demo:friend', msgId: incomingId, text,
    })
    if (reply.status !== 'draft') return reply
    const sentId = await deliver(window, reply.text)
    if (!mind.person('demo:friend')?.noMemory) {
      mind.said({ window, text: reply.text, msgId: sentId })
    }
    return reply
  } finally {
    mind.close()
  }
}
```

持续运行的应用可以复用同一个 `mind`，在关闭时调用 `close()`。默认会话 ID 格式是 `渠道:private|group:会话ID`，人物 ID 由调用方分配。自定义会话 ID 可以在 `createMind({ place })` 中提供分类函数。

`respond()` 根据当前会话形成草稿。`direct: false` 表示旁听或可选插话，`quiet` 表示这轮选择安静，`deferred` 表示当前状态不接话。还可能返回 `duplicate`、`superseded`、`skipped` 或 `unavailable`。同一输入的稳定 `msgId` 用于已记录消息的去重。确认送达以后调用 `said()`，它使用送达的消息 ID 去重。独立调用的 `speak` 场景生成 `{"text":"要说的话"}`，调用方可以传 `signal` 取消草稿。

需要保留自己的会话生成器或工具链时，可以先用 `perceive()` 记录来信，再调用 `conversation.attend({ speaker, direct })` 和 `conversation.prepare({ window, text, people, direct })`。`attend()` 给出注意和唤醒结果，`prepare()` 给出本轮工作记忆、事件评价和表达计划。`conversation.describeSpeechPlan(plan)` 可把计划写入回复提示词。调用方可按自己的调度运行 `body.tick()`、`inner.step()` 和 `sleep()`。

合并多人的消息或给回复带上引用时，可以给 `prepare()` 额外传 `observations: [{ speaker, text }]`。评价仅从这些有来源的发言取证，回忆仍可用完整的 `text` 作线索。多人都说过同一片段时，评价保留事实依据，情绪归因留空。简短追问可以用同会话中同一发言人的近期原话扩展回忆线索。事件评价继续使用当前消息原文。

## 对话中的心智状态

- 评价事件时，模型考虑原话、当前关切、关系、近况和身体状态，返回依据、重要性、影响方向、把握程度、应对能力、新颖性、不公和归因。核心核对引文和数值，更新带会话和事件来源的情绪。`appraisal` 使用模型提示词里的紧凑 JSON 格式。调用计入后台预算，可通过 `emotion.appraise` 关闭。`respond()` 默认给回复准备 5 秒，`prepare()` 默认 3 秒，两者都可以传 `timeoutMs`。超过准备窗口的结果会被丢弃。评价维度参考 [Scherer 的成分过程模型](https://academic.oup.com/book/53557/chapter-abstract/422115725)。
- 澄清可以降低同一会话、同一说话人所对应事件的情绪强度。其他事件保留各自的强度和消退时间。随证据重新评价的设计参考 [Marsella 与 Gratch 的 EMA 模型](https://people.ict.usc.edu/~gratch/CSCI534/Readings/COGSYS-RS-EMOTION-2008-6.pdf)。
- 当前注意的回忆受工作记忆上限和精力约束。普通状态最多取四条，低精力时最多两条，已有配置可以设得更少。这些是项目参数，有限容量的思路参考 [Cowan 的短时记忆研究](https://doi.org/10.1017/S0140525X01003922)。
- 表达计划先决定是否开口，再指定回应、求证或接住对方的意图，以及语气和篇幅。措辞生成另外读取人格、当前情绪和会话上下文。阶段划分参考 [Levelt 的语言生成研究](https://www.mpi.nl/publications/item61340/ability-speak-intentions-spoken-words)。

## 记忆维护和后台工作

- 删除经历会撤回带有该经历来源的特质变化、习惯、认知线索和自我故事，清理或重建衍生记忆。较早版本里没有保留原始依据的变化，无法精确归因。删除一条经历与删除聊天原话是两个入口；忘掉一个人可以把该人的原话一起移入恢复区。
- 心智库启动时检查 SQLite 完整性。只在 SQLite 明确报告损坏时尝试较新的有效快照，保留坏库副本并补应用快照后记录的删除。没有有效快照时会报告错误。AuraBot 自动拍快照，默认保留 14 份。
- AuraBot 按对话、任务、精力和宿主模型支持的档位调整思考深度；手动设置的较高档位优先。预算用尽的深想优先保留反复低落和重要关系的问题，次日再处理。独立 `respond()` 的模型请求也会附上建议档位；响应超时 `responseTimeoutMs` 默认 30 秒，短提示词兜底分别最多 9 秒。明确沉默会返回 `quiet`。
- AuraBot 的主动画画和翻唱默认关闭，由主人在「心智设置 → 动机与行动」开启，沿用内置生图和翻唱服务。前台聊天打断时等到安全阶段再继续；重启会结束正在进行的创作。画作存入画作库，翻唱在允许时送到主人的私聊。

## 离线回放

```sh
node scripts/replay-mind.js --cost-per-million 2 --html replay.html > replay.json
node scripts/replay-mind.js --input events.jsonl --owner demo:owner --html replay.html > replay.json
```

不提供 `--input` 就使用内置的 35 天模拟场景。报告包含逐日特质、心情、最强情绪、指定经历的记忆强度、后台 token、估算费用和删除检查点。统一单价仅用于估算；不传价格就不估算。CLI 使用替身模型和内存库，不读取正式聊天、配置或密钥，也不发消息。

JSONL 每行一个事件，按 `at` 升序（ISO 时间或毫秒时间戳）。支持 `message`、`said`、`appraise`、`encode`、`night`、`think`、`recall` 和 `forget`。例如，消息与随后的编码可以写成：

```jsonl
{"at":"2026-11-10T02:00:00Z","kind":"message","window":"demo:group:friends","speaker":"demo:friend","text":"今天把旧钢琴修好了"}
{"at":"2026-11-10T02:05:00Z","kind":"encode","window":"demo:group:friends","ref":"piano","replies":{"record":{"episodes":[{"type":"event","gist":"旧钢琴修好了","sources":[1]}],"tokens":120}}}
{"at":"2026-11-20T02:00:00Z","kind":"recall","window":"demo:group:friends","ref":"piano","text":"旧钢琴"}
```

`replies` 可按调用场景提供替身模型的文本或 JSON。程序化使用可从 `dsh-aurabot-qq/mind/replay` 导入 `replayMind(events, options)`，也可注入自己的模型。

## 链式回忆和隐私回放

需要让模型按需展开时，调用 `conversation.prepare({ window, text, compactRecall: true })`。工作记忆给出带编号的摘要。模型请求展开后，用 `memory.recallMore(id, { audienceWindow: window })` 读取一跳。每次读取都按当前会话核对原记忆和关联记忆。AuraBot 将这个入口提供为 `mind_recall_more`。

`npm run mind:privacy` 用合成主人私聊验证公开片段，分别统计私密内容通过和普通内容被拦的次数。测试把每条样例都标成拟分享，以便测量代码的可见性判断。`--input` 可传入包含 `name`、`messages`、`share` 和可选 `line` 的 JSON 数组。默认样例也包含字面毫无线索的暗语，报告会记录这一类漏判。
