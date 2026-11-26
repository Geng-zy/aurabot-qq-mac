// 人格卡的字数上限。
//
// 放在 core 的原因：mind/self 改自己的人格卡时要按它截断，persona/personas 保存时也要按它校验；
// 这份常量原本住在 persona 里，导致「心智核心反向依赖 persona」这唯一一条上行边。
// 常量挪到中性层，两边都从 core 取，谁也不用依赖谁。

/** 人格卡最多多少字（避免每轮提示词无限膨胀）。 */
export const MAX_PERSONA_CHARS = 12000
