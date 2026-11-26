// 兼容出口：实现在 src/core/qzone-audience.js。
// 这个文件的职责是纯逻辑（0 依赖，或只依赖 core），放在 core 才不会让 core 反向依赖上层。
// 新代码直接 import src/core/qzone-audience.js；这里只为不改动大量现有 import 而保留。
export * from '../../../../core/qzone-audience.js'
