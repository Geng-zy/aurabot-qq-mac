// 兼容出口：实现在 src/mind-adapter/local-runner.js。
// 本地模型（mlx_lm）的进程管理属于适配层，不属于心智核心：mind 里没有任何文件需要它，
// 只有 mind-adapter（拿它做向量/内心生成）和面板安装流程用。
export * from '../../mind-adapter/local-runner.js'
