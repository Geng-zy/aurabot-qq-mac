    function About({ st }) {
      const link = (label, href, button = false) => h('a', { href, className: button ? 'ab-link-btn' : undefined, target: '_blank', rel: 'noreferrer' }, label)
      const entry = (title, ...content) => h('div', { key: title }, h('dt', null, title), h('dd', null, ...content))
      return h('div', { className: 'ab-grid' },
        h(Card, { className: 'ab-about-project', title: 'AuraBot for macOS', desc: 'v' + st.version + ' · 面板 API v' + (st.apiVersion || '?') },
          h('p', null, '由 Geng-zy 维护的 DeepSeek Harness 插件。心智核心管理大肥鱼的记忆、情绪和关系。Apple 芯片 Mac 上可通过 OneBot v11 接入 QQ，也可部署本地念头模型和生图模型。'),
          h('div', { className: 'ab-note' }, '插件更新请在 DSH 的插件管理器里进行；这里不再自己检查或安装新版本。'),
          h('div', { className: 'ab-about-links' },
            link('项目仓库', PROJECT_REPO, true),
            link('用户手册', PROJECT_REPO + '/blob/main/docs/USER-MANUAL.md', true),
            link('发布记录', PROJECT_REPO + '/releases', true),
            link('提交改动', PROJECT_REPO + '/pulls', true))),
        h('div', { className: 'ab-grid ab-g2' },
          h(Card, { title: '模块来源' }, h('dl', { className: 'ab-about-origin' },
            entry('macOS 分支模块库', link(MODULE_REPOS.mac, 'https://github.com/' + MODULE_REPOS.mac)),
            entry('上游模块库（只读参考）', link(MODULE_REPOS.upstream, 'https://github.com/' + MODULE_REPOS.upstream)))),
          h(Card, { title: '来源与许可' }, h('dl', { className: 'ab-about-origin' },
            entry('上游项目', link('aureth-labs/dsh-aurabot-qq', UPSTREAM_REPO), ' · ', link('上游贡献者', UPSTREAM_REPO + '/graphs/contributors')),
            entry('许可证', link('MIT（插件代码）', PROJECT_REPO + '/blob/main/LICENSE'), ' · ', link('素材和第三方署名', PROJECT_REPO + '/blob/main/THIRD-PARTY-NOTICES.md'))))))
    }
