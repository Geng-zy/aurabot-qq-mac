import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

test('关于页通过系统导航打开', () => {
  assert.match(src, /id: 'system'[^\n]*pages: \[([^\]]|\n)*id: 'about', label: '关于'/)
  assert.match(src, /id: 'about'[^\n]*search: '[^']*版本/)
  assert.match(src, /about: About/)
})

test('关于页的手册与版本指向本分支，上游链接用于署名', () => {
  const body = src.slice(src.indexOf('    function About({ st })'), src.indexOf('    function RecentLogs({ go })'))
  const repos = src.match(/^    const (?:PROJECT_REPO|UPSTREAM_REPO|MODULE_REPOS) = .+$/gm)
  const h = (type, props, ...children) => ({ type, props, children })
  const tree = runInNewContext(`${repos.join('\n')}\n${body}\nAbout({ st: { version: '1.5.1', apiVersion: 1 } })`, { h, Card: 'card' })
  const links = new Map()
  function visit(node) {
    if (typeof node !== 'object' || !node) return
    if (node.type === 'a') links.set(node.children[0], node.props.href)
    for (const child of node.children) visit(child)
  }
  visit(tree)
  const repo = 'https://github.com/Geng-zy/aurabot-qq-mac'
  assert.equal(links.get('项目仓库'), repo)
  assert.equal(links.get('用户手册'), `${repo}/blob/main/docs/USER-MANUAL.md`)
  assert.equal(links.get('发布记录'), `${repo}/releases`)
  assert.equal(links.get('提交改动'), `${repo}/pulls`)
  assert.equal(links.get('上游贡献者'), 'https://github.com/aureth-labs/dsh-aurabot-qq/graphs/contributors')
  assert.equal(links.get('Geng-zy/aurabot-qq-mac-mods'), 'https://github.com/Geng-zy/aurabot-qq-mac-mods')
  assert.equal(links.get('aureth-labs/dsh-aurabot-qq-mods'), 'https://github.com/aureth-labs/dsh-aurabot-qq-mods')
  const rendered = JSON.stringify(tree)
  assert.doesNotMatch(rendered, /1130575035|核心开发者|contrib\.rocks|\/issues/)
})
