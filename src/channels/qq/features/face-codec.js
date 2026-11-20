// QQ 系统表情编解码：<face:名字> ↔ face id，以及文本到消息段。
import { createFaces, textToSegments, stripFaceTags } from '../faces.js'

export function createFaceCodec({ call, log }) {
  const faces = createFaces({ onebot: { call }, log })
  return {
    faces,
    textSegments: (text, withFaces = true) => (withFaces ? textToSegments(text, faces.idOf) : [{ type: 'text', data: { text: stripFaceTags(text) } }]),
  }
}
