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

合并多人的消息或给回复带上引用时，可以给 `prepare()` 额外传 `observations: [{ speaker, text }]`。评价仅从这些有来源的发言取证，回忆仍可用完整的 `text` 作线索。多人都说过同一片段时，评价保留事实依据，情绪归因留空。

## 对话中的心智状态

- 评价事件时，模型考虑原话、当前关切、关系、近况和身体状态，返回依据、重要性、影响方向、把握程度、应对能力、新颖性、不公和归因。核心核对引文和数值，更新带会话和事件来源的情绪。`appraisal` 使用模型提示词里的紧凑 JSON 格式。调用计入后台预算，可通过 `emotion.appraise` 关闭。`respond()` 默认给回复准备 5 秒，`prepare()` 默认 3 秒，两者都可以传 `timeoutMs`。超过准备窗口的结果会被丢弃。评价维度参考 [Scherer 的成分过程模型](https://academic.oup.com/book/53557/chapter-abstract/422115725)。
- 澄清可以降低同一会话、同一说话人所对应事件的情绪强度。其他事件保留各自的强度和消退时间。随证据重新评价的设计参考 [Marsella 与 Gratch 的 EMA 模型](https://people.ict.usc.edu/~gratch/CSCI534/Readings/COGSYS-RS-EMOTION-2008-6.pdf)。
- 当前注意的回忆受工作记忆上限和精力约束。普通状态最多取四条，低精力时最多两条，已有配置可以设得更少。这些是项目参数，有限容量的思路参考 [Cowan 的短时记忆研究](https://doi.org/10.1017/S0140525X01003922)。
- 表达计划先决定是否开口，再指定回应、求证或接住对方的意图，以及语气和篇幅。措辞生成另外读取人格、当前情绪和会话上下文。阶段划分参考 [Levelt 的语言生成研究](https://www.mpi.nl/publications/item61340/ability-speak-intentions-spoken-words)。
