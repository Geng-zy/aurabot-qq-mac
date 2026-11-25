// 贴表情面板：内置常用 emoji + QQ 网关表情目录（取不到就只用内置）。

const REACT_EMOJIS = [
  { char: '👍', name: '赞', id: '128077' },
  { char: '❤️', name: '爱心', id: '10084' },
  { char: '😂', name: '笑哭', id: '128514' },
  { char: '😭', name: '大哭', id: '128557' },
  { char: '🤔', name: '思考', id: '129300' },
  { char: '😅', name: '冷汗', id: '128517' },
  { char: '😳', name: '脸红', id: '128563' },
  { char: '🥺', name: '委屈', id: '129402' },
  { char: '🎉', name: '庆祝', id: '127881' },
  { char: '🌹', name: '玫瑰', id: '127801' },
  { char: '🍬', name: '糖', id: '127852' },
  { char: '✨', name: '闪', id: '10024' },
  { char: '🔥', name: '火', id: '128293' },
  { char: '🙏', name: '拜托', id: '128591' },
]

export function registerFacesRoutes({ route, channels }) {
  route('/panel/faces', async () => {
    const qqChannel = channels.get('qq')
    const faces = qqChannel?.faceCatalog ? await qqChannel.faceCatalog() : []
    return { ok: true, faces, emojis: REACT_EMOJIS }
  })
}
