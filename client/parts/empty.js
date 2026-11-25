    function Empty({ icon, text }) {
      return h('div', { className: 'ab-empty' }, h('div', { className: 'big' }, icon || '🐋'), text)
    }

    /** 一行一个的列表框：输入时保留原文（含正在敲的空行），只把解析结果交给草稿。 */
