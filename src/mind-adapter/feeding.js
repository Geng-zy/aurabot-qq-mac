const foodEnding = /(?:蛋糕|饼干|面包|甜点|奶茶|果汁|牛奶|酸奶|咖啡|茶|豆浆|可乐|饮料|冰淇淋|雪糕|巧克力|水果|苹果|草莓|橘子|葡萄|香蕉|西瓜|饭|饭团|粥|汤|包子|饺子|面条|馒头|披萨|汉堡|薯条|糖)$/u
const quantity = /^(?:(?:这一|这|一|两|二|半|几)?(?:个|块|片|杯|碗|盘|瓶|份|口|颗|条|盒|袋|勺)\s*)/u
const uncertainOffer = /(?:如果|假设|只是说|要不要|想不想|给你看|不能|不给|不喂|没给|明天|下次|以后|待会|图[片像]|照片|表情包|[?？“”「」])/u
const handover = /^(?:[喏诺呐嗯好]|给你|给|拿着|接着|张嘴|尝尝|吃吧|喝吧)[。！!，,～~\s]*$/u
const flavour = /^(草莓|芒果|蓝莓|抹茶|巧克力|香草|原味|柠檬|葡萄|蜜桃|榴莲|奶油)(?:口味|味)?的?[。！!，,～~\s]*$/u

function offeredFood(text) {
  if (uncertainOffer.test(text)) return ''
  const body = text.trim().replace(/[。！!，,～~\s]+$/u, '')
  const after = /^(?:那|来|我){0,2}\s*(?:给你(?:买了|拿了|带了|做了|递了|送了)?|喂你(?:吃|喝)?)\s*(.+?)(?:吃|喝)?$/u.exec(body)
  const before = /^(.+?)\s*给你(?:吃|喝)?$/u.exec(body)
  const food = (after?.[1] || before?.[1] || '').trim().replace(quantity, '')
  return /^\p{Script=Han}{1,12}$/u.test(food) && foodEnding.test(food) && !/想|问|说|画|拍|过|留着/u.test(food) ? food : ''
}

/** 同一私聊最近的递食物原话。中间只接受交接短句和少量明确的口味简答。 */
export function naturalFoodOffer(rows, who) {
  let taste = ''
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row.dir !== 'in') continue
    if (row.who !== who) return null
    const text = row.text.trim()
    const food = offeredFood(text)
    if (food) {
      const name = taste && /^(?:蛋糕|奶茶|冰淇淋|雪糕|酸奶)$/u.test(food) ? taste + food : food
      return { food: name, at: row.at }
    }
    const match = flavour.exec(text)
    if (match) taste ||= match[1]
    else if (!handover.test(text)) return null
  }
  return null
}

export function acceptsFood(text) {
  return String(text || '').replace(/^\[语音\]\s*/u, '').split(/(?<=[。！？!?])|\n/u).some((part) => {
    const line = part.trim().replace(/^[（(\s]+/u, '')
    if (/[？?]|(?:才怪|骗你的)/u.test(line)) return false
    return /^(?:我)?(?:一口(?:咬(?:下去|下来|掉|住|了)|吃(?:下|掉|了)|喝(?:下|掉|了))|(?:咬|吃|喝|尝)了(?:一口|一小口)?|(?:收下|吃下|喝下|吃完|喝完)了)(?=[，,。！!、：:\s）)]|$)/u.test(line)
  })
}
