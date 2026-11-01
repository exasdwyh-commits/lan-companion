#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=assets/whale-video-test
SOURCE="$ROOT/touch-cute.mov"
# This recipe is calibrated to the user's 193-frame, 24 fps reaction.
python3 - "$SOURCE" <<'PY'
import json, subprocess, sys
s=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',sys.argv[1]]))['streams'][0]
assert s['r_frame_rate']=='24/1' and int(s['nb_frames'])==193, 'Source changed; recalibrate frame indices.'
PY
ffmpeg -hide_banner -loglevel error -i "$SOURCE" -filter_complex \
 '[0:v]split[a][b];[a]trim=start_frame=167:end_frame=191,reverse,setpts=PTS-STARTPTS[r];[b]trim=start_frame=168:end_frame=190,setpts=PTS-STARTPTS[f];[r][f]concat=n=2:v=1:a=0,format=yuva444p10le[out]' \
 -map '[out]' -an -c:v prores_ks -profile:v 4 -alpha_bits 16 "$ROOT/idle-matched.mov" -y
ffmpeg -hide_banner -loglevel error -i "$SOURCE" -filter_complex \
 '[0:v]split[a][b];[a]trim=start_frame=190:end_frame=191,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=0.25[anchor];[b]trim=start_frame=0:end_frame=191,setpts=PTS-STARTPTS[act];[anchor][act]xfade=transition=fade:duration=0.25:offset=0,format=yuva444p10le[out]' \
 -map '[out]' -an -c:v prores_ks -profile:v 4 -alpha_bits 16 "$ROOT/touch-matched.mov" -y
