"""Build a deterministic unsigned XPI using only Python's standard library."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
EXTENSION_FILES = (
    "manifest.json", "background.js", "content/unblock.js", "content/unblock.css", "content/status.js",
    "popup/index.html", "popup/popup.css", "popup/popup.js",
    "_locales/en/messages.json", "icons/icon.svg",
    *(f"icons/icon-{size}.png" for size in (32, 48, 64, 96, 128)),
)


def write_archive(destination, files):
    """Only explicitly selected files enter an archive; exclude machine metadata."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return destination


def build(destination=None, test_origin=None):
    source = ROOT / "extension"
    files = {name: (source / name).read_bytes() for name in EXTENSION_FILES}
    files["LICENSE"] = (ROOT / "LICENSE").read_bytes()
    manifest = json.loads(files["manifest.json"])
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if manifest["version"] != package["version"]:
        raise ValueError("manifest.json and package.json versions must match")
    if test_origin:
        for script in manifest["content_scripts"]:
            script["matches"].append(test_origin + "/*")
        files["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    destination = destination or ROOT / "dist" / f"reddit-mobile-unblocker-{manifest['version']}-unsigned.xpi"
    return write_archive(destination, files)


if __name__ == "__main__":
    print(build())
