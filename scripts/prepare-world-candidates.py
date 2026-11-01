#!/usr/bin/env python3
"""Prepare the user-supplied Oct 31 scene candidates for the runtime media pack.

Run from the project with Python + numpy/OpenCV/Pillow and ffmpeg/ffprobe on PATH.
Originals must already exist in the batch's originals/ directory. Output remains
the app's source media pack; public-release permission remains separate.
"""
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BATCH = ROOT / 'assets/whale-world-candidates-2026-10-31'


def run(*args):
    return subprocess.run(list(map(str, args)), check=True, capture_output=True)


def key(bgr):
    # This batch has blue/white clothing, green cloth and isolated green halos
    # around generated particles. A colour mask also clears those enclosed halos;
    # the older border-connected keyer leaves them as dark opaque islands.
    b, g, r = (bgr[:, :, i].astype(np.int16) for i in range(3))
    # The actual cloth is cyan-green: B may exceed G by several levels.
    green = (g >= r + 5) & (g >= b - 5)
    alpha = ((~green).astype(np.uint8) * 255)
    count, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > 128).astype(np.uint8), 8)
    if count > 1:
        main_component = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        alpha[labels != main_component] = 0
    alpha = cv2.erode(alpha, np.ones((3, 3), np.uint8), iterations=1)
    alpha = cv2.GaussianBlur(alpha, (3, 3), .8)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    # Despill only near the keyed boundary; preserve opaque foreground colours.
    edge = alpha < 250
    rgb[:, :, 1][edge] = np.minimum(rgb[:, :, 1], np.maximum(rgb[:, :, 0], rgb[:, :, 2]))[edge]
    rgb[alpha == 0] = 0
    return np.dstack((rgb, alpha))


def main():
    output = BATCH / 'derived'
    preview = BATCH / 'previews'
    output.mkdir(exist_ok=True)
    preview.mkdir(exist_ok=True)
    manifest = {'version': 1, 'runtimeIntegrated': True, 'releaseAllowed': False,
                'source': 'User-provided local Doubao AIGC videos (4)-(7)', 'clips': []}
    for number, name, role in [(4, 'palm-magic', 'one-shot click interaction closeup'),
                                (5, 'moon-room', 'full-screen selectable scene'),
                                (6, 'gentle-smile', 'quiet-state intro closeup'),
                                (7, 'prayer-scene', 'user-triggered full-screen one-shot')]:
        original = BATCH / 'originals' / f'source-{number}.mp4'
        info = json.loads(run('ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', original).stdout)
        video = next(s for s in info['streams'] if s['codec_type'] == 'video')
        run('ffmpeg', '-v', 'error', '-i', original, '-f', 'null', '-')
        entry = {'id': name, 'sourceNumber': number, 'original': str(original.relative_to(BATCH)),
                 'originalSha256': hashlib.sha256(original.read_bytes()).hexdigest(),
                 'size': [video['width'], video['height']], 'fps': video['avg_frame_rate'],
                 'duration': float(video['duration']), 'role': role, 'loopApproved': False,
                 'audioPolicy': 'discard in derivative; retain original audio in original file',
                 'publicRedistribution': 'unverified', 'fullSourceDecode': True,
                 'runtimeReady': True,
                 'qualityNotes': {4: 'One-shot touch response; detached green artefacts removed from keyed frames.',
                                  5: 'Full scene with crossfaded loop boundary.',
                                  6: 'One-shot quiet intro; detached green artefacts removed from keyed frames.',
                                  7: 'Full-scene prayer clip, manually triggered.'}[number]}
        # Retain the original AI provenance and watermark; no source is overwritten.
        target = output / ({4: 'palm-magic.webm', 5: 'moon-room.mp4',
                            6: 'gentle-smile.webm', 7: 'prayer-scene.mp4'}[number])
        if number in (5, 7):
            run('ffmpeg', '-y', '-v', 'error', '-i', original, '-map', '0:v:0', '-map_metadata', '0',
                '-movflags', 'use_metadata_tags', '-c:v', 'copy', '-an', target)
        if number in (4, 6):
            with tempfile.TemporaryDirectory(prefix='world-candidate-') as folder:
                frames = Path(folder)
                run('ffmpeg', '-y', '-v', 'error', '-i', original, '-vf', 'scale=960:540', frames / 'f%04d.png')
                images = sorted(frames.glob('f*.png'))
                sample_indices = [0, len(images) // 2, len(images) - 1]
                sheet = Image.new('RGB', (960, 400), '#12202e')
                for index, file in enumerate(images):
                    rgba = key(cv2.imread(str(file)))
                    cv2.imwrite(str(file), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
                    if index in sample_indices:
                        col = sample_indices.index(index)
                        cut = Image.fromarray(rgba)
                        for row, colour in enumerate(['#edf0f5', '#14202e']):
                            canvas = Image.new('RGBA', cut.size, colour)
                            canvas.alpha_composite(cut)
                            sheet.paste(canvas.convert('RGB').resize((320, 180)), (col * 320, 20 + row * 200))
                        ImageDraw.Draw(sheet).text((col * 320 + 8, 4), f'#{number} / frame {index}', fill='white')
                        cut.save(preview / f'{name}-sample-{col}.png')
                sheet.save(preview / f'{name}-review.jpg', quality=95)
                run('ffmpeg', '-y', '-v', 'error', '-framerate', video['avg_frame_rate'], '-i', frames / 'f%04d.png',
                    '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24',
                    '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-threads', '4',
                    '-metadata', 'comment=AIGC; derived from user-provided Doubao video; local project', target)
                entry['frames'] = len(images)
        run('ffmpeg', '-v', 'error', *(['-c:v', 'libvpx-vp9'] if number in (4, 6) else []), '-i', target, '-f', 'null', '-')
        entry.update(derived=str(target.relative_to(BATCH)), alpha=number in (4, 6),
                     sha256=hashlib.sha256(target.read_bytes()).hexdigest(), fullDerivedDecode=True)
        manifest['clips'].append(entry)
        print(f'{name}: decoded OK', flush=True)
    (BATCH / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
