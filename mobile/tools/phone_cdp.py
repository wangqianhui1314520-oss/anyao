"""USB WebView CDP helpers for the installed AnYao QA integration tests."""
import base64
import json
import os
import pathlib
import random
import socket
import struct
import subprocess
import sys
import time
import urllib.request
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[4] / "tools/android-build-env"
PKG = "com.anyao.app.qa"
PORT = 9222


# ---------------------------------------------------------------- adb ----------------------------------------------------------------
def adb(*args, timeout=120):
    exe = str(ROOT / "sdk" / "platform-tools" / "adb.exe")
    p = subprocess.run([exe, *args], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=timeout)
    return (p.stdout or ""), (p.stderr or ""), p.returncode


def http_local(path, timeout=20):
    """访问本机 CDP HTTP 端点。必须绕开沙箱代理，否则会被回 502。"""
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", headers={"Host": "localhost"})
    return json.loads(op.open(req, timeout=timeout).read().decode("utf-8"))


# ------------------------------------------------------- 最小 WebSocket 客户端 -------------------------------------------------------
class WS:
    def __init__(self, url, timeout=30):
        # ws://127.0.0.1:9222/devtools/page/XXXX
        assert url.startswith("ws://")
        rest = url[len("ws://"):]
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=timeout)
        key = base64.b64encode(bytes(random.getrandbits(8) for _ in range(16))).decode()
        handshake = (
            f"GET /{path} HTTP/1.1\r\n"
            f"Host: {hostport}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(handshake.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("WebSocket 握手失败：连接被关闭")
            buf += chunk
        head, self.buf = buf.split(b"\r\n\r\n", 1)
        if b"101" not in head.split(b"\r\n", 1)[0]:
            raise RuntimeError("WebSocket 握手失败：" + head.decode("utf-8", "replace")[:200])
        self.sock.settimeout(timeout)

    @staticmethod
    def _mask(payload):
        key = bytes(random.getrandbits(8) for _ in range(4))
        masked = bytes(b ^ key[i % 4] for i, b in enumerate(payload))
        return key + masked

    def send(self, text):
        data = text.encode("utf-8")
        header = bytearray([0x81])
        n = len(data)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        self.sock.sendall(bytes(header) + self._mask(data))

    def _recv_exact(self, n):
        out = b""
        if self.buf:
            take = self.buf[:n]
            self.buf = self.buf[n:]
            out += take
            n -= len(take)
        while n > 0:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("WebSocket 连接中断")
            if n >= len(chunk):
                out += chunk
                n -= len(chunk)
            else:
                out += chunk[:n]
                self.buf = chunk[n:]
                n = 0
        return out

    def recv(self):
        """收一条完整文本消息（不处理分片，CDP 消息量大时会分片，做简单续接）。"""
        payload = b""
        fin = False
        while not fin:
            b0, b1 = self._recv_exact(2)
            fin = (b0 & 0x80) != 0
            opcode = b0 & 0x0F
            length = b1 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._recv_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._recv_exact(8))[0]
            masked = (b1 & 0x80) != 0
            key = self._recv_exact(4) if masked else None
            data = self._recv_exact(length)
            if key:
                data = bytes(b ^ key[i % 4] for i, b in enumerate(data))
            if opcode == 0x1:
                payload += data
            elif opcode == 0x8:
                raise RuntimeError("服务端关闭 WebSocket")
            elif opcode == 0x9:  # ping -> pong
                self.send_raw_frame(0xA, data)
        return payload.decode("utf-8", "replace")

    def send_raw_frame(self, opcode, data):
        header = bytearray([0x80 | opcode])
        n = len(data)
        if n < 126:
            header.append(n)
        elif n < 65536:
            header.append(126)
            header += struct.pack(">H", n)
        else:
            header.append(127)
            header += struct.pack(">Q", n)
        self.sock.sendall(bytes(header) + data)


class DevTools:
    def __init__(self, ws_url):
        self.ws = WS(ws_url)
        self.mid = 0

    def call(self, method, params=None, timeout=None):
        self.mid += 1
        mid = self.mid
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + (timeout or 60)
        while time.time() < deadline:
            remaining = max(1.0, deadline - time.time())
            self.ws.sock.settimeout(min(remaining, 5.0))
            try:
                msg = json.loads(self.ws.recv())
            except socket.timeout:
                continue
            if msg.get("id") == mid:
                return msg
        raise TimeoutError(f"CDP {method} 超时")

    def evaluate(self, expr, await_promise=True, timeout=None):
        r = self.call("Runtime.evaluate", {
            "expression": expr,
            "awaitPromise": await_promise,
            "returnByValue": True,
            "userGesture": True,
        }, timeout=timeout)
        if "error" in r:
            raise RuntimeError("CDP evaluation failed: " + json.dumps(r["error"], ensure_ascii=False))
        res = r.get("result", {}).get("result", {})
        if "exceptionDetails" in r.get("result", {}):
            ex = r["result"]["exceptionDetails"]
            return "__EXCEPTION__ " + json.dumps(ex.get("exception", {}).get("description", str(ex)))[:800]
        return res.get("value")


# ---------------------------------------------------------------- main ----------------------------------------------------------------

OUT=pathlib.Path(__file__).resolve().parents[4]/'evidence/mobile-current-20261016'
def connect():
    pids=adb('shell','pidof',PKG)[0].split()
    if not pids:raise RuntimeError('Open 安药验证 before running the phone tests')
    adb('forward',f'tcp:{PORT}',f'localabstract:webview_devtools_remote_{pids[0]}')
    pages=http_local('/json/list')
    page=next(p for p in pages if p['type']=='page')
    parts=urllib.parse.urlsplit(page['webSocketDebuggerUrl'])
    return DevTools(urllib.parse.urlunsplit(('ws',f'127.0.0.1:{PORT}',parts.path,parts.query,'')))
