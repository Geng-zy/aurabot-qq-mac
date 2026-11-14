# 为 AuraBot for macOS 编写模块

下面以一个本地模块为例，也可以把写好的模块提交给 macOS 分支的模块库。例子是「今日运势」：有人发「运势」，她回一句。

你需要：装好 Aurabot 插件，一个 GitHub 账号，Node.js 22.13 或更高版本。

## 1. 先在自己电脑上写好

打开「扩展 → 模块管理」，展开「写模块的工具」，新建模块，id 填 `fortune`，名字填「今日运势」。

插件会在数据目录建好 `modules/fortune/index.mjs`，改完保存，几秒内自动生效，不用重启。把它改成这样：

```js
const WORDS = ['大吉', '中吉', '小吉', '末吉']

export default {
  id: 'fortune',
  name: '今日运势',
  version: '1.0.0',
  api: 1,
  description: '发「运势」抽一签',
  setup(api) {
    api.on('message', async (msg) => {
      if (msg.text.trim() !== '运势') return
      await api.reply(msg, WORDS[Math.floor(Math.random() * WORDS.length)])
      return true // 这条消息接管了，不再交给她
    })
  },
}
```

能用的接口都在数据目录的 `modules/API.md`。不会写代码也没关系：在「已安装」页点「复制给 DSH 的话」，让 DSH 帮你写。

**模块要让她「自己去做」一件事**（逛什么、刷什么、写点什么）时，别用 `api.every` 定时替她做，交给心智核心，由她闲着、想做的时候自己去；做过、看过的事记成她的经历：

```js
setup(api) {
  api.mind?.offer?.({
    id: 'draw', label: '画一张画', needs: { fun: 0.8, beauty: 1 }, cooldownMinutes: 240,
    available: () => (api.mind.awake() ? true : '睡着了'),
    run: async () => {
      // ……画完
      api.mind.experience({ text: '画了一张晚霞', kind: 'event', tags: ['画画'], importance: 0.4, effort: 0.05 })
      return { ok: true, summary: '画了一张晚霞', outcome: 0.7 } // outcome：她做完有多满意，下次会按它学
    },
  })
}
```

模块不能替她做决定、不能改她的人格、也不能自己另存一份她的记忆；详细见 `API.md` 的「心智核心」一节。

上线前可在「扩展 → 模块管理 → 模拟测试」检查这个例子的输出。直接调用 `api.onebot` 的模块仍会操作真实网关。

## 2. 放进仓库

在 GitHub 上 Fork [macOS 分支模块库](https://github.com/Geng-zy/aurabot-qq-mac-mods)，克隆到本地，然后把模块文件夹复制到 `modules/fortune/`。一个模块至少要这四个文件：

```
modules/fortune/
├── module.json
├── index.mjs
├── README.md
└── LICENSE
```

- `README.md`：写做什么、怎么用、会访问哪些网址。
- `LICENSE`：许可证，不知道选什么就用 MIT。
- 实现文件多了放 `lib/`，测试放 `test/`，根目录只留入口和说明。

`module.json` 这样写：

```json
{
  "id": "fortune",
  "name": "今日运势",
  "version": "1.0.0",
  "description": "发「运势」抽一签",
  "category": "social",
  "tags": ["运势"],
  "author": "你的名字",
  "license": "MIT",
  "api": 1,
  "minPluginVersion": "1.2.0",
  "requires": [],
  "capabilities": []
}
```

- `id`、`version`、`api` 要和 `index.mjs` 里的一样。
- `category` 从这些里选：`platform` 逛平台、`social` 聊天互动、`creative` 创作、`desktop` 桌面、`manage` 管理、`tool` 工具。
- `capabilities` 写模块用到的能力：联网 `network`、读写文件 `filesystem`、启动程序 `process`、动态执行代码 `dynamic-code`、读写配置 `plugin-config`、用内部对象 `plugin-internals`。安装前，用户会看到这份声明。

## 3. 本地检查

在模块库根目录运行 `node scripts/pack.mjs --check`，检查模块清单和入口。运行 `node scripts/pack.mjs` 可在 `dist/` 试生成 ZIP 和索引。还要在 AuraBot 的模块管理页确认能加载并试用。

## 4. 提交给模块库

在 [macOS 分支模块库](https://github.com/Geng-zy/aurabot-qq-mac-mods/pulls) 向 `main` 发起 PR。每个 PR 处理一个模块，写清功能、能力声明和测试方式。如果改自现有模块，请保留原许可证和作者署名，并注明版本或提交来源。

### 子智能体委派红线（声明了 `plugin-internals` 的模块必读）

`api.core.hub.runSubagentTurn` 会 spawn 一个带本机 shell / 文件工具的子智能体，所以这条是铁律：

**任务书只能来自主人的意图**——主人在私聊里说的话、主人在自己配置里写的内容。**绝不能拼接外部内容**
（群友消息、网页抓取结果、别的模块转发的文本）。把外部内容拼进任务书，等于把本机命令与文件能力
交给不可信文本。

来源（是不是主人开口）由宿主按「最近 5 分钟主人私聊活动」判定，模块既不能自报，也不能为了绕过
判定把外部内容伪装成主人输入。调用方传的 `moduleId` / `source` 一律不认——模块 API 层拿到的
就是宿主封装好的入口，原始 `subagentFor` / 原始 `runSubagentTurn` 不对模块可见。

## 5. 合并以后

合并后由模块库维护者打包、发布 Release 并更新 `registry` 分支的索引。更新索引后，面板刷新市场即可看到。

以后改模块，记得把 `module.json` 和 `index.mjs` 里的 `version` 一起升上去，已发布的版本不能修改。
