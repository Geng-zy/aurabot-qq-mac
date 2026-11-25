    function LogLine({ e }) {
      return h('div', { className: cx('ab-log', e.level) }, h('span', { className: 't' }, e.time), h('span', { className: 'a' }, e.area), h('span', { className: 'm' }, e.text))
    }

    /** 已有 OneBot 机器人的地址和令牌。 */
