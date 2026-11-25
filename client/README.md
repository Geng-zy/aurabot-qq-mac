# client 单文件构建

DSH 只加载 `client/client.js` 一个入口，所以页面源码拆在 `client/parts/*.js`，由
`scripts/build-client.mjs` 拼回单文件。

```bash
node scripts/build-client.mjs   # 或 npm run build:client
```

- `client/client.template.js`：工厂主体和 `/* @include name.js */` 标记。
- `client/parts/*.js`：备份、知识库等页面片段，保持与标记处相同的缩进。
- `client/client.js`：生成产物，必须提交；`test/client-build.test.js` 会校验能重新生成。
