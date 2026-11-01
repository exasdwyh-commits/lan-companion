"""Swift 进程生命周期测试专用，不连接模型服务。"""
import argparse
import json
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument("--voice")
args, _ = parser.parse_known_args()
if args.voice == "crash":
    sys.exit(2)
print(json.dumps({"event": "ready", "model": args.voice}), flush=True)
for line in sys.stdin:
    command = json.loads(line)
    if command["op"] == "quit":
        time.sleep(.1)
        break
