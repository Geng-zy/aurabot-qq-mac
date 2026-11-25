    function Choices({ value, options, onChange }) {
      return h('div', { className: 'ab-choices', role: 'radiogroup' }, options.map((o) => h('button', { key: o.value, type: 'button', role: 'radio', 'aria-checked': o.value === value, className: cx('ab-choice', o.value === value && 'on'), onClick: () => onChange(o.value) },
        h('b', null, o.icon || null, o.label), o.desc ? h('small', null, o.desc) : null)))
    }

    /** 贴表情的映射表：QQ 系统表情（自己的编号）＋ emoji（Unicode 码点），两种都能直接填给 set_msg_emoji_like。 */
    /** QQ 系统表情的预览图：社区维护的 QFace 图库按 id 取 png；取不到就把图藏起来，只留名字。 */
    const QFACE_IMG = (id) => 'https://koishi.js.org/QFace/assets/qq_emoji/' + id + '/png/' + id + '.png'
