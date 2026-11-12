#!/usr/bin/env python3
"""内核文件锁：保证多层保护同时触发时，只有一个进程真正启动服务。

用法: start_locked.py <lockfile> <command> [args...]

设计要点：
 - 用 fcntl.flock(LOCK_EX|LOCK_NB)，由内核持有，进程退出即自动释放，
   彻底避免「目录锁残留 + rm/rmdir 被沙箱 safe-delete shim 拦截」导致兜底卡死。
 - 锁 fd 设为 inheritable，exec 后由服务进程持续持有：服务运行期间独占，
   服务一退出锁立即释放，后续补位可零延迟接管。
 - 抢不到锁时退出码 3：交给 launchd KeepAlive / guard 下一轮探测处理，不阻塞。
"""
import fcntl
import os
import sys

lock_path = sys.argv[1]
cmd = sys.argv[2:]

os.makedirs(os.path.dirname(lock_path), exist_ok=True)
fd = open(lock_path, "a+")
try:
    fcntl.flock(fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    sys.exit(3)

os.set_inheritable(fd.fileno(), True)
# execvp(file, args)：args 必须是完整 argv（args[0] 即命令名），
# 传 cmd[1:] 会让 npm 把 "--prefix server" 的 server 误判为子命令。
os.execvp(cmd[0], cmd)
