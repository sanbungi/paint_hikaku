#!/usr/bin/env python3
"""Run a test command in isolated storage, with timeout and durable logs."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile
import signal


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--expect", action="append", default=[])
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    output = Path("test-results").resolve()
    output.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="paint-hikaku-check-") as storage:
        env = dict(os.environ, PAINT_HIKAKU_DATA_DIR=storage,
                   PAINT_HIKAKU_TEST_OUTPUT=str(output / args.name))
        options = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
                   if os.name == "nt" else {"start_new_session": True})
        with subprocess.Popen(command, env=env, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, **options) as process:
            try:
                stdout, _ = process.communicate(timeout=args.timeout)
                log = stdout.decode("utf-8", errors="replace")
                code = process.returncode
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    os.killpg(process.pid, signal.SIGKILL)
                stdout, _ = process.communicate()
                log = stdout.decode("utf-8", errors="replace") + "\nTIMEOUT\n"
                code = 1
        (output / (args.name + ".log")).write_text(log, encoding="utf-8")
        if code:
            print(log[-16000:])
        else:
            print("\n".join(line for line in log.splitlines()
                            if line.startswith(("RUN ", "PASS ")) or "passed unittests" in line))
        missing = [marker for marker in args.expect if marker not in log]
        if missing:
            print("Missing required test markers:", missing)
        raise SystemExit(code or bool(missing))


if __name__ == "__main__":
    main()
