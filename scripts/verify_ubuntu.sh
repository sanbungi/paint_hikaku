#!/usr/bin/env bash
# Run inside a disposable Ubuntu container with /source read-only and /out writable.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
trap 'if [ -d /build/test-results ]; then cp -a /build/test-results /out/; fi' EXIT
apt-get update -qq > /out/environment.log 2>&1
apt-get install -y -qq curl ca-certificates xz-utils gcc libc6-dev python3 \
    libsdl2-dev libsdl2-image-dev libfreetype6-dev libfontconfig1-dev \
    libgl1-mesa-dev fonts-noto-cjk xvfb xauth desktop-file-utils file git >> /out/environment.log 2>&1
mkdir -p /build
cp -a /source/source /source/assets /source/scripts /source/packaging \
    /source/dub.json /source/dub.selections.json /source/README.md /build/
cd /build
curl -fsSL https://downloads.dlang.org/releases/2.x/2.112.0/dmd.2.112.0.linux.tar.xz -o /tmp/dmd.tar.xz
tar -xJf /tmp/dmd.tar.xz -C /opt
export PATH="/opt/dmd2/linux/bin64:$PATH"
python3 scripts/run_checks.py --name unit --timeout 900 --expect 'PASS HISTORY-PATHS' --expect 'PASS COMPARE-PIXELS' -- dub test --config=unittest
dub build --config=gui-test
python3 scripts/run_checks.py --name gui --expect 'PASS GUI-EVENTS' --expect 'PASS GUI-IMAGES' --expect 'PASS GUI-LAYOUT' --expect 'PASS GUI-SMOKE' -- xvfb-run -a ./paint_hikaku
dub build --config=application --build=release
python3 scripts/package.py linux --version ubuntu-validation
python3 scripts/run_checks.py --name appimage --expect 'PASS GUI-SMOKE' -- xvfb-run -a dist/paint_hikaku-ubuntu-validation-x86_64.AppImage --appimage-extract-and-run --smoke-test
cp dist/*.AppImage /out/
cp -a test-results /out/
