#!/usr/bin/env python3
"""
LORE 配信用の簡易サーバー（SPAフォールバック付き）。

`python -m http.server` の代わりにこれを使う:
    python3 serve.py            # 0.0.0.0:8000 で配信
    python3 serve.py 8080       # ポート指定

挙動:
  - 実ファイル（support.js / *.png / manifest など）があればそれを返す
  - 無いパス（/ , /plan , /profile , /s/<token> など）は LORE.dc.html を返す
    → これでトップも、SPAのディープリンク／リロードも 404 にならない
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ENTRY = "LORE.dc.html"  # アプリの入口


class SPAHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def do_GET(self):
        # クエリ等を除いたパス
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        rel = path.lstrip("/")
        full = os.path.join(HERE, rel)
        # ルート、または存在しないパス → アプリ入口を返す（SPAフォールバック）
        if rel == "" or not os.path.isfile(full):
            self.path = "/" + ENTRY
        return super().do_GET()

    def end_headers(self):
        # デモ中はキャッシュ無効（更新が即反映される）
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    httpd = ThreadingHTTPServer(("0.0.0.0", port), SPAHandler)
    print(f"LORE serving {HERE}")
    print(f"  http://localhost:{port}/  (SPAフォールバック有効 / 入口: {ENTRY})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
