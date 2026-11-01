#!/usr/bin/env python3
"""Fail packaging when source/runtime bytes or media provenance disagree."""
import hashlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
bundle = Path(sys.argv[1]).resolve()
engine = root / 'MALFOY-ENGINE'
runtime = bundle / 'Contents/Resources/app'
media = root / 'assets/whale-world-web-v1'
originals = root / 'assets/whale-video-test'

def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

checks = []
def same(source, target):
    matched = source.is_file() and target.is_file() and digest(source) == digest(target)
    checks.append({'file': str(target.relative_to(bundle)), 'matches': matched})

for file in ['main.js', 'preload.js', 'web/data.js', 'web/live2d/world.html',
             'web/live2d/world-video.js', 'web/live2d/composer.html', 'web/live2d/composer.js', 'web/live2d/composer.css',
             'web/live2d/companion-panel.js', 'web/live2d/companion-playback.js',
             'web/live2d/motion-preview.html', 'web/live2d/chibi-motion.js',
             'web/live2d/chibi-performance.js', 'web/live2d/chibi-face.js',
             'web/live2d/chibi-presence.js', 'web/live2d/chibi-renderer.js',
             'web/live2d/chibi-texture.js', 'web/live2d/chibi-atlas.js']:
    same(engine / file, runtime / file)
for file in sorted((engine / 'lib').glob('*.js')):
    same(file, runtime / 'lib' / file.name)
same(engine / 'lib/read-ebook.py', runtime / 'lib/read-ebook.py')
same(root / 'assets/whale-chibi-rig-v2/texture.png', runtime / 'web/live2d/whale-chibi.png')
for name in ['background.png', 'config.js', 'manifest.json', 'idle.webm', 'touch.webm', 'quiet.webm', 'sleep.webm',
             'anchor-idle.png', 'anchor-moon.png', 'palm-magic.webm', 'moon-room.mp4',
             'gentle-smile.webm', 'prayer-scene.mp4']:
    same(media / name, runtime / 'web/live2d/world-media' / name)

manifest = json.loads((media / 'manifest.json').read_text())
character = json.loads((originals / 'character.json').read_text())
pack = json.loads((originals / 'pack.json').read_text())
content = runtime / 'web/live2d/companion-content'
song_manifest = json.loads((content / 'songs.json').read_text())

def _authored(songs):
    """duration 是 prepare-companion-songs.py 从音频 mvhd 量出来的，不是 pack 里写的字段，
    比较「打包清单是否忠于规范曲包」时不该把它算成差异。"""
    return [{k: v for k, v in s.items() if k != 'duration'} for s in songs or []]

checks.append({'file':'song-metadata','matches':_authored(song_manifest.get('songs')) == _authored(pack['songs'])})
for song in pack['songs']:
    same(originals / song['file'],content / song['file'])
expected = {'idle': character['character'], 'touch': pack['scene']['touch'],
            'quiet': character['quietCharacter'], 'sleep': character['sleepScene']}
provenance = [all(manifest['clips'][name]['original'] == original for name, original in expected.items()),
              manifest['quietAfterSeconds'] == character.get('quietAfterSeconds', 60),
              manifest['sleepAfterSeconds'] == character.get('sleepAfterSeconds', 300),
              digest(originals / character['background']) == manifest['backgroundSha256']]
for clip in manifest['clips'].values():
    provenance.append(digest(originals / clip['original']) == clip['sourceSha256']
                      and digest(media / clip['file']) == clip['sha256'])
provenance.append(digest(media / manifest['background']) == manifest['backgroundSha256'])
candidate_root = root / 'assets/whale-world-candidates-2026-10-31'
candidate_manifest = json.loads((candidate_root / 'manifest.json').read_text())
provenance.append(hashlib.sha256((candidate_root / 'manifest.json').read_bytes()).hexdigest()
                  == manifest.get('sceneManifestSha256'))
for resource in manifest.get('candidateResources', {}).values():
    original = candidate_root / resource['source']
    derived = media / resource['file']
    packaged = runtime / 'web/live2d/world-media' / resource['file']
    provenance.append(original.is_file() and derived.is_file() and packaged.is_file()
                      and digest(original) == resource['sourceSha256']
                      and digest(derived) == resource['sha256']
                      and digest(packaged) == resource['sha256'])
candidate_by_id = {item['id']: item for item in candidate_manifest.get('clips', [])}
provenance.append(set(candidate_by_id) == set(manifest.get('candidateResources', {})))
for name, resource in manifest.get('candidateResources', {}).items():
    candidate = candidate_by_id.get(name, {})
    provenance.append(candidate.get('originalSha256') == resource['sourceSha256']
                      and candidate.get('sha256') == resource['sha256']
                      and candidate.get('derived') == 'derived/' + resource['file'])
for scene in manifest.get('scenes', {}).values():
    for clip in scene.get('clips', {}).values():
        provenance.append((media / clip['file']).is_file())
for cue in manifest.get('cues', {}).values():
    provenance.append((media / cue['file']).is_file())
report = {'bundle': str(bundle), 'checks': checks, 'matches': sum(c['matches'] for c in checks),
          'total': len(checks), 'mediaProvenance': all(provenance),
          'pass': all(c['matches'] for c in checks) and all(provenance)}
print(json.dumps(report, ensure_ascii=False, indent=2))
sys.exit(0 if report['pass'] else 1)
