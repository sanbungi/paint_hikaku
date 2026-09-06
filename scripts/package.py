#!/usr/bin/env python3
"""Stage portable packages; all downloaded upstream versions are explicit."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
import hashlib

ROOT = Path(__file__).resolve().parents[1]
FONT_BASE = "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans"


def download(url, destination, sha256=None):
    destination.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, destination)
    if sha256 and hashlib.sha256(destination.read_bytes()).hexdigest() != sha256:
        raise RuntimeError("Download checksum mismatch: " + url)


def resources(directory):
    download(FONT_BASE + "/OTF/Japanese/NotoSansCJKjp-Regular.otf",
             directory / "fonts/NotoSansCJKjp-Regular.otf")
    download(FONT_BASE.rsplit("/", 1)[0] + "/LICENSE", directory / "licenses/Noto-OFL.txt")
    shutil.copy2(ROOT / "README.md", directory / "README.md")
    # Include dependency notices from the exact Dub package sources.
    import json
    locked = json.loads((ROOT / "dub.selections.json").read_text())["versions"]
    packages = subprocess.check_output(["dub", "list"], text=True)
    for line in packages.splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        if parts[0] not in locked or parts[1].rstrip(":") != locked[parts[0]]:
            continue
        path = Path(parts[-1])
        if not path.is_dir():
            continue
        for notice in path.iterdir():
            if notice.is_file() and notice.name.lower().startswith(("license", "copying")):
                shutil.copy2(notice, directory / "licenses" / (parts[0] + "-" + notice.name))


def stage_windows(directory):
    directory.mkdir(parents=True)
    shutil.copy2(ROOT / "paint_hikaku.exe", directory)
    # dlangui's SDL configuration copies its pinned x64 FreeType runtime here.
    for dll in ROOT.glob("*.dll"):
        shutil.copy2(dll, directory)
    if not (directory / "libfreetype-6.dll").exists():
        raise RuntimeError("Dub did not supply the x64 FreeType runtime")
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary) / "sdl.zip"
        download("https://github.com/libsdl-org/SDL/releases/download/release-2.30.11/SDL2-2.30.11-win32-x64.zip", archive)
        with zipfile.ZipFile(archive) as bundle:
            for entry in bundle.infolist():
                name = Path(entry.filename).name
                if name == "SDL2.dll":
                    (directory / name).write_bytes(bundle.read(entry))
    download("https://raw.githubusercontent.com/libsdl-org/SDL/release-2.30.11/LICENSE.txt",
             directory / "licenses/SDL2.txt")
    download("https://raw.githubusercontent.com/freetype/freetype/VER-2-10-4/docs/FTL.TXT",
             directory / "licenses/FreeType-FTL.txt")
    resources(directory)


def stage_linux(directory):
    binary_dir = directory / "usr/bin"
    lib_dir = directory / "usr/lib"
    binary_dir.mkdir(parents=True)
    lib_dir.mkdir(parents=True)
    shutil.copy2(ROOT / "paint_hikaku", binary_dir)
    resources(binary_dir)
    shutil.copy2(ROOT / "packaging/AppRun", directory)
    (directory / "AppRun").chmod(0o755)
    for name in ("paint-hikaku.desktop", "paint-hikaku.svg"):
        shutil.copy2(ROOT / "packaging" / name, directory)
    # SDL and FreeType are dlopen dependencies and do not appear in executable ldd output.
    cache = subprocess.check_output(["ldconfig", "-p"], text=True)
    pending = [binary_dir / "paint_hikaku"]
    for soname in ("libSDL2-2.0.so.0", "libfreetype.so.6", "libfontconfig.so.1"):
        match = re.search(r"\s" + re.escape(soname) + r" .*x86-64.*=> (\S+)", cache)
        if not match:
            raise RuntimeError("Missing runtime " + soname)
        pending.append(Path(match[1]))
    excluded = re.compile(r"^(ld-linux|lib(c|m|pthread|dl|rt|resolv|util)\.so|lib(GL|EGL|GLX|GLdispatch|OpenGL|drm|gbm))")
    seen = set()
    while pending:
        library = pending.pop()
        if library.name in seen or excluded.match(library.name):
            continue
        seen.add(library.name)
        if library.name != "paint_hikaku":
            shutil.copy2(library, lib_dir / library.name)
            owner = subprocess.run(["dpkg-query", "-S", str(library)], capture_output=True, text=True)
            if owner.returncode == 0:
                package = owner.stdout.split(": ")[0]
                notice = Path("/usr/share/doc") / package.split(":")[0] / "copyright"
                if notice.exists():
                    shutil.copy2(notice, binary_dir / "licenses" / (package.replace(":", "-") + ".txt"))
        dependencies = subprocess.check_output(["ldd", str(library)], text=True)
        if "not found" in dependencies:
            raise RuntimeError(dependencies)
        pending.extend(Path(p) for p in re.findall(r"=> (/\S+)", dependencies))
    # BindBC also searches development-style names.
    (lib_dir / "libSDL2.so").symlink_to("libSDL2-2.0.so.0")
    (lib_dir / "libfreetype.so").symlink_to("libfreetype.so.6")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=["windows", "linux"])
    parser.add_argument("--version", required=True)
    parser.add_argument("--stage-only", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9._-]+", args.version):
        parser.error("Invalid version")
    output = ROOT / "dist"
    output.mkdir(exist_ok=True)
    if args.kind == "windows":
        directory = output / ("paint_hikaku-" + args.version + "-windows-x86_64")
        stage_windows(directory)
        if not args.stage_only:
            shutil.make_archive(str(directory), "zip", directory.parent, directory.name)
    else:
        directory = output / ("paint_hikaku-" + args.version + ".AppDir")
        stage_linux(directory)
        if not args.stage_only:
            # Pin both the packaging tool and the separately embedded runtime.
            with tempfile.TemporaryDirectory() as temporary:
                tool = Path(temporary) / "appimagetool"
                download("https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage", tool,
                         "ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0")
                runtime = Path(temporary) / "runtime"
                download("https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64", runtime,
                         "2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d")
                tool.chmod(0o755)
                subprocess.run([str(tool), "--appimage-extract"], cwd=temporary, check=True, stdout=subprocess.DEVNULL)
                subprocess.run([str(Path(temporary) / "squashfs-root/AppRun"), "--runtime-file", str(runtime), str(directory),
                                str(output / ("paint_hikaku-" + args.version + "-x86_64.AppImage"))],
                               env=dict(os.environ, ARCH="x86_64", VERSION=args.version), check=True)


if __name__ == "__main__":
    main()
