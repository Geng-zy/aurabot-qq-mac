// 数据目录、JSON 读写（UTF-8 无 BOM、先写临时文件再改名）。

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 插件所有数据都放这儿：~/.dsh/plugins-data/aurabot/ */
export function dataDir(...parts) {
  const base = process.env.AURABOT_DATA_DIR || join(dshHome(), 'plugins-data', 'aurabot')
  return join(base, ...parts)
}

export function ensureDir(p) {
  mkdirSync(p, { recursive: true })
  return p
}

export function readJson(file, fallback) {
  try {
    let text = readFileSync(file, 'utf8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    return JSON.parse(text)
  } catch (error) {
    return typeof fallback === 'function' ? fallback() : fallback
  }
}

/** 严格读取：文件不存在才用 fallback；JSON 损坏时把原文件留底并抛出，不能静默当空配置。 */
export function readJsonStrict(file, fallback) {
  let text
  try { text = readFileSync(file, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return typeof fallback === 'function' ? fallback() : fallback
    throw error
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  try { return JSON.parse(text) } catch (error) {
    const backup = `${file}.broken-${Date.now()}`
    try { renameSync(file, backup) } catch {}
    throw new Error(`配置文件 JSON 损坏，已备份为 ${backup}：${error.message}`)
  }
}

export function writeJson(file, value) {
  ensureDir(dirname(file))
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, file)
}

export { existsSync }
