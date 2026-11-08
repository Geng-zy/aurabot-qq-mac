# 从一个音色的数据集（她本人的干声录音）生成「音色档案」：音域 + 音色参照。
# 翻唱时自动定调、挪八度（key_plan.py）按档案里的音域来，音色校正（tone_match.py）按档案里的参照来。
# 没有档案的音色只做去混响、拆主唱伴唱和换声，不定调、不挪八度、不校正音色。
#
# 音域的几个数按她数据集的音高分布换算（比例是给大肥鱼一首首试听调出来的：
# 她 p10 234 / 中位 347 / p95 520 Hz → 最低 10% 不低于 220、中间不高于 360、上限 784（G5）、
# 低于 200 升八度、高于 600 降八度）。换别的音色时这些比例只是起点，听着不对可以直接改 JSON。
#
# 用法：python voice_profile.py <数据集文件夹> <输出 .profile.json> [--ceil 上限Hz]
#   数据集文件夹里放 wav / flac / mp3，会往下找子文件夹。
import glob
import json
import os
import sys

import numpy as np

APPLIO = os.environ.get('AURABOT_APPLIO') or os.path.expanduser('~/Aurabot/rvc/Applio')
sys.path.insert(0, APPLIO)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

AUDIO = ('.wav', '.flac', '.mp3', '.m4a', '.ogg')


def range_from(f0):
    """有声帧的音高（Hz）→ 音域设置。"""
    v = f0[f0 > 0]
    p10, p25, p50, p95 = (float(np.percentile(v, q)) for q in (10, 25, 50, 95))
    return {
        'center': round(p50),                 # 她平时的中间音
        'floorP10': round(p10 * 0.94),        # 整首最低的 10% 不低于这个（太低发闷）
        'medMax': round(p50 * 1.037),         # 整首中间的音不高于这个（太高发尖）
        'ceilHz': round(p95 * 1.508),         # 高过这个就容易破音、发哑（模型的上限）
        'foldLow': round(p50 * 0.576),        # 一段的中间音低于这个就升八度
        'foldLowMax': round(p95),             # 升两个八度时，升完不超过这个
        'foldHigh': round(p50 * 1.729),       # 一段的中间音高于这个就降八度
        'foldHighMin': round(p10 * 1.068),    # 降完不低于这个
        'stats': {'p10': round(p10), 'p25': round(p25), 'p50': round(p50), 'p95': round(p95), 'voicedSec': round(len(v) / 100)},
    }, [round(p25 * 1.05), round(p95)]


def main(folder, out, ceil=None):
    import librosa
    from rvc.lib.predictors.RMVPE import RMVPE0Predictor
    from tone_match import build_reference
    files = sorted(p for p in glob.glob(os.path.join(folder, '**', '*'), recursive=True) if p.lower().endswith(AUDIO))
    if not files:
        raise SystemExit(f'{folder} 里没有音频文件')
    model = RMVPE0Predictor(os.path.join(APPLIO, 'rvc/models/predictors/rmvpe.pt'), device='cpu')
    f0 = np.concatenate([model.infer_from_audio(librosa.load(p, sr=16000, mono=True)[0], thred=0.03) for p in files])
    if (f0 > 0).sum() < 30 * 100:
        raise SystemExit('数据集里能测出音高的声音不到 30 秒，不够生成档案')
    rng, pitch_range = range_from(f0)
    if ceil:
        rng['ceilHz'] = float(ceil)
    profile = {'schema': 1, 'source': os.path.abspath(folder), 'files': len(files), 'range': rng,
               'tone': build_reference(model, files, pitch_range)}
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(profile, fh, ensure_ascii=False, indent=1)
    print(json.dumps({'ok': True, 'files': len(files), 'range': {k: v for k, v in rng.items() if k != 'stats'}}, ensure_ascii=False))


if __name__ == '__main__':
    args = sys.argv[1:]
    ceil = None
    if '--ceil' in args:
        i = args.index('--ceil')
        ceil = args[i + 1]
        del args[i:i + 2]
    main(args[0], args[1], ceil)
