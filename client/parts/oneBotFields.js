    function OneBotFields({ draft, f }) {
      return h(Fragment, null,
        h(Row, { label: 'WebSocket 地址', hint: '正向 WebSocket（OneBot v11），收消息靠它，必填。DSH 在 Docker 里的话，要填 DSH 容器能访问到的地址' }, f.text('platforms.qq.wsUrl', { size: 'wide', placeholder: 'ws://127.0.0.1:3001' })),
        h(Row, { label: 'WebSocket 令牌', hint: '对方设了 access_token 就填，没设留空' }, f.secret('platforms.qq.wsToken', { savedText: '已保存' })),
        h(Row, { label: 'HTTP 地址', hint: '可选。填了就用 HTTP 调接口，不填就都走 WebSocket' }, f.text('platforms.qq.httpUrl', { size: 'wide', placeholder: 'http://127.0.0.1:3000' })),
        h(Row, { label: 'HTTP 令牌' }, f.secret('platforms.qq.httpToken', { savedText: '已保存' })))
    }

    /** 平台入口：QQ / Telegram 共用状态卡；后续适配器会在这里出现。 */
