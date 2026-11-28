// 给她看的「此刻」：现在几点、今天哪天、库里各有多少条、完整性问题。
// 从 mind/index.js 抽出来：这一支只读时钟、设置与计数，不写任何东西。

export function createStatus({ store, now, tz, dayKey, describeNow, identity, getMemory, getRecovered }) {
  function nowText() {
    return describeNow(now(), tz())
  }
  function today() {
    return dayKey(now(), tz())
  }

  function status() {
    const id = identity()
    return {
      identity: id,
      now: nowText(),
      today: today(),
      counts: {
        perception: store.prep('SELECT COUNT(*) AS n FROM perception').get().n,
        episodes: store.prep("SELECT COUNT(*) AS n FROM episodes WHERE status = 'live'").get().n,
        people: store.prep('SELECT COUNT(*) AS n FROM people').get().n,
        versions: store.prep('SELECT COUNT(*) AS n FROM versions').get().n,
        vectors: store.prep('SELECT COUNT(*) AS n FROM vectors').get().n,
        memory: getMemory().counts(),
      },
      integrity: store.check(),
      recovered: getRecovered(),
    }
  }


  return { nowText, today, status }
}
