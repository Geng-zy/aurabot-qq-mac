# UI 截图基线

`pages/` 与 `states/` 是**滚动覆盖**的最新一版：每次跑 `node scripts/ui-shot.mjs` 会整目录重写。
`archive/<版本>/` 是某一版的定格，用来做「这一批改了什么」的对比；只保留关键节点，不逐版堆积。

| 目录 | 内容 | 怎么来的 |
|---|---|---|
| `pages/` | 28 个页面的正常态 | `ui-shot.mjs`（真组件 + 真机快照，不连宿主） |
| `states/` | 29 页 × 加载 / 错误 / 空态 | 同上（桩掉 `/aurabot/api/*`） |
| `narrow.png` | 620px 窄屏 | 同上 |
| `theme-dark.png` | 深色 | 同上 |
| `state.live.json` | Mini 的 `/state` 快照 | `curl /aurabot/api/state`（升级后重抓） |
| `api-fixtures.json` | 23 个接口的抓包快照 | Mini 上一次抓取，供预览渲染真实形状 |
| `panel-inventory.json` | 28 页的组件树盘点 | UI 规划那一轮的渲染脚本 |
| `archive/` | 历次定格 | 手工复制 |

**什么时候归档**：一个 UI 批次（B0…B7）收尾、或大改版前后。归档后不要删，对比时才用得上。

```bash
node scripts/ui-shot.mjs                     # 重新生成 pages/ 与 states/
cp -R docs/ui-baseline/{pages,states,narrow.png,theme-dark.png} docs/ui-baseline/archive/<版本>/
```
