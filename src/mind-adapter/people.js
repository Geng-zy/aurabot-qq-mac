// 忘掉/恢复一个人：关系、记忆和恢复区。
export function createPeople({ mind, mem, syncOwner, personOf, privateChatOf, clearWorking }) {
  function forgetPerson(ref, mode, { clear = false } = {}) {
    syncOwner()
    const pid = personOf(ref)
    if (!pid) return { ok: false, message: '要忘掉谁？' }
    if (mind.isOwner(pid)) return { ok: false, message: '管理员不能忘' }
    if (mode === 'delete' || (mode === 'stop' && clear)) clearWorking()
    const windows = mind.idsOf(pid).map((id) => privateChatOf(id))
    if (mode === 'delete') return { ...mind.forgetPerson(pid, { windows }), message: '忘掉了：关于他的事都移进了恢复区，30 天内能放回来' }
    if (mode === 'stop') {
      if (clear) return { ...mind.forgetPerson(pid, { keepPerson: true, windows }), message: '以后不记他了，以前的也移进了恢复区（30 天内能放回来）' }
      mind.setNoMemory(pid, true)
      return { ok: true, message: '以后不记他了（以前的记忆还在）' }
    }
    if (mode === 'resume') { mind.setNoMemory(pid, false); return { ok: true, message: '又会记他了' } }
    return { ok: false, message: '不认识的操作' }
  }

  async function restorePerson(ref) {
    const ids = mind.restorePerson(personOf(ref))
    if (!ids) return { ok: false, message: '恢复区里没有这个人（可能已经过了 30 天）' }
    mem.embedEpisodes(ids).catch(() => {})
    return { ok: true, message: `放回来了：${ids.length} 件事` }
  }

  return { forgetPerson, restorePerson }
}
