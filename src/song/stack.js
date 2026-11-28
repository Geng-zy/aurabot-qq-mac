// 安装清单：两套 Python 环境各装什么（版本都在真实机器上跑通过）。
// 从 song/studio.js 抽出来，供 studio（安装链）与 separator-env（判断环境完整度）共用，避免循环依赖。

export const MAC_STACK = {
  applioExtras: ['python-ffmpeg==2.0.12'],
  // librosa 1.0 不再带 audioread，而 audio-separator 0.48 还在直接 import 它，所以显式补装
  separator: ['audio-separator[cpu]==0.48.0', 'librosa==1.0.0', 'audioread==3.1.0', 'imageio-ffmpeg==0.8.1'],
  // 语音页「安装语音组件」装的 edge-tts（2026-11-09 在 Python 3.13.18 上实测装好并念出语音）
  edgeTts: 'edge-tts==7.3.1',
}
