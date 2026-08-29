#!/usr/bin/env python3
import errno
import functools
import sys
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = '127.0.0.1'
PORT = 7456
ROOT = Path(__file__).resolve().parent.parent
WEB_ROOT = ROOT / 'build' / 'web-mobile'
URL = f'http://{HOST}:{PORT}/'
GAME_MARKER = b'wechat-tactical-fps'


def existing_game_server():
    try:
        with urllib.request.urlopen(URL, timeout=2) as response:
            return response.status == 200 and GAME_MARKER in response.read(16384)
    except Exception:
        return False


class GameHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, format, *args):
        sys.stdout.write(f'[local-game] {self.address_string()} {format % args}\n')
        sys.stdout.flush()


def main():
    index = WEB_ROOT / 'index.html'
    if not index.is_file():
        print(f'无法启动：未找到网页构建 {index}')
        print('请先在 Cocos Creator 中构建 Web Mobile。')
        return 1

    if existing_game_server():
        print(f'游戏本机服务已经运行：{URL}')
        return 0

    handler = functools.partial(GameHandler, directory=str(WEB_ROOT))
    try:
        server = ThreadingHTTPServer((HOST, PORT), handler)
    except OSError as error:
        if error.errno == errno.EADDRINUSE:
            print(f'无法启动：端口 {PORT} 已被其他程序占用，并且该程序不是当前游戏服务。')
            print(f'请先关闭占用端口 {PORT} 的程序，再重新双击启动脚本。')
            return 2
        raise

    print(f'游戏本机服务已启动：{URL}')
    print('保持此窗口打开，在微信开发者工具中点击“编译”。')
    print('按 Control+C 可以停止服务。')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n游戏本机服务已停止。')
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
