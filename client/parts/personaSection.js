    function PersonaSection({ sec, lead, first, last, onChange, onMove, onDelete, onPolish, pending, onPick, onFlip }) {
      const showing = pending ? (pending.view === 'new' ? pending.text : sec.text) : sec.text
      const color = lead ? 'var(--ab-sea)' : PSEC_COLORS[sec.k % PSEC_COLORS.length]
      return h('div', { className: cx('ab-psec', lead && 'lead', pending && 'cmp'), style: { '--c': color } },
        h('div', { className: 'ab-psec-head' },
          lead
            ? h('div', { className: 'ab-psec-fixed' }, '开场', h('small', null, 'ta是谁，一两段话'))
            : h('input', { className: 'ab-psec-title', value: sec.title, placeholder: '这一节叫什么', maxLength: 30, onChange: (e) => onChange({ title: e.target.value.replace(/[【】\n]/g, '') }) }),
          h('span', { className: 'ab-psec-n' }, showing.length + ' 字'),
          h('div', { className: 'ab-psec-act' },
            lead ? null : h('button', { type: 'button', className: 'ab-ibtn', title: '往上移', disabled: first || !!pending, onClick: () => onMove(-1) }, navIcon('M12 19V5M6 11l6-6 6 6')),
            lead ? null : h('button', { type: 'button', className: 'ab-ibtn', title: '往下移', disabled: last || !!pending, onClick: () => onMove(1) }, navIcon('M12 5v14M6 13l6 6 6-6')),
            lead ? null : h('button', { type: 'button', className: 'ab-ibtn danger', title: '删掉这一节', disabled: !!pending, onClick: onDelete }, navIcon('M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12'))),
          pending
            ? null
            : h(AiButton, { onClick: onPolish, empty: !sec.text.trim() })),
        h('textarea', {
          value: showing, rows: autoRows(showing), readOnly: !!pending,
          placeholder: lead ? '你是「…」，一个真实存在的人，正在用手机 QQ 和对面聊天。' : '- 一条一行，短句就好',
          onChange: (e) => onChange({ text: e.target.value }),
        }),
        pending ? h('div', { className: 'ab-compare' },
          h('span', { className: 'ab-compare-tag' }, pending.view === 'new' ? 'AI 润色版' : '原版'),
          h('span', { className: 'ab-muted ab-small' }, pending.view === 'new' ? '和原版比：' + (pending.text.length - sec.text.length >= 0 ? '多 ' : '少 ') + Math.abs(pending.text.length - sec.text.length) + ' 字' : '还没改过的样子'),
          h('div', { className: 'ab-spacer' }),
          h('button', { type: 'button', className: 'ab-chip solid', onClick: onFlip }, pending.view === 'new' ? '看原版' : '看润色版'),
          h(Btn, { small: true, kind: 'primary', onClick: () => onPick(pending.view) }, pending.view === 'new' ? '用润色版' : '保留原版')) : null)
    }
