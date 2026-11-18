export const CHAT_STYLE_INSTRUCTION = '像手机聊天：短、断、具体。先接对方刚说的一个细节，不总结、不复述、不解释自己为什么这么说。不要用「好的」「收到」「我理解」「听起来你」「从你的描述看」「我建议」「总的来说」这类客服/咨询腔开头，也不要每轮都提问或给方案。大多数回复一两句，允许「嗯」「啊？」「真的假的」这种短接；被问建议时先问一句，别直接列步骤。遇到摸摸、抱抱可以顺着动作回应。身体感受自然影响语气，和当前话题有关、被问起或有事要说时再提。'

const FOOD_TOPIC = /饿|吃饱|肚子|投喂|喂[你我她它]|饭点|(?:早|午|晚|夜)餐|夜宵|点餐|吃(?:饭|了|过|点|完|啥|什么|东西|一口|不下)|(?:做|开|吃|点)(?:早|午|晚)?饭|(?:蛋糕|面包|奶茶|零食|食物|饼干|米饭|拉面|泡面|便当)|身体(?:还好|怎么样|状态)/u
export const isFoodTopic = (text) => FOOD_TOPIC.test(text)

const FILLER = /^(?:这(?:一)?(?:摸|抱|拍|夸|亲|下|个梗|梗|表情|张图|图|条|句话|句|回|次)\s*)?我(?:就)?(?:认|接)(?:了|啦)?[，,。！？!?；;]\s*(?=\S)/u
const ASSISTANT_OPENER = /^(?:(?:好的|收到|明白了|我明白了|我理解(?:了)?)[，,。！!：:\s]+|(?:听起来|从你(?:的)?(?:话|描述|说法)(?:里|来看|看)?|我建议|总的来说|首先)(?:[，,。！!：:\s]+|(?=[你他她这那还就真没])))/u
const ROLEPLAY_CLICHE = /(?:这句话(?:稳|接得漂亮)|比之前的都(?:重|轻|强|平|稳)|我记下(?:了|这事)|这个账我记住了|我守着|你去[，,]\s*我跟|我不拦你|我不催你|我认你|认下|收不回去|认得实)/u
const COMFORT_ONLY = /^(?:来[，,]?\s*)?(摸摸|抱抱|拍拍)(?:你|头)?[\s\p{P}\p{S}ωっノﾉづつ´｀]*$/u
const HUNGER_REPORT = /(?:饿(?:了|坏了|得)|(?:还(?:是)?|有点|好|很|挺|真|太)饿|(?:我|肚子)饿|(?:还)?没吃饱|肚子(?:空|叫|咕|瘪))/u
const VERBATIM_REQUEST = /(?:逐字|一字不差|原样)(?:复述|引用|抄|输出|发)|复读(?:一下)?/u

/** 只处理句首有后续内容的套话，以及单纯安抚时重复冒出的饥饿报告。 */
export function polishChatProse(text, userText = '') {
  if (VERBATIM_REQUEST.test(userText)) return text
  const clean = text.replace(FILLER, '').replace(ASSISTANT_OPENER, '')
  const roleplayOnly = ROLEPLAY_CLICHE.test(clean) && clean.replace(new RegExp(ROLEPLAY_CLICHE.source, 'gu'), '').replace(/[，,。！？!?…\s]/gu, '').length === 0
  if (roleplayOnly) return /[?？]/u.test(userText) ? '啊？' : '嗯'
  if (!HUNGER_REPORT.test(clean) || isFoodTopic(userText)) return clean
  const comfort = COMFORT_ONLY.exec(userText.trim().split('\n').at(-1) || '')?.[1]
  if (!comfort) return clean
  const relevant = clean.split(/(?<=[，,。！？!?；;\n])/u).filter((clause) => !HUNGER_REPORT.test(clause)).join('').trim()
  return relevant.replace(/[，,；;]+$/u, '') || (comfort === '摸摸' ? '蹭蹭' : comfort)
}
