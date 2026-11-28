// 她是谁：名字、小名、年龄与生日、时区、专一开关、以及「谁是管理员」与唤醒词。
// 从 mind/index.js 抽出来：这一支只读设置与 self，再加 id 归一与记忆的可见性重算。

import { currentAge, isBirthday } from './clock.js'

export function createIdentity({ store, now, settings, canon, getOwnerId, setOwnerId, getMemory }) {
  function identity() {
    const s = settings()
    const t = now()
    const age = currentAge({ age: s['identity.age'], setAt: store.get('identity.ageSetAt', 0), birthday: s['identity.birthday'] }, t, s['identity.timezone'])
    const self = store.get('self', { name: '', nickname: '' })
    return {
      name: self.name || '',
      nickname: self.nickname || '',
      age,
      birthday: s['identity.birthday'] || '',
      isBirthdayToday: isBirthday(t, s['identity.timezone'], s['identity.birthday']),
      timezone: s['identity.timezone'],
      exclusive: s['identity.exclusive'] !== false,
      // 满 18 岁才有性欲；没填年龄按未满处理
      sexualDesire: age !== null && age >= 18,
      get ownerId() { return getOwnerId() },
    }
  }
  function setOwner(id) {
    const next = canon(id)
    if (next === getOwnerId()) return
    setOwnerId(next)
    getMemory().touchAudience()
  }
  function isOwner(personId) {
    return Boolean(getOwnerId()) && canon(personId) === getOwnerId()
  }
  /** 名字和小名（她改名后自动跟着变），加上管理员额外加的昵称。 */
  function wakeWords(extra = []) {
    const { name, nickname } = identity()
    return [...new Set([name, nickname, ...extra].map((x) => String(x || '').trim()).filter(Boolean))]
  }


  return { identity, setOwner, isOwner, wakeWords }
}
