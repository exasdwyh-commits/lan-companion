#!/usr/bin/env python3
"""Derive browser media from the preserved PetDesk pack; never edit originals."""
import hashlib, json, shutil, subprocess
from pathlib import Path
root = Path(__file__).resolve().parents[1]
source = root / 'assets/whale-video-test'
out = root / 'assets/whale-world-web-v1'
out.mkdir(parents=True, exist_ok=True)
character = json.loads((source / 'character.json').read_text())
pack = json.loads((source / 'pack.json').read_text())
clips = {'idle': (character['character'], 880), 'touch': (pack['scene']['touch'], 880),
         'quiet': (character['quietCharacter'], 960), 'sleep': (character['sleepScene'], 960)}
manifest = {'version': 1, 'quietAfterSeconds': character.get('quietAfterSeconds', 60),
            'sleepAfterSeconds': character.get('sleepAfterSeconds', 300),
            'fadeOutSeconds': 0.4,
            'background': 'background.png', 'clips': {}}
# 锚点静帧：取待机原片第一帧，动作片尾淡出时垫在下面，避免露出生成视频的糊尾。
anchor = out / 'anchor-idle.png'
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source / clips['idle'][0]),
                '-frames:v', '1', '-vf', 'scale=880:-2', '-pix_fmt', 'rgba', str(anchor)], check=True)
manifest['anchor'] = anchor.name
manifest['anchorSha256'] = hashlib.sha256(anchor.read_bytes()).hexdigest()
for name, (original, width) in clips.items():
    target = out / (name + '.webm')
    alpha = name != 'sleep'
    command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source / original),
               '-an', '-vf', f'scale={width}:-2', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p' if alpha else 'yuv420p',
               '-b:v', '0', '-crf', '23', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-threads', '4', str(target)]
    subprocess.run(command, check=True)
    manifest['clips'][name] = {'file': target.name, 'original': original, 'alpha': alpha,
        'sourceSha256': hashlib.sha256((source / original).read_bytes()).hexdigest(),
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}
shutil.copy2(source / character['background'], out / 'background.png')
manifest['backgroundSha256'] = hashlib.sha256((out / 'background.png').read_bytes()).hexdigest()

# User supplied scenes/actions are prepared independently; import only clips
# explicitly listed as runtime ready. This keeps originals and generated output
# under their batch manifest instead of editing dist or the old media by hand.
batch = root / 'assets/whale-world-candidates-2026-10-31'
candidate_manifest = json.loads((batch / 'manifest.json').read_text())
resources = {}
for candidate in candidate_manifest['clips']:
    if not candidate.get('runtimeReady') or not candidate.get('derived'):
        raise SystemExit('候选素材尚未通过接入门槛: ' + candidate['id'])
    original = batch / candidate['original']
    derived = batch / candidate['derived']
    if hashlib.sha256(original.read_bytes()).hexdigest() != candidate['originalSha256']:
        raise SystemExit('候选原片哈希变化: ' + candidate['id'])
    if hashlib.sha256(derived.read_bytes()).hexdigest() != candidate['sha256']:
        raise SystemExit('候选派生文件哈希变化: ' + candidate['id'])
    target_name = Path(candidate['derived']).name
    target = out / target_name
    shutil.copy2(derived, target)
    resources[candidate['id']] = {
        'file': target_name, 'alpha': candidate['alpha'],
        'source': candidate['original'], 'sourceSha256': candidate['originalSha256'],
        'sha256': candidate['sha256'], 'sourceAigcOriginalRetained': True,
    }
moon_anchor = out / 'anchor-moon.png'
moon = resources['moon-room']['file']
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', '2.5', '-i', str(out / moon),
                '-frames:v', '1', '-vf', 'scale=960:-2', '-pix_fmt', 'rgba', str(moon_anchor)], check=True)
manifest['scenes'] = {
    'day': {
        'label': '日常房间', 'layout': 'figure', 'background': manifest['background'],
        'anchor': manifest['anchor'], 'inheritBase': False,
        'clips': {
            'idle': {'file': 'idle.webm', 'layout': 'figure'},
            'touch': {'file': resources['palm-magic']['file'], 'layout': 'figure', 'loop': False},
            'quiet': {'file': resources['gentle-smile']['file'], 'layout': 'figure', 'loop': False, 'after': 'quietHold'},
            'quietHold': {'file': 'quiet.webm', 'layout': 'full', 'loop': True},
            'sleep': {'file': 'sleep.webm', 'layout': 'full'},
        },
    },
    'moon': {
        'label': '月夜房间', 'layout': 'full', 'background': manifest['background'],
        'anchor': moon_anchor.name, 'inheritBase': False, 'automaticIdle': False,
        'crossfadeLoopSeconds': 0.35,
        'clips': {'idle': {'file': resources['moon-room']['file'], 'layout': 'full', 'loop': True,
                           'crossfadeLoop': True}},
    },
}
manifest['defaultScene'] = 'day'
manifest['cues'] = {
    'prayer': {'file': resources['prayer-scene']['file'], 'layout': 'full', 'loop': False,
               'scene': 'moon', 'returnState': 'idle'}
}
manifest['candidateResources'] = resources
manifest['sceneManifestSha256'] = hashlib.sha256((batch / 'manifest.json').read_bytes()).hexdigest()
(out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
# A script avoids file:// fetch restrictions, and contains no personal settings.
(out / 'config.js').write_text('globalThis.WhaleWorldMedia = ' + json.dumps(manifest, ensure_ascii=False) + ';\n')
runtime = root / 'MALFOY-ENGINE/web/live2d/world-media'
runtime.mkdir(parents=True, exist_ok=True)
for file in out.iterdir():
    shutil.copy2(file, runtime / file.name)
print(json.dumps({'clips': len(clips), 'bytes': sum(p.stat().st_size for p in out.iterdir())}))
