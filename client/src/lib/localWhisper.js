// EXPERIMENTAL: transcribe in the browser with Whisper via Transformers.js.
// Nothing leaves the device except the one-time model download (~80 MB from Hugging Face's CDN).
// The library is loaded on demand from jsDelivr so it adds nothing to the app bundle.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MODEL = 'onnx-community/whisper-base';

let pipePromise = null;

async function decode16k(url) {
  const buf = await (await fetch(url, { credentials: 'same-origin' })).arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  try {
    const audio = await ctx.decodeAudioData(buf);
    if (audio.numberOfChannels === 1) return audio.getChannelData(0);
    const a = audio.getChannelData(0);
    const b = audio.getChannelData(1);
    const mono = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) mono[i] = (a[i] + b[i]) / 2;
    return mono;
  } finally {
    ctx.close();
  }
}

export async function transcribeLocally(url, onStatus) {
  onStatus?.({ step: 'Loading speech model (first time only, ~80 MB)…', progress: 0 });
  if (!pipePromise) {
    pipePromise = import(/* @vite-ignore */ LIB).then(({ pipeline }) =>
      pipeline('automatic-speech-recognition', MODEL, {
        progress_callback: (p) => p.status === 'progress' && onStatus?.({ step: `Downloading model: ${p.file}`, progress: (p.progress || 0) / 100 }),
      }),
    );
    pipePromise.catch(() => (pipePromise = null));
  }
  const asr = await pipePromise;
  onStatus?.({ step: 'Decoding audio…', progress: 0.05 });
  const audio = await decode16k(url);
  onStatus?.({ step: `Transcribing ${Math.round(audio.length / 16000)}s of audio on this device…`, progress: 0.1 });
  const out = await asr(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
  const chunks = (out.chunks || []).filter((c) => c.text?.trim());
  return chunks.map((c) => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 2, text: c.text.trim() }));
}
