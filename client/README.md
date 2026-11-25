# client 单文件构建

DSH 只加载 `client/client.js` 一个入口，所以页面源码拆在 `client/parts/*.js`，由
`scripts/build-client.mjs` 拼回单文件。

```bash
node scripts/build-client.mjs   # 或 npm run build:client
```

- `client/client.template.js`：工厂主体，只保留一个 `/* @include parts */` 标记。
- `client/parts/*.js`：备份、知识库、概览、心智各页等页面函数，按文件名排序拼接。
- `client/client.js`：生成产物，必须提交；`test/client-build.test.js` 会校验能重新生成。

页面都是函数声明，拼接位置不影响调用；新增页面时把函数从模板移到 `client/parts/`，
再运行构建即可。
