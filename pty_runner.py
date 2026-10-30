#!/usr/bin/env python3
import sys
import os
import pty
import select
import signal

if len(sys.argv) < 2:
    sys.stderr.write("Usage: pty_runner.py <command> [args...]\n")
    sys.exit(1)

cmd = sys.argv[1]
args = sys.argv[1:]

master, slave = pty.openpty()

pid = os.fork()
if pid == 0:
    os.close(master)
    os.setsid()
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    os.close(slave)
    try:
        os.execvp(cmd, args)
    except Exception as e:
        sys.stderr.write(f"Failed to exec {cmd}: {e}\n")
        sys.exit(127)

os.close(slave)

def sig_handler(sig, frame):
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass
    sys.exit(0)

signal.signal(signal.SIGTERM, sig_handler)
signal.signal(signal.SIGINT, sig_handler)

try:
    while True:
        r, _, _ = select.select([master, sys.stdin.fileno()], [], [])
        if master in r:
            try:
                data = os.read(master, 4096)
                if not data:
                    break
                os.write(sys.stdout.fileno(), data)
                sys.stdout.flush()
            except OSError:
                break
        if sys.stdin.fileno() in r:
            try:
                data = os.read(sys.stdin.fileno(), 1024)
                if not data:
                    break
                os.write(master, data)
            except OSError:
                break
except Exception:
    pass
finally:
    try:
        os.kill(pid, signal.SIGTERM)
        os.waitpid(pid, 0)
    except OSError:
        pass
