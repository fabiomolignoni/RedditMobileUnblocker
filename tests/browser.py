"""Tiny standard-library WebDriver client for real Firefox on desktop or Android."""
import base64
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"


def executable(variable, name, pattern):
    result = os.environ.get(variable) or shutil.which(name)
    if not result:
        candidates = sorted(Path.home().glob(pattern))
        result = str(candidates[-1]) if candidates else None
    if not result:
        raise RuntimeError(f"Install {name} or set {variable}; browser tests are not skipped.")
    return result


class Firefox:
    """A WebDriver session. Pass `android` options to drive Firefox on a device via adb."""

    def __init__(self, log_path, extra_prefs=None, headless=True, android=None):
        self.session = None
        self.process = None
        self.log = open(log_path, "w")
        driver = executable("GECKODRIVER", "geckodriver", ".cache/selenium/geckodriver/linux64/*/geckodriver")
        prefs = {
            "browser.shell.checkDefaultBrowser": False,
            "browser.startup.homepage_override.mstone": "ignore",
            "datareporting.policy.dataSubmissionEnabled": False,
            "toolkit.telemetry.reportingpolicy.firstRun": False,
            "dom.webnotifications.enabled": False,
            **(extra_prefs or {}),
        }
        if android:
            options = {"androidPackage": android["package"], "prefs": prefs}
            if android.get("serial"):
                options["androidDeviceSerial"] = android["serial"]
        else:
            firefox = executable("FIREFOX_BINARY", "firefox", ".cache/selenium/firefox/linux64/*/firefox")
            options = {"binary": firefox, "args": ["-headless"] if headless else [], "prefs": prefs}
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        self.base = f"http://127.0.0.1:{port}"
        self.opener = build_opener(ProxyHandler({}))
        env = {**os.environ, "MOZ_HEADLESS": "1"} if headless and not android else dict(os.environ)
        try:
            self.process = subprocess.Popen(
                [driver, "--host", "127.0.0.1", "--port", str(port)],
                stdout=self.log, stderr=subprocess.STDOUT, env=env,
            )
            deadline = time.monotonic() + 15
            while True:
                try:
                    self.request("GET", "/status")
                    break
                except (URLError, ConnectionError):
                    if time.monotonic() > deadline:
                        raise RuntimeError(f"geckodriver did not start; see {log_path}")
                    time.sleep(0.1)
            result = self.request("POST", "/session", {"capabilities": {"alwaysMatch": {
                "browserName": "firefox",
                "moz:firefoxOptions": options,
            }}})
            self.session = result["sessionId"]
            self.version = result["capabilities"]["browserVersion"]
        except Exception:
            self.close()
            raise

    def request(self, method, path, data=None):
        body = json.dumps(data).encode() if data is not None else None
        req = Request(self.base + path, body, {"Content-Type": "application/json"}, method=method)
        try:
            with self.opener.open(req, timeout=120) as response:
                result = json.load(response)
        except HTTPError as error:
            raise RuntimeError(error.read().decode()) from error
        return result.get("value")

    def command(self, method, path, data=None):
        return self.request(method, f"/session/{self.session}{path}", data)

    def install(self, path):
        # A base64 payload also works for a device that cannot read the host's files.
        addon = base64.b64encode(Path(path).read_bytes()).decode("ascii")
        return self.command("POST", "/moz/addon/install", {"addon": addon, "temporary": True})

    def get(self, url):
        self.command("POST", "/url", {"url": url})

    def js(self, script, *args):
        return self.command("POST", "/execute/sync", {"script": script, "args": list(args)})

    def js_async(self, script, *args):
        return self.command("POST", "/execute/async", {"script": script, "args": list(args)})

    def wait(self, expression, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = self.js("return " + expression)
            if result:
                return result
            time.sleep(0.05)
        raise AssertionError(f"Timed out: {expression}")

    def click(self, selector):
        element = self.command("POST", "/element", {"using": "css selector", "value": selector})
        self.command("POST", f"/element/{element[ELEMENT_KEY]}/click", {})

    def actions(self, *sources):
        self.command("POST", "/actions", {"actions": list(sources)})
        self.command("DELETE", "/actions")

    def screenshot(self, path):
        Path(path).write_bytes(base64.b64decode(self.command("GET", "/screenshot")))

    def close(self):
        try:
            if self.session:
                self.command("DELETE", "")
        finally:
            if self.process:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
            self.log.close()
