#!/usr/bin/env python3
"""Double-click me: node checks, then the browser tests, on one local server and one log.

    Starts a local HTTP server for this directory and opens tests.html in the default
    browser. Two phases land in the same timestamped log under experiments/logs/:

      1. node checks - experiments/smoke.js, experiments/thermal.js, experiments/bench.js
         and experiments/harness.js (the tests.html lint). Echoed and written as they run.
      2. browser tests - tests.html runs its checks and the frame-profile matrix, then
         POSTs its log to this server, which appends it to the same file. The page also
         has Save log (same append) and Copy log, and it refuses to send the same log
         twice: the button turns into a "Saved" state, and the server rejects an
         identical section should one arrive anyway (a second tab, a stale page).

    The log is named <VERSION>-tests-<2026-10-25-23-47-16>.log: the version prefix keeps a
    directory of runs searchable (VERSION at the repo root, "dev" when it is missing).

    The server's root redirects to tests.html (the app stays at /index.html). Every
    response is no-store, so a reload never measures a stale script.

    Why a server instead of file://: the handler sends Cross-Origin-Opener-Policy and
    Cross-Origin-Embedder-Policy, so the page is cross-origin isolated and
    performance.now() ticks at microseconds instead of being coarsened to 0.1 ms. The
    frame numbers then mean what they say. Every response is no-store, so a reload never
    measures a stale script. Opening tests.html by double-click still works - Save log
    then downloads the file instead of appending.

    The server's root redirects to tests.html; the app itself stays at /index.html.

    No arguments needed. Optional:
        python3 run_tests.py --no-open        start the server, print the URL
        python3 run_tests.py --port 8010      first port to try (8000, then +1 on EADDRINUSE)
        python3 run_tests.py --host 0.0.0.0   reachable from another device; that also
                                              lets any client that can reach the port
                                              append to the run log, so trust the network
        python3 run_tests.py --skip-node      browser tests only
        python3 run_tests.py --node-only      node checks only, no server
"""
import json
import platform
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / "experiments" / "logs"
VERSION_FILE = ROOT / "VERSION"
NODE_CHECKS = ["experiments/smoke.js", "experiments/thermal.js", "experiments/bench.js", "experiments/harness.js"]
MAX_POST = 2 * 1024 * 1024
LOOPBACK = {"127.0.0.1", "::1"}

STATE = {"log": None, "browser_written": False, "result": "", "last_body": None}
LOG_LOCK = threading.Lock()


def setup():
    """UTF-8 on the way out: the tests print '·', and neither a Windows console opened
    by a double-click nor a redirected file is UTF-8 by default."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            # line buffering: piped output (`| tee`, a sandbox capture) must not sit in a block buffer
            stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)


def version():
    """'0.3.2' from VERSION at the repo root, 'dev' when it is missing or empty."""
    try:
        return VERSION_FILE.read_text(encoding="utf-8").strip() or "dev"
    except OSError:
        return "dev"


def stamp(when=None):
    """'2026-10-25 17:40' - seconds are noise in a capture header."""
    return (when or datetime.now()).strftime("%Y-%m-%d %H:%M")


def file_stamp(when=None):
    """'2026-10-25-17-40-05' - a filename cannot take ':' or ' ', and the seconds keep
    two runs in the same minute apart."""
    return (when or datetime.now()).strftime("%Y-%m-%d-%H-%M-%S")


def platform_line():
    """'linux x86_64' - the OS and CPU type, never a model name."""
    name = {"Linux": "linux", "Darwin": "mac", "Windows": "win"}.get(platform.system(), platform.system().lower())
    arch = {"x86_64": "x86_64", "AMD64": "x86_64", "arm64": "arm64", "aarch64": "arm64"}.get(platform.machine(), platform.machine().lower())
    return name + " " + arch


def node_version():
    try:
        version = subprocess.run(["node", "--version"], capture_output=True, text=True, check=True).stdout.strip()
        return version.lstrip("v") or "unknown"
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def url_host(host):
    return "127.0.0.1" if host in ("0.0.0.0", "") else host


class TestsHandler(SimpleHTTPRequestHandler):
    """Static files with cross-origin isolation, plus POST /__log for the page."""

    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/":
            # carry the version, so a page reached through the bare URL still names its
            # downloads like the run log
            self.send_response(302)
            self.send_header("Location", "/tests.html?version=" + version())
            self.end_headers()
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/__log":
            self.send_error(404, "only POST /__log is accepted")
            return
        if self.server.server_address[0] in LOOPBACK and self.client_address[0] not in LOOPBACK:
            self.send_error(403, "log writes are limited to this machine")
            return
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > MAX_POST:
            self.send_error(413, "log body must be 1 byte to " + str(MAX_POST))
            return
        body = self.rfile.read(length).decode("utf-8", "replace")
        if STATE["log"] is None:
            self.send_error(409, "no run log is open")
            return
        relative = str(STATE["log"].relative_to(ROOT))
        with LOG_LOCK:
            # One section per distinct run: a second tab, a stale page or a double POST
            # must not paste the same numbers in twice.
            duplicate = body == STATE["last_body"]
            if not duplicate:
                STATE["last_body"] = body
                with open(STATE["log"], "a", encoding="utf-8", errors="replace", newline="\n") as handle:
                    handle.write("\n--- browser tests (tests.html) ---\n" + body.rstrip("\n") + "\n")
                STATE["browser_written"] = True
                for line in reversed(body.splitlines()):
                    if line.startswith("RESULT "):
                        STATE["result"] = line
                        break
        payload = json.dumps({"saved": not duplicate, "duplicate": duplicate, "path": relative}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        pass   # the tests are the output; request lines are noise


def start_server(host, port):
    """First free port from `port` up: a stale server from an earlier run must not stop
    a double-click. Returns (server, port)."""
    for candidate in range(port, port + 10):
        try:
            return ThreadingHTTPServer((host, candidate), TestsHandler), candidate
        except OSError:
            continue
    raise SystemExit("ports " + str(port) + "-" + str(port + 9) + " are all busy; stop the other server or pass --port")


def run_node_checks(handle):
    """Echo each node check and append it to the log. A missing node is not fatal:
    the browser phase does not need it."""
    node = shutil.which("node")
    if not node:
        message = "node was not found on PATH - node checks skipped, browser tests still run"
        print(message)
        handle.write(message + "\n")
        return []
    results = []
    for relative in NODE_CHECKS:
        started = time.monotonic()
        print("\n> node " + relative, flush=True)
        handle.write("\n> node " + relative + "\n")
        handle.flush()
        proc = subprocess.Popen([node, relative], cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace", bufsize=1)
        try:
            for line in proc.stdout:
                print(line, end="", flush=True)
                handle.write(line)
            code = proc.wait()
        except KeyboardInterrupt:
            proc.terminate()
            proc.wait()
            code = 130
        elapsed = round(time.monotonic() - started, 1)
        verdict = "ok" if code == 0 else "FAILED exit " + str(code)
        print("  " + verdict + " · " + str(elapsed) + " s", flush=True)
        handle.write("  " + verdict + " · " + str(elapsed) + " s\n")
        handle.flush()
        results.append({"name": relative, "code": code, "seconds": elapsed})
    return results


def parse_args(argv):
    options = {"port": 8000, "host": "127.0.0.1", "open": True, "node": True, "browser": True}
    index = 0
    while index < len(argv):
        argument = argv[index]
        if argument == "--port" and index + 1 < len(argv):
            options["port"] = int(argv[index + 1])
            index += 2
        elif argument == "--host" and index + 1 < len(argv):
            options["host"] = argv[index + 1]
            index += 2
        elif argument == "--no-open":
            options["open"] = False
            index += 1
        elif argument == "--skip-node":
            options["node"] = False
            index += 1
        elif argument == "--node-only":
            options["browser"] = False
            options["node"] = True
            index += 1
        elif argument in ("-h", "--help"):
            print(__doc__)
            raise SystemExit(0)
        else:
            raise SystemExit("unknown argument " + argument + " (see --help)")
    return options


def main(argv):
    setup()
    options = parse_args(argv)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / (version() + "-tests-" + file_stamp() + ".log")
    STATE["log"] = log_path
    header = "hydrogel basin tests " + version() + " · " + stamp() + " · node " + node_version() + " · " + platform_line()
    print(header)
    with open(log_path, "w", encoding="utf-8", errors="replace", newline="\n") as handle:
        handle.write(header + "\n")

    node_results = []
    if options["node"]:
        with open(log_path, "a", encoding="utf-8", errors="replace", newline="\n") as handle:
            node_results = run_node_checks(handle)
        failed = [row for row in node_results if row["code"] != 0]
        if failed:
            print("\n" + str(len(failed)) + " node check(s) failed - the browser phase still runs so one capture"
                  " holds both halves")
        if not options["browser"]:
            return finish(log_path, node_results, expect_browser=False)

    server, port = start_server(options["host"], options["port"])
    host = url_host(options["host"])
    page_url = "http://" + host + ":" + str(port) + "/tests.html?version=" + version()
    print("\nserver: " + "http://" + options["host"] + ":" + str(port) + "/  (isolated: COOP/COEP + no-store)")
    print("tests:  " + page_url)
    print("app:    " + "http://" + host + ":" + str(port) + "/index.html")
    print("log:    " + str(log_path.relative_to(ROOT)))
    print("the page appends its browser section to that log when a run finishes (Save log re-sends it)")
    if options["host"] not in LOOPBACK:
        print("warning: bound to " + options["host"] + " - any client that can reach the port may append to the log")
    if options["open"]:
        threading.Timer(0.4, lambda: open_browser(page_url)).start()
    else:
        print("open the tests URL above")
    print("Ctrl+C stops the server\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping…")
    finally:
        server.server_close()
        return finish(log_path, node_results, expect_browser=True)


def open_browser(url):
    try:
        if not webbrowser.open(url):
            print("could not open a browser automatically - open " + url)
    except OSError as error:
        print("could not open a browser (" + str(error) + ") - open " + url)


def finish(log_path, node_results, expect_browser=True):
    print("\nlog: " + str(log_path))
    for row in node_results:
        prefix = "ok  " if row["code"] == 0 else "FAIL"
        print(prefix + " " + row["name"] + " · " + str(row["seconds"]) + " s")
    if STATE["result"]:
        print(STATE["result"])
    elif STATE["browser_written"]:
        print("browser log saved without a RESULT line - the run was probably stopped early")
    else:
        print("no browser results were saved; open the tests page and let a run finish (or press Save log)")
    node_ok = all(row["code"] == 0 for row in node_results)
    if not expect_browser:
        return 0 if node_ok else 1
    return 0 if node_ok and STATE["result"].startswith("RESULT pass") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
