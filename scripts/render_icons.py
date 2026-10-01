"""Render the source SVG with Firefox. Optional: PNGs are checked into the repo.

Requires the same Firefox/geckodriver setup as the browser tests; no Python deps.
"""
import base64
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser import Firefox


def render():
    icons = ROOT / "extension" / "icons"
    svg = base64.b64encode((icons / "icon.svg").read_bytes()).decode("ascii")
    with tempfile.TemporaryDirectory(prefix="rmu-icons-") as directory:
        browser = Firefox(Path(directory) / "geckodriver.log")
        try:
            browser.get("about:blank")
            for size in (32, 48, 64, 96, 128):
                result = browser.command("POST", "/execute/async", {"script": """
                    const [svg, size, done] = arguments;
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = canvas.height = size;
                        canvas.getContext('2d').drawImage(img, 0, 0, size, size);
                        done(canvas.toDataURL('image/png').split(',')[1]);
                    };
                    img.onerror = () => done(null);
                    img.src = 'data:image/svg+xml;base64,' + svg;
                """, "args": [svg, size]})
                if not result:
                    raise RuntimeError("Firefox could not render the icon")
                (icons / f"icon-{size}.png").write_bytes(base64.b64decode(result))
        finally:
            browser.close()


if __name__ == "__main__":
    render()
