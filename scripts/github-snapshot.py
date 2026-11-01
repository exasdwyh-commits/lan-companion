#!/usr/bin/env python3
"""Plan or commit a GitHub source snapshot without changing HEAD/index.

Large original media, personal/runtime data and historical benchmark runs stay
local. The upload branch has its own history so old blobs are not republished.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TEXT = {'.md', '.txt', '.json', '.js', '.mjs', '.cjs', '.ts', '.css', '.html',
        '.py', '.sh', '.swift', '.plist', '.toml', '.yml', '.yaml', '.xml', '.csv'}
ASSET_PACKS = {'dsh-pet-desktop-v1', 'whale-chibi-rig-v1', 'whale-chibi-rig-v2',
               'whale-chibi-performance-v1', 'whale-chibi-walk-v1'}
RUNTIME_ROOTS = ('MALFOY-ENGINE/web/moli-room/', 'MALFOY-ENGINE/web/live2d/')
OMIT_ROOTS = ('benchmarks/', 'docs/integration-evidence/', '.agents/', '.codebuddy/',
              '_bmad/render/', 'MALFOY-ENGINE/web/live2d/Hiyori/')
SENSITIVE_NAMES = {'settings.json', 'config.user.toml', '.env', 'credentials.json',
                   'history.json', 'profile.json', 'sessions.json', 'memory.json'}
LIMIT = 45 * 1024 * 1024
BRANCH = 'github/main'
# Exact localhost credentials deliberately used by URL-rejection tests.
TEST_URLS = {
    'Tests/CompanionCoreTests/CoreTests.swift': {'http://' + 'user:secret@'},
    'Tests/SmokeChecks.swift': {'http://' + 'user:pw@'},
    'Tests/test_engine_bridge.py': {'http://' + 'user:pw@'},
}


def git(*args: str, env=None, data=None):
    return subprocess.check_output(['git', *args], cwd=ROOT, env=env, input=data)


def excluded(name: str):
    p = Path(name)
    if p.name == 'shunguai-hum.m4a' or p.name.startswith('shunguai-reference-'):
        return 'user reference audio/video: redistribution permission not verified'
    if name.startswith(OMIT_ROOTS):
        return 'local evidence, agent installation or unused sample'
    if any(part in {'node_modules', '.git', '__pycache__', 'data'} for part in p.parts):
        return 'dependency or runtime data'
    if p.name in SENSITIVE_NAMES or p.name.startswith('.env.') or p.name.endswith('.user.toml'):
        return 'personal configuration'
    if p.suffix in {'.sqlite', '.sqlite3', '.db', '.log', '.pem', '.key', '.blend', '.blend1'}:
        return 'runtime data, credential or original modeling project'
    if name.startswith('assets/'):
        if len(p.parts) > 1 and p.parts[1] in ASSET_PACKS:
            return None
        if name == 'assets/lan-3d-model-design-v2/model-trial-v1/lan-b-multiview-game-preview.glb':
            return None
        if p.suffix in TEXT:
            return None
        return 'original/reference media kept local'
    if name.startswith(RUNTIME_ROOTS):
        return None
    if len(p.parts) == 1 or p.suffix in TEXT or name.endswith(('LICENSE', 'NOTICE', '.gitignore')):
        return None
    return 'non-runtime binary or local artifact'


PATTERNS = [
    ('private-key', re.compile(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----')),
    ('github-token', re.compile(r'(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})')),
    ('provider-token', re.compile(r'(?<![A-Za-z0-9_-])sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}')),
    ('signed-download', re.compile(r'(?i)(?:X-Amz-Signature|X-Goog-Signature|x-cos-security-token|access_token)=[A-Za-z0-9%_./+-]{16,}')),
    ('credential-url', re.compile(r'https?://[^\s/"\']+:[^\s/"\']+@')),
]


def plan():
    candidates = set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').decode().split('\0')) - {''}
    files, omitted, findings = [], [], []
    for name in sorted(candidates):
        p = ROOT / name
        if not p.is_file():
            continue
        if p.is_symlink():
            omitted.append({'path': name, 'reason': 'symlink not exported'})
            continue
        reason = excluded(name)
        size = p.stat().st_size
        if size > LIMIT:
            reason = 'exceeds 45 MiB snapshot limit'
        if reason:
            omitted.append({'path': name, 'reason': reason, 'bytes': size})
            continue
        content = p.read_bytes()
        if p.suffix in TEXT or p.name in {'.gitignore', 'LICENSE', 'NOTICE'}:
            text = content.decode('utf8', errors='replace')
            for rule, pattern in PATTERNS:
                for match in pattern.finditer(text):
                    if rule == 'credential-url' and match.group() in TEST_URLS.get(name, set()):
                        continue
                    # Never print or persist matching secret values.
                    findings.append({'path': name, 'line': text.count('\n', 0, match.start()) + 1, 'rule': rule})
        files.append({'path': name, 'bytes': size, 'sha256': hashlib.sha256(content).hexdigest()})
    return {'schemaVersion': 1, 'branch': BRANCH, 'files': files,
            'totalFiles': len(files), 'totalBytes': sum(x['bytes'] for x in files),
            'omitted': omitted, 'findings': findings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', action='store_true')
    parser.add_argument('--message', default='Snapshot current Lan companion source and room/desktop assets')
    args = parser.parse_args()
    output = ROOT / '.build/github-snapshot'
    output.mkdir(parents=True, exist_ok=True)
    report = plan()
    (output / 'manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('totalFiles', 'totalBytes', 'findings')}, ensure_ascii=False))
    if report['findings']:
        raise SystemExit('Potential credentials found; review locally before any commit or upload.')
    if not args.commit:
        return
    head_before = git('rev-parse', 'HEAD').strip()
    index = Path(git('rev-parse', '--git-path', 'index').decode().strip())
    if not index.is_absolute():
        index = ROOT / index
    before_index = index.read_bytes() if index.exists() else None
    with tempfile.TemporaryDirectory(prefix='index-', dir=output) as temp:
        env = dict(os.environ, GIT_INDEX_FILE=str(Path(temp) / 'index'))
        git('read-tree', '--empty', env=env)
        paths = '\0'.join(x['path'] for x in report['files']) + '\0'
        git('add', '--pathspec-from-file=-', '--pathspec-file-nul', env=env, data=paths.encode())
        tree = git('write-tree', env=env).decode().strip()
        previous = subprocess.run(['git', 'rev-parse', '--verify', f'refs/heads/{BRANCH}'], cwd=ROOT, capture_output=True, text=True)
        parent = previous.stdout.strip() if previous.returncode == 0 else None
        if parent and git('rev-parse', f'{parent}^{{tree}}').decode().strip() == tree:
            commit = parent
        else:
            commit = git('commit-tree', tree, *(['-p', parent] if parent else []), data=(args.message+'\n').encode()).decode().strip()
            git('update-ref', f'refs/heads/{BRANCH}', commit, *([parent] if parent else ['0'*40]))
        # Verify staged blobs exactly match the reviewed files, even if another
        # agent changed a source during staging. Nothing is pushed by this tool.
        for entry in report['files']:
            blob = git('show', f"{commit}:{entry['path']}")
            if hashlib.sha256(blob).hexdigest() != entry['sha256']:
                raise SystemExit('Source changed while preparing snapshot; rerun the plan: '+entry['path'])
    assert git('rev-parse', 'HEAD').strip() == head_before, 'HEAD changed unexpectedly'
    assert (index.read_bytes() if index.exists() else None) == before_index, 'Working index changed unexpectedly'
    (output/'commit.json').write_text(json.dumps({'commit': commit, 'tree': tree, 'branch': BRANCH,
                                                'localHeadPreserved': head_before.decode(), 'indexPreserved': True}, indent=2)+'\n')
    print(json.dumps({'commit': commit, 'tree': tree, 'branch': BRANCH, 'indexPreserved': True}))


if __name__ == '__main__':
    main()
