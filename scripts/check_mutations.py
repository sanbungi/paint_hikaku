#!/usr/bin/env python3
"""Demonstrate that representative regressions fail tests, in disposable copies."""
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MUTATIONS = [
    ("save-invalidation", "source/engine/session.d",
     "if (board.alignMode != mode) saved = false;", "// deliberately omit invalidation"),
    ("stale-peek", "source/engine/session.d",
     "if (generation == peekGeneration) board.peeking = false;", "board.peeking = false;"),
    ("camera-distance", "source/engine/perspective.d",
     "-a.z - c.camDist", "-a.z"),
    ("overlay-color", "source/engine/raster.d",
     "r = 40;\n                g = 170;", "r = 41;\n                g = 170;"),
]


def main():
    logs = ROOT / "test-results/mutations"
    logs.mkdir(parents=True, exist_ok=True)
    for name, relative, before, after in MUTATIONS:
        with tempfile.TemporaryDirectory(prefix="paint-hikaku-mutation-") as directory:
            checkout = Path(directory)
            for folder in ("source", "assets"):
                shutil.copytree(ROOT / folder, checkout / folder)
            for file in ("dub.json", "dub.selections.json"):
                shutil.copy2(ROOT / file, checkout / file)
            target = checkout / relative
            source = target.read_text(encoding="utf-8")
            if before not in source:
                raise RuntimeError("Mutation no longer applies: " + name)
            target.write_text(source.replace(before, after, 1), encoding="utf-8")
            result = subprocess.run(["dub", "test", "--config=unittest"], cwd=checkout,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=900)
            output = result.stdout.decode("utf-8", errors="replace")
            (logs / (name + ".log")).write_text(output, encoding="utf-8")
            if result.returncode == 0 or "AssertError" not in output:
                raise RuntimeError("Mutation escaped detection or did not reach assertions: " + name)
            print("DETECTED", name, flush=True)


if __name__ == "__main__":
    main()
