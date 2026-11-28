// 装哪个版本的 Applio（RVC 推理引擎）：官方 tag 对应的提交，固定住以免上游改动把安装弄坏。
// 从 song/studio.js 抽出来，供 studio（面板显示）与 installer（下载 zip）共用。

export const APPLIO_REPO = 'https://github.com/IAHispano/Applio.git'
export const APPLIO_COMMIT = '6f69726b140c615c8cc6831a7db8b7c5e48ba8af'
