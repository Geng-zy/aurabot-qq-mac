"""下载一个文件：断点续传、走系统代理（urllib 会读 macOS 的系统代理设置）、卡住或太慢就换下一个地址接着下。

用法：python fetch_file.py [--sha256 <校验值>] <保存路径> <地址1> [地址2 ...]
成功退出码 0；每次进度打印一行 "progress <已下载> <总大小>"。
给了 --sha256 就在下完后核对，对不上（镜像传了坏文件）就删掉、换下一个地址从头下。
"""
import hashlib
import os
import re
import socket
import sys
import time
import urllib.request

STALL = 30  # 秒：这么久没收到数据就算卡住
ROUNDS = 6  # 所有地址轮流试几轮
SLOW_BPS = 150 * 1024  # 低于这个速度……
SLOW_SECS = 45  # ……持续这么久，就换下一个地址（已下载的部分保留）


class TooSlow(Exception):
    pass


def total_size(opener, url):
    # HEAD 只是用来显示总大小；服务器不支持 HEAD（405/501/网络错误）时不能因此放弃 GET。
    req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'aurabot'})
    try:
        with opener.open(req, timeout=STALL) as r:
            return int(r.headers.get('Content-Length') or 0)
    except Exception:
        return 0


def fetch(opener, url, part, want, can_switch):
    have = os.path.getsize(part) if os.path.exists(part) else 0
    source_file = part + '.source'
    # 分片必须来自同一个镜像/对象；换源时不能把旧前缀拼到新响应上。
    etag_file = part + '.etag'
    try: old_etag = open(etag_file, encoding='utf-8').read().strip()
    except Exception: old_etag = ''
    if have:
        try:
            old_source = open(source_file, encoding='utf-8').read()
        except Exception:
            old_source = ''
        # 没有可信 ETag 时不能把旧前缀续到新响应上，直接全量。
        if old_source != url or not old_etag:
            os.remove(part)
            for clean in (source_file, etag_file):
                try: os.remove(clean)
                except OSError: pass
            have = 0
    if want and have >= want:
        # 旧分片达到或超过目标，无法确认内容；统一从头重新下载。
        os.remove(part)
        have = 0
    headers = {'User-Agent': 'aurabot'}
    if have:
        headers['Range'] = 'bytes=%d-' % have
        if old_etag: headers['If-Range'] = old_etag
    req = urllib.request.Request(url, headers=headers)
    with opener.open(req, timeout=STALL) as r:
        if r.status not in (200, 206):
            raise IOError('HTTP %d：不是可下载的 200/206 响应' % r.status)
        # HEAD 不可用时，GET 自己的 Content-Length / Content-Range 也能判断是否截断。
        # 服务器忽略 Range 返回 200：这是完整文件，必须覆盖旧分片，不能把旧长度加进总长。
        old_have = have
        mode = 'ab' if have and r.status == 206 else 'wb'
        if mode == 'wb':
            have = 0
        header_len = int(r.headers.get('Content-Length') or 0)
        range_len = 0
        if r.status == 206:
            cr = r.headers.get('Content-Range') or ''
            m = re.match(r'bytes\s+(\d+)-(\d+)/(\d+)', cr.strip(), re.I)
            if not m:
                raise IOError('206 响应缺少有效的 Content-Range')
            new_etag = r.headers.get('ETag')
            if old_etag and new_etag and new_etag != old_etag:
                os.remove(part)
                try: os.remove(part + '.etag')
                except OSError: pass
                raise IOError('续传对象的 ETag 已变化')
            start, end, total = map(int, m.groups())
            if start != have or end < start:
                raise IOError('续传区间不对：请求 %d，返回 %d-%d' % (have, start, end))
            if header_len and header_len != end - start + 1:
                raise IOError('续传区间长度不对：头 %d 字节，区间 %d-%d' % (header_len, start, end))
            want = total
            range_len = end - start + 1
        elif header_len:
            want = have + header_len
        # 服务器不支持续传就从头来
        new_etag = ''
        try:
            with open(source_file, 'w', encoding='utf-8') as sf: sf.write(url)
            new_etag = r.headers.get('ETag') or ''
            if new_etag:
                with open(part + '.etag', 'w', encoding='utf-8') as ef: ef.write(new_etag)
        except OSError: pass
        committed = have
        write_part = part
        if mode == 'wb' and old_have > 0:
            # 完整 200 先写临时文件，断流时保留旧分片/ETag 供下次续传。
            write_part = part + '.full'
            try: os.remove(write_part)
            except OSError: pass
        last_print = 0
        received = 0
        window_start, window_bytes = time.time(), 0
        try:
            with open(write_part, mode) as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
                    have += len(chunk)
                    received += len(chunk)
                    window_bytes += len(chunk)
                    now = time.time()
                    if now - last_print > 2:
                        print('progress', have, want, flush=True)
                        last_print = now
                    if now - window_start >= SLOW_SECS:
                        if can_switch and window_bytes / (now - window_start) < SLOW_BPS:
                            raise TooSlow('%.0f KB/s' % (window_bytes / (now - window_start) / 1024))
                        window_start, window_bytes = now, 0
        except Exception:
            if write_part != part:
                try: os.remove(write_part)
                except OSError: pass
            else:
                try: os.truncate(part, committed)
                except OSError: pass
            raise
    if range_len and received != range_len:
        try: os.truncate(part, committed)
        except OSError: pass
        raise IOError('206 正文长度不对：收到 %d，声明 %d' % (received, range_len))
    if want and have != want:
        if write_part != part:
            try: os.remove(write_part)
            except OSError: pass
        raise IOError('下载长度不对：%d/%d 字节' % (have, want))
    if not new_etag:
        try: os.remove(part + '.etag')
        except OSError: pass
    if write_part != part:
        os.replace(write_part, part)
    return True


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 22), b''):
            h.update(block)
    return h.hexdigest()


def main():
    args = sys.argv[1:]
    expect = ''
    if args[:1] == ['--sha256']:
        expect, args = args[1].lower(), args[2:]
    dest, urls = args[0], args[1:]
    socket.setdefaulttimeout(STALL)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler(urllib.request.getproxies()))
    part_base = dest + '.download'
    os.makedirs(os.path.dirname(dest) or '.', exist_ok=True)
    last_err = None
    for rnd in range(ROUNDS):
        for url in urls:
            part = part_base + '.' + hashlib.sha1(url.encode('utf-8')).hexdigest()[:10]
            source_file = part + '.source'
            try:
                want = total_size(opener, url)
                # 最后一轮不再嫌慢，慢也下完
                if fetch(opener, url, part, want, can_switch=len(urls) > 1 and rnd < ROUNDS - 1):
                    if expect:
                        got = sha256_of(part)
                        if got != expect:
                            os.remove(part)
                            for clean in (source_file, part + '.etag'):
                                try: os.remove(clean)
                                except OSError: pass
                            raise ValueError('校验对不上（%s…），这个源的文件不对' % got[:12])
                    if os.path.exists(dest):
                        os.remove(dest)
                    os.replace(part, dest)
                    for clean in (source_file, part + '.etag'):
                        try: os.remove(clean)
                        except OSError: pass
                    print('done', os.path.getsize(dest), flush=True)
                    return 0
            except Exception as e:  # 断了、卡住、太慢、地址不行：换下一个地址，已下载的部分保留
                last_err = e
                print('retry', url.split('/')[2], type(e).__name__, str(e)[:120], flush=True)
    print('failed', last_err, flush=True)
    return 1


if __name__ == '__main__':
    sys.exit(main())
