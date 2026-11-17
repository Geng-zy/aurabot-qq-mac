export const CHAT_STYLE_INSTRUCTION = '闲聊或接梗时，从对方刚说的话、发的图或眼前的事里挑一个具体细节直接回，一句说得清就停。遇到摸摸、抱抱，可以顺着对方的动作回应。省去「我认」「我接」这种只表示接话的开场和重复总结。身体感受可以自然影响语气。和当前话题有关、被问起或有事要说时，再提身体状态。'

const FOOD_TOPIC = /饿|吃饱|肚子|投喂|喂[你我她它]|饭点|(?:早|午|晚|夜)餐|夜宵|点餐|吃(?:饭|了|过|点|完|啥|什么|东西|一口|不下)|(?:做|开|吃|点)(?:早|午|晚)?饭|(?:蛋糕|面包|奶茶|零食|食物|饼干|米饭|拉面|泡面|便当)|身体(?:还好|怎么样|状态)/u
export const isFoodTopic = (text) => FOOD_TOPIC.test(text)

const FILLER = /^(?:这(?:一)?(?:摸|抱|拍|夸|亲|下|个梗|梗|表情|张图|图|条|句话|句|回|次)\s*)?我(?:就)?(?:认|接)(?:了|啦)?[，,。！？!?；;]\s*(?=\S)/u
const COMFORT_ONLY = /^(?:来[，,]?\s*)?(摸摸|抱抱|拍拍)(?:你|头)?[\s\p{P}\p{S}ωっノﾉづつ´｀]*$/u
const HUNGER_REPORT = /(?:饿(?:了|坏了|得)|(?:还(?:是)?|有点|好|很|挺|真|太)饿|(?:我|肚子)饿|(?:还)?没吃饱|肚子(?:空|叫|咕|瘪))/u
const VERBATIM_REQUEST = /(?:逐字|一字不差|原样)(?:复述|引用|抄|输出|发)|复读(?:一下)?/u

/** 只处理句首有后续内容的套话，以及单纯安抚时重复冒出的饥饿报告。 */
export function polishChatProse(text, userText = '') {
  if (VERBATIM_REQUEST.test(userText)) return text
  const clean = text.replace(FILLER, '')
  if (!HUNGER_REPORT.test(clean) || isFoodTopic(userText)) return clean
  const comfort = COMFORT_ONLY.exec(userText.trim().split('\n').at(-1) || '')?.[1]
  if (!comfort) return clean
  const relevant = clean.split(/(?<=[，,。！？!?；;\n])/u).filter((clause) => !HUNGER_REPORT.test(clause)).join('').trim()
  return relevant.replace(/[，,；;]+$/u, '') || (comfort === '摸摸' ? '蹭蹭' : comfort)
}
