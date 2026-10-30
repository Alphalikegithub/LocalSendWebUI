#!/usr/bin/env python3
import sys
import os
import pty
import select
import signal
import fcntl
import termios
import struct

if len(sys.argv) < 2:
    sys.stderr.write("Usage: pty_runner.py <command> [args...]\n")
    sys.exit(1)

cmd = sys.argv[1]
args = sys.argv[1:]

# Use pty.fork() which properly handles:
# 1. setsid()
# 2. Allocating slave PTY and setting it as controlling terminal (/dev/tty)
# 3. Duping slave to stdin (0), stdout (1), stderr (2)
# 4. Closing slave in child
pid, master = pty.fork()

if pid == 0:
    try:
        os.execvp(cmd, args)
    except Exception as e:
        sys.stderr.write(f"Failed to exec {cmd}: {e}\n")
        sys.exit(127)

# In Parent process: set standard 80x25 window dimensions so TUI libraries (crossterm/dialoguer) work properly
try:
    winsize = struct.pack("HHHH", 25, 80, 0, 0)
    fcntl.ioctl(master, termios.TIOCSWINSZ, winsize)
except Exception:
    pass

def cleanup_and_exit(sig=None, frame=None):
    try:
        # Kill the child process and its process group
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except OSError:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
    try:
        os.close(master)
    except OSError:
        pass
    sys.exit(0)

signal.signal(signal.SIGTERM, cleanup_and_exit)
signal.signal(signal.SIGINT, cleanup_and_exit)
signal.signal(signal.SIGHUP, cleanup_and_exit)

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
                # Forward input to PTY master
                # If single char or newline, ensure both raw char and CR are passed cleanly
                os.write(master, data)
            except OSError:
                break
except Exception:
    pass
finally:
    cleanup_and_exit()
