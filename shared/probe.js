// Media info from ffmpeg log output.

const hms = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + Number(s);

/** Parse ffmpeg's `-i` stream summary (no ffprobe needed; works with ffmpeg.wasm logs too). */
export function parseProbe(stderr) {
  const info = { duration: 0, width: 0, height: 0, hasVideo: false, hasAudio: false, videoCodec: '', audioCodec: '', fps: 0, rotation: 0 };
  const d = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (d) info.duration = hms(d[1], d[2], d[3]);
  const v = stderr.match(/Stream #\d+:\d+[^\n]*Video:\s*([a-z0-9_]+)[^\n]*?(\d{2,5})x(\d{2,5})/i);
  if (v && !/attached pic/.test(v[0])) {
    info.hasVideo = true;
    info.videoCodec = v[1];
    info.width = Number(v[2]);
    info.height = Number(v[3]);
    const fps = v[0].match(/([\d.]+) fps/);
    if (fps) info.fps = Number(fps[1]);
    info.tenBit = /p10|p12|10le|12le/.test(v[0]);
  }
  const a = stderr.match(/Stream #\d+:\d+[^\n]*Audio:\s*([a-z0-9_]+)/i);
  if (a) {
    info.hasAudio = true;
    info.audioCodec = a[1];
  }
  const rot = stderr.match(/rotation of (-?[\d.]+) degrees/) || stderr.match(/rotate\s*:\s*(-?\d+)/);
  if (rot) {
    info.rotation = Math.round(Number(rot[1]));
    if (Math.abs(info.rotation) % 180 === 90) [info.width, info.height] = [info.height, info.width];
  }
  if (!info.hasVideo && !info.hasAudio) throw new Error('This file does not contain video or audio that ffmpeg can read.');
  return info;
}

