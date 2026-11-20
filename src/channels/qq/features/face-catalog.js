// QQ 系统表情目录：内置整表打底，网关能取到就合并。
import { FACE_TABLE } from '../face-table.js'
import { buildFaceIndex } from '../faces.js'

export function createFaceCatalog({ call, log }) {
  return async function faceCatalog() {
    let byId = new Map(FACE_TABLE.map((f) => [String(f.id), f.name]))
    try {
      const r = await call('fetch_sys_faces', {}, { timeoutMs: 8000 })
      const built = buildFaceIndex(r?.packs ? r : r?.data)
      if (built.byId.size) byId = new Map([...byId, ...built.byId])
    } catch (error) { log.debug('取 QQ 系统表情目录失败，只用内置的：', error.message) }
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => Number(a.id) - Number(b.id))
  }
}
