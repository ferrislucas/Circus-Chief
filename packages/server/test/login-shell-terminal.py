#!/usr/bin/env python3
"""Exercise startup cancellation in a real controlling terminal (POSIX)."""
import os, pty, select, signal, socket, subprocess, sys, tempfile, time

with tempfile.TemporaryDirectory() as directory:
    mode = sys.argv[1] if len(sys.argv) > 1 else 'SIGINT'
    shell = os.path.join(directory, 'shell')
    marker = os.path.join(directory, 'pids')
    with open(shell, 'w') as f:
        f.write("#!/bin/sh\ntrap '' TERM\nsleep 30 &\necho $$ $! > '" + marker + "'\nwait\n")
    os.chmod(shell, 0o755)
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    sock.close()
    sentinel = subprocess.Popen(['sleep', '30'])
    pid, fd = pty.fork()
    if pid == 0:
        os.environ.update(HOME=directory, DB_PATH=directory + '/test.db', SHELL=shell, PORT=str(port), CIRCUS_CHIEF_NO_LOGIN_SHELL='0')
        os.execvp('node', ['node', 'src/index.js'])
    output = b''
    probe_pids = []
    status = None
    reaped = False
    try:
        deadline = time.monotonic() + 25
        while not os.path.exists(marker) and time.monotonic() < deadline:
            if select.select([fd], [], [], 0.05)[0]:
                output += os.read(fd, 65536)
        assert os.path.exists(marker), 'probe did not start: ' + output.decode(errors='replace')[-3000:]
        probe_pids = [int(n) for n in open(marker).read().split()]
        start = time.monotonic()
        if mode == 'SIGTERM': os.kill(pid, signal.SIGTERM)
        else: os.write(fd, b'\x03')
        deadline = start + 7  # six-second shutdown bound plus one second scheduling tolerance
        while time.monotonic() < deadline:
            if select.select([fd], [], [], 0.05)[0]:
                try: output += os.read(fd, 65536)
                except OSError: pass
            finished, status = os.waitpid(pid, os.WNOHANG)
            if finished:
                reaped = True
                break
        else: raise AssertionError('server did not exit within shutdown bound')
        assert (mode + ' received, shutting down gracefully').encode() in output, output.decode(errors='replace')[-3000:]
        assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, str(status)
        for child in probe_pids:
            try: os.kill(child, 0)
            except ProcessLookupError: continue
            raise AssertionError('probe process survived: ' + str(child))
        assert sentinel.poll() is None, 'unrelated process was killed'
        sock = socket.socket()
        assert sock.connect_ex(('127.0.0.1', port)) != 0, 'server unexpectedly listening'
        sock.close()
        print('%s: exit 0 in %.3fs; probe processes gone; sentinel alive' % (mode, time.monotonic() - start))
    finally:
        if not reaped:
            try: os.kill(pid, signal.SIGKILL)
            except ProcessLookupError: pass
            try: os.waitpid(pid, 0)
            except ChildProcessError: pass
        if probe_pids:
            try: os.killpg(probe_pids[0], signal.SIGKILL)
            except ProcessLookupError: pass
        sentinel.terminate()
        sentinel.wait()
        os.close(fd)
