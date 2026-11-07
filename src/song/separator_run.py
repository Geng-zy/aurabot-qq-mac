# 运行 audio-separator，并把「自定义人声分离模型」补进它的模型清单。
# audio-separator 只认自带清单里的模型；想用清单外的（比如 unwa 的 BS-Roformer Leap Xe），
# 在分离模型文件夹里放一个 extra-models.json：
#   {
#     "Roformer Model: BS-Roformer Leap Xe Vocals by unwa": {
#       "filename": "bs_leap_xe_voc.ckpt",
#       "config": "leap_xe_config_voc.yaml",
#       "sha256": "b739c1d2…",            # 可选；写了就核对，对不上不用
#       "stems": ["vocals", "other"],      # 可选，默认 vocals / other
#       "target_stem": "vocals"            # 可选
#     }
#   }
# 模型和配置文件要自己放进同一个文件夹（不会替你下载）。只在运行时补清单，不改 audio-separator 自己的文件。
# 用法和 audio-separator 命令行完全一样：python separator_run.py <音频> --model_filename … --model_file_dir …
import hashlib
import json
import os
import sys


def model_dir(argv):
    for i, a in enumerate(argv):
        if a == '--model_file_dir' and i + 1 < len(argv):
            return argv[i + 1]
        if a.startswith('--model_file_dir='):
            return a.split('=', 1)[1]
    return ''


def load_extra(directory):
    path = os.path.join(directory, 'extra-models.json') if directory else ''
    if not path or not os.path.isfile(path):
        return {}
    with open(path, encoding='utf-8') as fh:
        data = json.load(fh)
    return {name: m for name, m in data.items() if isinstance(m, dict) and m.get('filename')}


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def patch(extra):
    from audio_separator.separator import Separator

    orig_list = Separator.list_supported_model_files
    orig_dl = Separator.download_model_files

    def _list(self):
        d = orig_list(self)
        for name, m in extra.items():
            files = [m['filename']] + ([m['config']] if m.get('config') else [])
            d.setdefault('MDXC', {})[name] = {
                'filename': m['filename'], 'scores': {}, 'stems': m.get('stems') or ['vocals', 'other'],
                'target_stem': m.get('target_stem') or 'vocals', 'download_files': files,
            }
        return d

    def _dl(self, model_filename):
        for m in extra.values():
            if model_filename != m['filename']:
                continue
            for f in [m['filename']] + ([m['config']] if m.get('config') else []):
                if not os.path.isfile(os.path.join(self.model_file_dir, f)):
                    raise RuntimeError(f'缺少模型文件 {f}（要放在 {self.model_file_dir}）')
            want = str(m.get('sha256') or '').lower()
            if want and sha256_of(os.path.join(self.model_file_dir, m['filename'])) != want:
                raise RuntimeError(f"{m['filename']} 校验值不对，文件可能坏了")
        return orig_dl(self, model_filename)

    Separator.list_supported_model_files = _list
    Separator.download_model_files = _dl


if __name__ == '__main__':
    extra = load_extra(model_dir(sys.argv[1:]))
    if extra:
        patch(extra)
    from audio_separator.utils.cli import main
    sys.exit(main())
