// 心智核心的全部可调参数：默认值、范围、分组、来源和说明。
// 面板「心智设置」直接按这张表生成，所以每个参数只在这里定义一次。
// 来源写研究出处；没有研究可依的写「经验值」并说明理由（见设计文档「默认值从哪里来」）。
// 这里只放通用默认值，不针对任何一个角色。

/** @typedef {{ key: string, group: string, label: string, def: any, min?: number, max?: number, step?: number, unit?: string, options?: Array<{value:any,label:string}>, source: string, hint: string, advanced?: boolean, ownerOnly?: boolean }} Param */

export const GROUPS = [
  { id: 'identity', label: '身份' },
  { id: 'body', label: '身体与节律' },
  { id: 'attention', label: '注意与意识流' },
  { id: 'memory', label: '记忆' },
  { id: 'emotion', label: '情绪' },
  { id: 'motivation', label: '动机与行动' },
  { id: 'personality', label: '人格与自我' },
  { id: 'relations', label: '社会认知与关系' },
  { id: 'session', label: '会话' },
  { id: 'models', label: '模型和预算' },
]

const EXP = '经验值'

/** @type {Param[]} */
export const PARAMS = [
  // ---------- 身份（只能主人在面板里改，她自己改不了） ----------
  { key: 'identity.timezone', group: 'identity', label: '时区', def: 'Asia/Shanghai', source: '设计决定', hint: '她的作息、今天和昨天、节假日都按这个时区算，和电脑的时区无关。', ownerOnly: true },
  { key: 'identity.age', group: 'identity', label: '年龄', def: null, min: 0, max: 200, step: 1, unit: '岁', source: '设计决定', hint: '满 18 岁才会有性欲；没填按未满 18 处理。每年生日自动加一岁。', ownerOnly: true },
  { key: 'identity.birthday', group: 'identity', label: '生日（月-日）', def: '', source: '设计决定', hint: '例如 11-09。到了生日按她的时区自动长一岁。', ownerOnly: true },
  { key: 'identity.exclusive', group: 'identity', label: '专一：喜欢只给主人', def: true, source: '设计决定', hint: '开着时，心动、爱慕、性欲这类恋爱式情绪只对主人，别人最多是好朋友。关掉后她也可能慢慢喜欢上别人。', ownerOnly: true },
  { key: 'identity.mustReplyOwner', group: 'identity', label: '主人叫她必须回', def: false, source: '设计决定', hint: '开着时，你叫她一定会回（睡着、累了、生你气也回）。关着时按她当时的状态来。', ownerOnly: true },
  { key: 'identity.wakers', group: 'identity', label: '谁能叫醒她', def: 'owner', options: [{ value: 'owner', label: '只有主人' }, { value: 'close', label: '主人和很亲近的人' }], source: '设计决定', hint: '她睡着时，只有这些人叫她才会醒；其他人的消息等她醒了再看。', ownerOnly: true },
  { key: 'identity.ownerCallChange', group: 'identity', label: '她可以自己改对你的称呼', def: true, source: '设计决定', hint: '一开始她按你在「访问」页填的叫你；认识久了、关系变了，她可以自己换个叫法（会通知你，你随时能在「人格与自我」页退回，或关掉这个开关）。你在面板里改「ta怎么称呼你」，就以你改的为准。', ownerOnly: true },
  { key: 'identity.ownerCallMinDays', group: 'identity', label: '认识多久以后才能改称呼', def: 30, min: 1, max: 365, step: 1, unit: '天', source: '经验值', hint: '从她第一次见到你算。', ownerOnly: true, advanced: true },
  { key: 'identity.ownerCallGapDays', group: 'identity', label: '两次改称呼至少隔几天', def: 14, min: 1, max: 365, step: 1, unit: '天', source: '经验值', hint: '你退回或在面板里改过，也从那天重新算。', ownerOnly: true, advanced: true },
  { key: 'identity.notifySelfChange', group: 'identity', label: '她改自己后通知你', def: true, source: '设计决定', hint: '她改人格卡、价值观、名字等之后发一条通知，说改了什么、为什么。' },

  // ---------- 身体与节律 ----------
  { key: 'body.hunger', group: 'body', label: '会饿', def: true, source: '设计决定', hint: '饭点会饿，饿了心情稍差、会想吃的。关掉就不会饿。' },
  { key: 'body.feedOnlyByOwner', group: 'body', label: '只靠主人投喂', def: false, source: '设计决定', hint: '开着时她不自己吃，饿了来找你要；你很久不喂她会没精神，但影响有上限。' },
  { key: 'body.mealTimes', group: 'body', label: '饭点', def: '08:00,12:00,18:30', source: EXP, hint: '常见三餐时间，按她的时区。' },
  { key: 'body.sleepRiseHours', group: 'body', label: '困意上升时间常数', def: 18.2, min: 8, max: 30, step: 0.1, unit: '小时', source: 'Daan、Beersma & Borbély 1984；Borbély 等 2016', hint: '醒着越久越困，这个数越小困得越快。', advanced: true },
  { key: 'body.sleepDecayHours', group: 'body', label: '睡眠恢复时间常数', def: 4.2, min: 1, max: 8, step: 0.1, unit: '小时', source: '双过程模型常用值 4.2；个体拟合 1.2～2.9（2010）', hint: '睡着时困意消退的快慢，越小恢复越快。', advanced: true },
  { key: 'body.sleepWindow', group: 'body', label: '生物钟上的夜晚', def: '23:30-07:30', source: EXP, hint: '困了并且到了这段时间，她就想睡。会随她的作息习惯慢慢变。' },
  { key: 'body.hungerHours', group: 'body', label: '多久从饱到很饿', def: 5, min: 2, max: 12, step: 0.5, unit: '小时', source: '经验值（三餐通常相隔 4～6 小时）', hint: '越小饿得越快。睡着时饿得慢一些。', advanced: true },
  { key: 'body.selfFeedAt', group: 'body', label: '饿到多少自己去吃', def: 0.7, min: 0.3, max: 1, step: 0.05, source: EXP, hint: '饿到这个程度、又在饭点前后一小时，她就自己去吃；饿得受不了时不管饭点也吃。「只靠主人投喂」开着时不吃。', advanced: true },
  { key: 'body.energyRecoverPerHour', group: 'body', label: '醒着时每小时恢复精力', def: 0.08, min: 0, max: 0.5, step: 0.01, source: EXP, hint: '歇着时慢慢恢复；越困恢复的上限越低。睡觉恢复得快得多（跟着睡眠恢复时间常数）。', advanced: true },
  { key: 'body.sleepThreshold', group: 'body', label: '困到多少会去睡', def: 0.62, min: 0.4, max: 0.9, step: 0.01, source: '双过程模型的结构（Borbély 1982）；门槛和组合方式是经验值', hint: '想睡的程度 = 0.6×睡眠压力 + 0.4×生物钟。超过这个、又是生物钟的夜里就去睡。越高越能熬。', advanced: true },
  { key: 'body.wakeThreshold', group: 'body', label: '睡到多少会醒', def: 0.37, min: 0.1, max: 0.6, step: 0.01, source: '双过程模型的结构（Borbély 1982）；门槛是经验值', hint: '想睡的程度降到这以下就自然醒。越低睡得越久。', advanced: true },
  { key: 'body.stayUpMinutes', group: 'body', label: '和主人聊着就熬着不睡', def: 20, min: 0, max: 120, step: 5, unit: '分钟', source: '设计决定', hint: '和你聊天后这么久之内她不会自己去睡，代价是第二天更困。0 = 不熬夜。' },
  { key: 'body.groggyMinutes', group: 'body', label: '刚醒迷糊多久', def: 20, min: 0, max: 90, step: 5, unit: '分钟', source: 'Tassi & Muzet 2000（睡眠惯性一般 15～30 分钟）', hint: '被叫醒或刚睡醒时反应慢、迷迷糊糊。', advanced: true },
  { key: 'body.jetLag', group: 'body', label: '换时区要倒时差', def: true, source: 'Waterhouse 等 2007（大约一天调一个时区，往西快一些）', hint: '改了时区以后，她的生物钟几天才跟上。关掉就立刻切换。' },
  { key: 'body.energyPerTurn', group: 'body', label: '每轮聊天消耗精力', def: 0.01, min: 0, max: 0.1, step: 0.005, source: EXP, hint: '精力 0～1；越大越容易聊累。', advanced: true },

  // ---------- 注意与意识流 ----------
  { key: 'attention.single', group: 'attention', label: '单一注意力', def: true, source: '设计决定', hint: '同一时间只专心一个聊天，其他的消息先放着；主人的消息可以插队。群里忙时回得慢。' },
  { key: 'attention.wanderShare', group: 'attention', label: '闲着时走神的比例', def: 0.4, min: 0, max: 1, step: 0.05, source: 'Killingsworth & Gilbert 2010（46.9%）；后续经验取样（26.2%）；综述 30%～50%', hint: '醒着又没人找时，有多大比例在想事情，其余是发呆或去做事。' },
  { key: 'attention.thoughtGapMinutes', group: 'attention', label: '两个念头的间隔', def: 3, min: 0.5, max: 30, step: 0.5, unit: '分钟', source: EXP, hint: '平均间隔；兴奋时更短，累了更长。没有本地小模型时自动拉长以省钱。' },
  { key: 'attention.ownerCutsQueue', group: 'attention', label: '主人的消息插队', def: true, source: '设计决定', hint: '单一注意力开着时，主人的消息优先处理。' },
  { key: 'attention.inner', group: 'attention', label: '闲着时的内心活动', def: true, source: '设计决定', hint: '醒着、没人找时她一步一步地想；关掉就只在有人找她时才「醒」。' },
  { key: 'attention.thinkWithoutLocal', group: 'attention', label: '没装本地小模型时用 DeepSeek 想', def: true, source: '设计决定', hint: '会花钱，所以间隔拉长到四倍；也受每天后台预算限制。关掉就只在装了本地小模型时才有内心活动。' },
  { key: 'attention.afterChatMinutes', group: 'attention', label: '聊完多久才开始走神', def: 2, min: 0, max: 30, step: 1, unit: '分钟', source: EXP, hint: '刚聊完注意力还在那段对话上。', advanced: true },
  { key: 'attention.elsewhereMinutes', group: 'attention', label: '知道别的聊天刚发生了什么（多久以内）', def: 15, min: 0, max: 120, step: 5, unit: '分钟', source: '设计决定（一个心智：工作记忆里有「别的聊天里刚发生了什么」）；时长是经验值', hint: '在一个聊天里，也给她看其他聊天最近这么久的几句原话（还没整理成经历的那几分钟）。0 = 不给。说不说由她自己拿分寸。' },
  { key: 'attention.elsewhereLines', group: 'attention', label: '每个别的聊天给几句', def: 4, min: 0, max: 20, step: 1, unit: '句', source: EXP, hint: '最多看 3 个别的聊天，每个最近这么多句。越多越清楚，也越占上下文。', advanced: true },

  // ---------- 记忆 ----------
  { key: 'memory.forgetting', group: 'memory', label: '记性', def: 1, min: 0.25, max: 4, step: 0.05, source: 'Rubin & Wenzel 1996；Wixted & Ebbesen 1997；Murre & Dros 2015', hint: '整体忘得快慢的倍数：1 是按研究的默认速度，大于 1 记得更久。遗忘按幂函数，先快后慢。' },
  { key: 'memory.spacingBonus', group: 'memory', label: '隔开想起的加强', def: 1, min: 0, max: 3, step: 0.1, source: 'Cepeda 等 2006；Cepeda 等 2008', hint: '隔开几天再想起比一天想很多次加强更多；这是那部分加成的倍数。', advanced: true },
  { key: 'memory.emotionBoost', group: 'memory', label: '情绪让记忆更牢', def: 1, min: 0, max: 3, step: 0.1, source: 'McGaugh 2004；Kensinger 2009 综述（情绪唤醒增强长期记忆，主要保住大意和核心细节）；倍数是经验值', hint: '越激动的事记得越牢，这是加成的倍数。', advanced: true },
  { key: 'memory.reconsolidation', group: 'memory', label: '记忆改写程度', def: 0.15, min: 0, max: 0.5, step: 0.05, source: '设计决定（参考再巩固研究，Nader）', hint: '0 是关掉；越高，回忆时细节越容易被改写、带上当下的心情。任何档位都不会编出没发生过的事；原始记录一直保留。' },
  { key: 'memory.recallLimit', group: 'memory', label: '每轮最多想起几条', def: 6, min: 0, max: 20, step: 1, source: EXP, hint: '工作记忆有限，只放最相关的。' },
  { key: 'memory.workingChars', group: 'memory', label: '工作记忆字数上限', def: 1800, min: 300, max: 8000, step: 100, unit: '字', source: EXP, hint: '每轮放进上下文的记忆、情绪、身体等的总字数。', advanced: true },
  { key: 'memory.followup', group: 'memory', label: '惦记别人的事', def: true, source: 'Huang 等 2017（JPSP，「问一问不吃亏」）：聊天里追问对方的事会让对方更喜欢你，追问（follow-up question）的效果最明显', hint: '别人说过还没结果的事（面试、考试、体检、等通知……），到时候她会在聊天里自然地问一句。会不会问、问几次看她有多心疼人、和对方多亲近。' },
  { key: 'memory.followupMaxAsks', group: 'memory', label: '同一件事最多问几次', def: 3, min: 1, max: 5, step: 1, source: EXP, hint: '问过没下文就往后推，问到这么多次就放下；有了结果或对方说别问了也放下。越不在乎的人问得越少。', advanced: true },
  { key: 'memory.followupGapDays', group: 'memory', label: '问过之后隔几天再问', def: 2, min: 0.5, max: 14, step: 0.5, unit: '天', source: EXP, hint: '越在乎的人隔得越短。', advanced: true },
  { key: 'memory.assoc', group: 'memory', label: '联想', def: true, source: 'Collins & Loftus 1975 扩散激活理论：想起一件事会顺着联系激活相关的事，离得越远激活越弱', hint: '想起一件事时顺着「相像的、因果的、接着发生的」联系再往下想一两步。不限在哪个聊天：群里也能联想到私聊里的事，只是会提醒她私聊里的事说之前想想、秘密不往外说。' },
  { key: 'memory.assocHops', group: 'memory', label: '联想最多想几步', def: 2, min: 1, max: 3, step: 1, source: EXP, hint: 'A 想到 B 是一步，B 再想到 C 是两步。步数越多越容易想偏。', advanced: true },
  { key: 'memory.assocLimit', group: 'memory', label: '每轮最多联想出几条', def: 2, min: 0, max: 5, step: 1, source: EXP, hint: '联想出来的放在直接想起的后面，也受工作记忆字数上限约束。', advanced: true },
  { key: 'memory.assocDecay', group: 'memory', label: '每多想一步淡多少', def: 0.6, min: 0.3, max: 0.9, step: 0.05, source: 'Collins & Loftus 1975（激活随距离衰减；具体比例是经验值）', hint: '每多一步，联想的强度乘上这个数；太弱的就想不起来了。', advanced: true },
  { key: 'memory.rerank', group: 'memory', label: '精排', def: false, source: 'Nogueira & Cho 2019（用交叉编码器给「问题-段落」逐对打分重排，比只看向量相近准得多）', hint: '想起来的候选多的时候，让精排模型逐条看「线索和这件事有多相关」再排。更准，代价是每次多一次小请求（SiliconFlow 的 bge-reranker-v2-m3 免费，用「记忆」页同一个密钥）。超时或出错就按原来的顺序，不拖慢回复。' },
  { key: 'memory.rerankModel', group: 'memory', label: '精排模型', def: 'BAAI/bge-reranker-v2-m3', source: '设计决定', hint: '和向量模型同一个接口地址；换别家要支持 /rerank。', advanced: true },
  { key: 'memory.rerankTopN', group: 'memory', label: '精排看前几条', def: 20, min: 2, max: 50, step: 1, source: EXP, hint: '越多越准、越慢。', advanced: true },
  { key: 'memory.rerankTimeoutMs', group: 'memory', label: '精排最多等多久', def: 1500, min: 300, max: 8000, step: 100, unit: '毫秒', source: EXP, hint: '超过就这一轮按原来的顺序。', advanced: true },
  { key: 'memory.versionKeep', group: 'memory', label: '自动保留的版本数', def: 50, min: 5, max: 1000, step: 5, source: EXP, hint: '人格、特质等的旧版本超过这个数自动清理（她标为重要的转折点不清）。', advanced: true },
  { key: 'memory.baseStability', group: 'memory', label: '一件普通小事记多牢', def: 0.6, min: 0.1, max: 5, step: 0.1, unit: '天', source: 'FSRS-4.5 默认参数（开源间隔重复算法，用数亿次复习记录拟合的幂函数遗忘模型；初次记住的稳定性按回答难易为 0.49 / 1.40 / 3.71 / 13.82 天，这里取最弱两档之间，因为聊天里的事不是刻意背的；取值是经验值）', hint: '稳定性 = 记得还有九成把握的天数。情绪、重要程度、专心程度会在这个基础上加成。', advanced: true },
  { key: 'memory.levelClear', group: 'memory', label: '记得清楚的线', def: 0.5, min: 0.2, max: 0.9, step: 0.05, source: EXP, hint: '记忆强度高于这条线，大意和细节都记得。', advanced: true },
  { key: 'memory.levelVague', group: 'memory', label: '只记得大概的线', def: 0.2, min: 0.05, max: 0.6, step: 0.05, source: EXP, hint: '在这条线和「记得清楚」之间，只记得「好像有这么回事」。', advanced: true },
  { key: 'memory.levelTip', group: 'memory', label: '要很强的线索才想得起的线', def: 0.05, min: 0.01, max: 0.3, step: 0.01, source: EXP, hint: '在这条线和「只记得大概」之间，只有很像的话题才能勾起来，而且可能只想起一半（话到嘴边）。再低就想不起来了，但数据还在，你在面板里能看到。', advanced: true },
  { key: 'memory.cueMatch', group: 'memory', label: '多像才算想到了', def: 0.5, min: 0.2, max: 0.9, step: 0.05, source: EXP, hint: '眼前的话和一段记忆意思的相似度（bge-m3 余弦）超过这个才会被勾起来。', advanced: true },
  { key: 'memory.strongCue', group: 'memory', label: '很强的线索', def: 0.75, min: 0.5, max: 0.95, step: 0.05, source: EXP, hint: '相似度到这个程度，很弱的记忆也能被勾起来（只想起一半）。', advanced: true },
  { key: 'memory.contextBonus', group: 'memory', label: '同一个地方更容易想起', def: 0.15, min: 0, max: 0.5, step: 0.05, source: 'Tulving & Thomson 1973（编码特异性）；Godden & Baddeley 1975（在哪学的在哪想得起）；加成大小是经验值', hint: '在同一个群、和同一个人聊时，更容易想起在那里发生的事。', advanced: true },
  { key: 'memory.moodCongruence', group: 'memory', label: '心境一致', def: 0.15, min: 0, max: 0.5, step: 0.05, source: 'Bower 1981；Matt、Vázquez & Campbell 1992 元分析（心境一致回忆效应稳定但中等）；加成大小是经验值', hint: '开心时更容易想起开心的事，难过时更容易想起难过的事。', advanced: true },
  { key: 'memory.encodeIdleMinutes', group: 'memory', label: '聊天停多久记一段', def: 5, min: 1, max: 60, step: 1, unit: '分钟', source: EXP, hint: '一个聊天停了这么久，就把刚才这段经历记下来。', advanced: true },
  { key: 'memory.encodeBatch', group: 'memory', label: '一段最多多少条消息', def: 60, min: 10, max: 200, step: 10, unit: '条', source: EXP, hint: '消息太多时分几段记；越大越省调用，但每次花的 token 越多。', advanced: true },
  { key: 'memory.dreamRecall', group: 'memory', label: '醒来记得梦的机会', def: 0.2, min: 0, max: 1, step: 0.05, source: 'Schredl 等的梦回忆频率调查（一般人一周记得一两次梦）', hint: '情绪越强的梦越容易记得；被叫醒时更容易记得。', advanced: true },
  { key: 'memory.embedUrl', group: 'memory', label: '向量模型接口地址', def: 'https://api.siliconflow.cn/v1', source: '设计决定', hint: '用来找意思相近的记忆；记忆文字会发给这个服务算向量，向量存在本机。' },
  { key: 'memory.embedModel', group: 'memory', label: '向量模型', def: 'BAAI/bge-m3', source: '设计决定', hint: 'SiliconFlow 上免费的 bge-m3。' },

  // ---------- 情绪 ----------
  { key: 'emotion.durationScale', group: 'emotion', label: '情绪持续时间倍数', def: 1, min: 0.25, max: 4, step: 0.05, source: 'Verduyn & Lavrijsen 2015 图 1（27 种情绪完全恢复的中位数：悲伤 120 小时、仇恨 60、快乐 35、羞愧 0.5……；233 名高中生的回忆报告）', hint: '各情绪的基础持续时间按研究；这里整体放大或缩小。事件越重要持续越久。' },
  { key: 'emotion.baselineValence', group: 'emotion', label: '平时的心情水位', def: 0.15, min: -0.5, max: 0.6, step: 0.05, source: 'Diener & Diener 1996（大多数人平时是轻度愉快的）', hint: '没什么事时心情回到哪里（-1 到 1）。属于性格，以后会随性格慢慢变。' },
  { key: 'emotion.rekindle', group: 'emotion', label: '想起旧事重新点燃的程度', def: 0.5, min: 0, max: 1, step: 0.05, source: 'Verduyn & Lavrijsen 2015（反复去想让情绪持续更久）；比例是经验值', hint: '想起一件带着情绪的事，当时的情绪按这个比例重新冒出来。' },
  { key: 'emotion.hungerMood', group: 'emotion', label: '饿了心情变差多少', def: 0.15, min: 0, max: 0.5, step: 0.05, source: EXP, hint: '很饿时心情往下拉的幅度。' },
  { key: 'emotion.maxActive', group: 'emotion', label: '同时最多几种情绪', def: 12, min: 3, max: 30, step: 1, source: EXP, hint: '太弱的会自然消失；超过这个数时最早的先放下。', advanced: true },
  { key: 'emotion.inertia', group: 'emotion', label: '心情惯性', def: 0.5, min: 0, max: 0.95, step: 0.05, source: 'Kuppens 等 2010；Houben 等 2015（中等水平）', hint: '越高心情越难回到平常；太高与幸福感低相关，默认中等。' },
  { key: 'emotion.contagion', group: 'emotion', label: '情绪传染强度', def: 0.3, min: 0, max: 1, step: 0.05, source: EXP, hint: '群里气氛、亲近的人的心情对她的影响有多大。' },
  { key: 'emotion.sleepSoften', group: 'emotion', label: '睡一觉情绪变淡', def: 0.1, min: 0, max: 0.6, step: 0.05, source: 'Walker & van der Helm 2009；Baran 等 2012；2022 元分析（结论不一致）', hint: '研究结论相反，默认只做很弱的缓和。' },
  { key: 'emotion.displacement', group: 'emotion', label: '迁怒倾向', def: 0.15, min: 0, max: 1, step: 0.05, source: EXP, hint: '气很大又很累时，有多大可能把气带到别人身上（只是语气冲一点，会道歉；越亲近越忍着）。' },

  // ---------- 动机与行动 ----------
  { key: 'motivation.actThreshold', group: 'motivation', label: '去做事的动力门槛', def: 0.5, min: 0.1, max: 0.95, step: 0.05, source: 'Steel 2007（时间动机理论的结构；门槛为经验值）', hint: '动力超过这个值才会真的去做；越高越容易犯懒。' },
  { key: 'motivation.dailyOutreachCap', group: 'motivation', label: '每天最多主动找人几次', def: 0, min: 0, max: 50, step: 1, source: '设计决定', hint: '0 表示不设上限，由她自己拿捏分寸。' },
  { key: 'motivation.quietHours', group: 'motivation', label: '主动找你的勿扰时段', def: '', source: '设计决定', hint: '例如 00:00-08:00；留空表示不设，她按对你作息的了解自己判断。' },
  { key: 'motivation.rewardLearning', group: 'motivation', label: '从结果里学的快慢', def: 0.2, min: 0, max: 1, step: 0.05, source: 'Lefebvre 等 2017；2021 Scientific Reports（具体学习率待查，暂取中等）', hint: '一次结果比预想好/坏，对以后想不想做的影响有多大。' },
  { key: 'motivation.distractibility', group: 'motivation', label: '容易分心', def: 1, min: 0.2, max: 3, step: 0.1, source: 'Steel 2007（时间动机理论：容易分心 × 回报要等多久，越大越拖延）；以后由性格里的尽责性决定', hint: '越大，回报要等越久的事越容易拖着不做。' },
  { key: 'motivation.outreachWaitHours', group: 'motivation', label: '主动找你后等多久算没回', def: 2, min: 0.5, max: 12, step: 0.5, unit: '小时', source: EXP, hint: '这么久你还没回，她会有点失落；没回之前她不会再追着发。' },

  // ---------- 人格与自我 ----------
  { key: 'personality.thresholdDays', group: 'personality', label: '性格变化门槛（天数）', def: 3, min: 1, max: 30, step: 1, unit: '天', source: '设计决定（TESSERA：多次、不同场合）', hint: '同一种表现要在两周内至少这么多个不同的日子出现，才算数。' },
  { key: 'personality.windowDays', group: 'personality', label: '门槛统计窗口', def: 14, min: 3, max: 60, step: 1, unit: '天', source: EXP, hint: '在多长时间里数上面那个天数。', advanced: true },
  { key: 'personality.stepSize', group: 'personality', label: '每一步的大小', def: 0.02, min: 0.005, max: 0.1, step: 0.005, source: 'Roberts 等 2017（约 24 周 d≈0.37）；Roberts、Walton & Viechtbauer 2006', hint: '过了门槛后一次往那个方向走多少（0～1 的尺度）。' },
  { key: 'personality.stepGapDays', group: 'personality', label: '同一项两步至少隔', def: 3, min: 1, max: 30, step: 1, unit: '天', source: EXP, hint: '防止变得太快。', advanced: true },
  { key: 'personality.pull', group: 'personality', label: '回到本来样子的拉力', def: 0.65, min: 0, max: 0.95, step: 0.05, source: 'Roberts & DelVecchio 2000（成年人秩次稳定性 0.6～0.7）；Ardelt 2000', hint: '越高越难离开本来的样子，越容易回去。' },
  { key: 'personality.ownerInfluenceCap', group: 'personality', label: '主人的影响力上限', def: 0.6, min: 0.3, max: 1, step: 0.01, source: EXP, hint: '一段时间里，推动她性格变化的力量最多有多少来自主人一个人。越高越像你希望的样子，也越可能变成只会迎合你。' },
  { key: 'personality.shadowMode', group: 'personality', label: '影子模式', def: false, source: '设计决定', hint: '开着时不知不觉的性格变化只计算、不生效，只显示在面板里。' },

  // ---------- 社会认知与关系 ----------
  { key: 'relations.trustLossRatio', group: 'relations', label: '信任掉得比涨得快', def: 2, min: 1, max: 5, step: 0.5, unit: '倍', source: 'Slovic 1993；2023 研究（不对称是有条件的，取中等）', hint: '一次失信对信任的影响是一次守信的几倍。' },
  { key: 'relations.fadeDays', group: 'relations', label: '不联系多久开始变淡', def: 30, min: 3, max: 365, step: 1, unit: '天', source: EXP, hint: '长期不联系，亲近度慢慢下降。' },
  { key: 'relations.wakeCloseness', group: 'relations', label: '多亲近算「很亲近的人」', def: 0.7, min: 0.3, max: 1, step: 0.05, source: EXP, hint: '「谁能叫醒她」选了「主人和很亲近的人」时，亲近度到这个数的人叫她也会醒。' },
  { key: 'relations.ignoreDisliked', group: 'relations', label: '不想理讨厌的人的机会', def: 0.85, min: 0, max: 1, step: 0.05, source: EXP, hint: '她很不喜欢、或者有心结的人找她时，有这么大的机会她不想搭理（只是安静看着）。主人不受影响。' },
  { key: 'relations.interjectScale', group: 'relations', label: '群里主动接话的倍数', def: 1, min: 0, max: 3, step: 0.1, source: '设计决定（插不插话由她的性格、心情、话题和在场的人决定，这里只整体放大缩小）', hint: '0 = 群里只在被叫到时说话。' },
  { key: 'relations.interjectCapPerHour', group: 'relations', label: '每群每小时最多主动接几次', def: 0, min: 0, max: 60, step: 1, source: '设计决定', hint: '0 = 不设上限，由她自己拿捏（被叫到不算在内）。' },
  { key: 'relations.missOwnerHours', group: 'relations', label: '多久没见主人会想', def: 24, min: 2, max: 168, step: 1, unit: '小时', source: '依恋理论（Bowlby；安全基地不在会不安）；时长是经验值', hint: '你这么久没理她，她会想你；依恋焦虑越高想得越早、越不安。' },

  // ---------- 会话 ----------
  { key: 'session.rotateRatio', group: 'session', label: '换新会话的比例', def: 0.5, min: 0.2, max: 0.9, step: 0.05, source: '设计决定', hint: '会话输入到了模型上限的这个比例就换新会话，设在 DSH 自己压缩的阈值之下。' },
  { key: 'session.idleNewSceneHours', group: 'session', label: '停多久算新的一段', def: 6, min: 1, max: 72, step: 1, unit: '小时', source: EXP, hint: '聊天停了这么久，下次就换新会话开始新的一段。' },

  // ---------- 模型和预算 ----------
  { key: 'models.deepThinkDaily', group: 'models', label: '每天最多深想几次', def: 30, min: 0, max: 500, step: 1, source: '设计决定', hint: '超出的按重要程度排到第二天；聊天不受影响。' },
  { key: 'models.backgroundTokensDaily', group: 'models', label: '每天后台最多用多少 token', def: 1500000, min: 0, max: 20000000, step: 100000, unit: 'token', source: '设计决定（按价格表约 ¥3/天上限）', hint: '状态记录、睡觉整理、深想、自己去做事合计；超了就排到第二天。' },
  { key: 'models.localModelDir', group: 'models', label: '本地小模型位置', def: '', source: '设计决定（实测 Qwen3.5-9B 4 位：深想判断 10/10，约 1.6 秒一步，峰值约 6 GB 内存；4B 版 8/10 且会编记忆，没选）', hint: '模型文件夹（MLX 格式）。留空 = 默认安装位置（Aurabot 里是 ~/Aurabot/mind/models/Qwen3.5-9B-mlx4）。没装时日常念头改用 DeepSeek，想得慢一些。' },
  { key: 'models.localPython', group: 'models', label: '本地小模型用的 Python', def: '', source: '设计决定', hint: '装了 mlx-lm 的 Python。留空 = 默认安装位置（Aurabot 里是 ~/Aurabot/mind/env/bin/python）。' },
  { key: 'models.localIdleMinutes', group: 'models', label: '本地小模型闲置多久自动停', def: 30, min: 5, max: 240, step: 5, unit: '分钟', source: EXP, hint: '停了省内存（约 6 GB），下次要用时再启动（要等一会儿）。', advanced: true },
]

const byKey = new Map(PARAMS.map((p) => [p.key, p]))

export function paramOf(key) {
  return byKey.get(key)
}

/** 默认值表（扁平 key → 值） */
export function defaults() {
  return Object.fromEntries(PARAMS.map((p) => [p.key, p.def]))
}

/**
 * 把用户设置和默认值合起来，并按范围夹紧；未知的键丢掉。
 * @param {Record<string, any>} saved
 */
export function resolveSettings(saved = {}) {
  const out = defaults()
  for (const [key, value] of Object.entries(saved || {})) {
    const p = byKey.get(key)
    if (!p || value === undefined) continue
    out[key] = clampParam(p, value)
  }
  return out
}

export function clampParam(p, value) {
  if (value === null) return null
  if (typeof p.def === 'boolean') return Boolean(value)
  if (typeof p.def === 'number' || (p.def === null && typeof p.min === 'number')) {
    const n = Number(value)
    if (!Number.isFinite(n)) return p.def
    const lo = p.min ?? -Infinity
    const hi = p.max ?? Infinity
    return Math.min(hi, Math.max(lo, n))
  }
  if (p.options) return p.options.some((o) => o.value === value) ? value : p.def
  return String(value)
}
