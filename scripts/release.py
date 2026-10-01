"""Prepare upload and source archives plus SHA-256 checksums after verification."""
import hashlib
import json

from build import ROOT, EXTENSION_FILES, build, write_archive


def release():
    xpi = build()
    version = json.loads((ROOT / "extension/manifest.json").read_bytes())["version"]
    names = ["LICENSE", "README.md", "PRIVACY.md", "CHANGELOG.md",
             "package.json", "package-lock.json", ".gitignore", ".nvmrc"]
    names.extend("extension/" + name for name in EXTENSION_FILES)
    for folder, suffixes in (("scripts", {".py"}), ("tests", {".py", ".html", ".js", ".mjs"}),
                             ("docs", {".md"}), (".github", {".yml"})):
        names.extend(path.relative_to(ROOT).as_posix() for path in (ROOT / folder).rglob("*")
                     if path.is_file() and path.suffix in suffixes)
    source = write_archive(ROOT / "dist" / f"reddit-mobile-unblocker-{version}-source.zip",
                           {name: (ROOT / name).read_bytes() for name in names})
    checksums = ROOT / "dist" / "SHA256SUMS"
    checksums.write_text("".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
                                 for path in (xpi, source)), encoding="utf-8")
    for path in (xpi, source, checksums):
        print(path)


if __name__ == "__main__":
    release()
