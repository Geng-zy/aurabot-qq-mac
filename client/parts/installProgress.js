    function InstallProgress({ inst }) {
      const pr = inst.progress
      const now = Date.now()
      const steps = inst.steps || []
      return h('div', { className: 'ab-install' },
        h('div', { className: 'ab-install-steps' }, steps.map((name, i) => h('div', { key: i, className: cx('st', i < inst.stepIndex && 'done', i === inst.stepIndex && 'on'), title: name },
          h('i', null, i < inst.stepIndex ? '✓' : i + 1), h('span', null, name.replace(/（.*?）/g, ''))))),
        h('div', { className: 'ab-flex', style: { marginTop: 12 } }, h('i', { className: 'ab-spin' }), h('b', null, '第 ' + (inst.stepIndex + 1) + ' / ' + steps.length + ' 步：' + inst.step), h('div', { className: 'ab-spacer' }),
          h('span', { className: 'ab-muted ab-small' }, '这一步 ' + fmtDur(now - inst.stepAt) + ' · 总共 ' + fmtDur(now - inst.startedAt))),
        inst.stepHint ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 2 } }, '预计：' + inst.stepHint) : null,
        pr && pr.kind === 'download' ? h('div', { className: 'ab-install-dl' },
          h('div', null, h('small', null, '已下载'), h('b', null, fmtBytes(pr.done))),
          h('div', null, h('small', null, '当前网速'), h('b', { style: { color: pr.speed < 20 * 1024 ? 'var(--ab-warn)' : undefined } }, fmtBytes(pr.speed) + '/s')),
          pr.speed < 20 * 1024 ? h('div', { className: 'ab-small', style: { color: 'var(--ab-warn)', flex: '1 1 220px' } }, '很慢的话：打开「用国内镜像下载」后重新点安装（已下好的不会重下），或者开着代理') : null) : null,
        pr && pr.kind === 'file' && pr.total ? h('div', { style: { marginTop: 10 } },
          h('div', { className: 'ab-flex ab-small' }, h('span', null, pr.name), h('div', { className: 'ab-spacer' }), h('span', null, fmtBytes(pr.done) + ' / ' + fmtBytes(pr.total) + '（' + Math.round((pr.done / pr.total) * 100) + '%）')),
          h('div', { className: 'ab-mood', style: { marginTop: 4 } }, h('i', { style: { width: Math.round((pr.done / pr.total) * 100) + '%' } }))) : null)
    }

    const SONG_PARTS = [['python', 'Python 环境'], ['applio', 'Applio（RVC 推理引擎）'], ['separator', '人声分离'], ['ffmpeg', 'ffmpeg（混音）'], ['weights', '预训练文件（音高、音色特征）'], ['separatorModel', '人声分离模型']]
