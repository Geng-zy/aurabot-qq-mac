    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      try {
        primitives()
      } catch (error) {
        slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, () => h(MissingPrimitivesPage, { error })))
        slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => 'Aurabot' }, WhaleIcon))
        return
      }
      // 写法同 DSH 自带的「自动化任务」（order 10）和「插件」（order 0）：排在它们后面
      slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, AurabotPage))
      slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => 'Aurabot' }, WhaleIcon))
    }
