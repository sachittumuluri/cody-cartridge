// Spectral Spines: every track gets a compact visual "body" derived from its
// actual audio — a fixed-width reduction of the full song into per-column
// energy plus low/mid/high band levels. The spine feeds the seek bar, the
// catalog row underlays, and the generated "pressing" covers, so the same
// signature reads consistently across the whole deck.

export const SPINE_COLS = 240;
export const SPINE_BANDS = 24;
// v3 added the spectral profile (Delta Scope), key chroma (phosphor tint),
// and onset times (rain); v4/v5 fix chroma resolution and weighting. Older
// archives are rejected on load and simply re-traced by the background queue.
export const SPINE_VERSION = 5;

export type TrackSpine = {
  v: typeof SPINE_VERSION;
  cols: number;
  duration: number;
  /** Estimated tempo from bass-envelope autocorrelation; 0 = undetected. */
  bpm: number;
  /** Spectral brightness 0..255: high-band vs low-band energy balance. */
  bright: number;
  /** Rough key as a pitch class 0-11 (C..B); -1 = no confident lock. */
  key: number;
  energy: Uint8Array;
  low: Uint8Array;
  mid: Uint8Array;
  high: Uint8Array;
  /**
   * Song-average spectral shape across the 24 live meter bands, stored as a
   * zero-mean dB profile: byte 128 = the song's mean band level, ±127 ≈ ±24dB.
   */
  bandShape: Uint8Array;
  /** Onset times as 30fps frame indices (bass-envelope transients). */
  onsets: Uint16Array;
};

export type SerializedSpine = {
  v: number;
  cols: number;
  duration: number;
  bpm: number;
  bright: number;
  key: number;
  data: string;
  shape: string;
  onsets: string;
};

export type SpinePalette = {
  played: string;
  unplayed: string;
  core: string;
  tick: string;
};

export type SpineStats = {
  peakAt: number;
  dynamicRangeDb: number;
  fill: number;
};

function spinePercentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index] ?? 0;
}

function onePoleAlpha(cutoffHz: number, sampleRate: number) {
  return 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
}

// In-place iterative radix-2 FFT (real input in `real`, zeroed `imag`).
// 2048 points is plenty for 24 log bands and chroma folding.
function fftInPlace(real: Float64Array, imag: Float64Array) {
  const n = real.length;

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;

    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }

    j ^= bit;

    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curR = 1;
      let curI = 0;

      for (let k = 0; k < len / 2; k += 1) {
        const evenR = real[i + k];
        const evenI = imag[i + k];
        const oddR = real[i + k + len / 2] * curR - imag[i + k + len / 2] * curI;
        const oddI = real[i + k + len / 2] * curI + imag[i + k + len / 2] * curR;
        real[i + k] = evenR + oddR;
        imag[i + k] = evenI + oddI;
        real[i + k + len / 2] = evenR - oddR;
        imag[i + k + len / 2] = evenI - oddI;
        const nextR = curR * wr - curI * wi;
        curI = curR * wi + curI * wr;
        curR = nextR;
      }
    }
  }
}

// One sparse spectral sweep over the mixed-down song: ~2 windows per second.
// Yields the average 24-band shape (Delta Scope reference) and a folded
// chroma histogram (rough key).
function analyzeSpectrum(mixed: Float32Array, sampleRate: number) {
  const fftSize = 2048;
  const hop = Math.max(fftSize, Math.floor(sampleRate / 2));
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);
  const window = new Float64Array(fftSize);

  for (let i = 0; i < fftSize; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
  }

  // Same log band edges the live meter bank uses.
  const binHz = sampleRate / fftSize;
  const minHz = 36;
  const maxHz = Math.min(15600, sampleRate / 2);
  const edges: number[] = [];

  for (let index = 0; index <= SPINE_BANDS; index += 1) {
    const hz = minHz * Math.pow(maxHz / minHz, index / SPINE_BANDS);
    edges.push(Math.min(fftSize / 2 - 1, Math.max(1, Math.round(hz / binHz))));
  }

  const bandSum = new Float64Array(SPINE_BANDS);
  const chroma = new Float64Array(12);
  let frames = 0;

  for (let start = 0; start + fftSize <= mixed.length; start += hop) {
    let frameEnergy = 0;

    for (let i = 0; i < fftSize; i += 1) {
      const sample = mixed[start + i];
      real[i] = sample * window[i];
      imag[i] = 0;
      frameEnergy += sample * sample;
    }

    // Skip near-silence so intros/outros don't drag the reference down.
    if (frameEnergy / fftSize < 1e-6) {
      continue;
    }

    fftInPlace(real, imag);
    frames += 1;

    for (let band = 0; band < SPINE_BANDS; band += 1) {
      const from = edges[band];
      const to = Math.max(from + 1, edges[band + 1]);
      let sum = 0;

      for (let bin = from; bin < to; bin += 1) {
        sum += Math.hypot(real[bin], imag[bin]);
      }

      bandSum[band] += sum / (to - from);
    }

  }

  const bandShape = new Uint8Array(SPINE_BANDS).fill(128);

  if (frames > 0) {
    const bandDb = Array.from(bandSum, (sum) => 20 * Math.log10(sum / frames + 1e-9));
    const meanDb = bandDb.reduce((total, db) => total + db, 0) / SPINE_BANDS;

    for (let band = 0; band < SPINE_BANDS; band += 1) {
      bandShape[band] = Math.round(Math.min(255, Math.max(0, ((bandDb[band] - meanDb) / 24) * 127 + 128)));
    }
  }

  return { bandShape, key: estimateKey(mixed, sampleRate, chroma) };
}

// Dedicated chroma pass: 2048-point bins at 44.1kHz are ~21.5Hz wide — far
// too coarse to separate semitones in the bass/mid register, which drags
// every song toward the same pitch class. Decimate 4× (≈11kHz) and use a
// 4096-point FFT (~2.7Hz bins), log-compress magnitudes so a single loud
// partial can't own the histogram, and only claim a key on a clear lead.
function estimateKey(mixed: Float32Array, sampleRate: number, chroma: Float64Array) {
  chroma.fill(0);
  const decimation = 4;
  const decimatedRate = sampleRate / decimation;
  const decimatedLength = Math.floor(mixed.length / decimation);

  if (decimatedLength < 1) {
    return -1;
  }

  const decimated = new Float32Array(decimatedLength);

  for (let index = 0; index < decimatedLength; index += 1) {
    const base = index * decimation;
    decimated[index] =
      (mixed[base] + (mixed[base + 1] ?? 0) + (mixed[base + 2] ?? 0) + (mixed[base + 3] ?? 0)) / decimation;
  }

  const fftSize = 4096;
  const hop = Math.max(fftSize, Math.floor(decimatedRate / 2));
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);
  const window = new Float64Array(fftSize);

  for (let index = 0; index < fftSize; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (fftSize - 1));
  }

  const binHz = decimatedRate / fftSize;
  const pcPower = new Float64Array(12);

  for (let start = 0; start + fftSize <= decimated.length; start += hop) {
    let frameEnergy = 0;

    for (let index = 0; index < fftSize; index += 1) {
      const sample = decimated[start + index];
      real[index] = sample * window[index];
      imag[index] = 0;
      frameEnergy += sample * sample;
    }

    if (frameEnergy / fftSize < 1e-6) {
      continue;
    }

    fftInPlace(real, imag);
    pcPower.fill(0);

    for (let bin = 1; bin < fftSize / 2; bin += 1) {
      const hz = bin * binHz;

      // Fundamentals register only: bass/mid where keys actually live.
      if (hz < 65 || hz > 520) {
        continue;
      }

      const midi = 12 * Math.log2(hz / 440) + 69;
      const nearest = Math.round(midi);

      if (Math.abs(midi - nearest) > 0.4) {
        continue;
      }

      // Normalize by the semitone's bandwidth in bins so high notes (wide
      // bands) don't outvote low notes purely on bin count.
      const semitoneBins = Math.max(1, (hz * 0.0578) / binHz);
      pcPower[((nearest % 12) + 12) % 12] += (real[bin] * real[bin] + imag[bin] * imag[bin]) / semitoneBins;
    }

    // Compress ONCE per pitch class per frame — tonal peaks count, the
    // accumulated noise floor doesn't.
    for (let pc = 0; pc < 12; pc += 1) {
      chroma[pc] += Math.log1p(pcPower[pc] * 5e-3);
    }
  }

  let best = 0;
  let runnerUp = 0;

  for (let pc = 1; pc < 12; pc += 1) {
    if (chroma[pc] > chroma[best]) {
      runnerUp = best;
      best = pc;
    } else if (chroma[pc] > chroma[runnerUp] || runnerUp === best) {
      runnerUp = pc;
    }
  }

  if (chroma[best] <= 0 || chroma[best] < chroma[runnerUp] * 1.05) {
    return -1;
  }

  return best;
}

// Bass-envelope transients → onset frame indices (30fps). Positive-derivative
// spikes above an adaptive threshold, with a short refractory window.
function detectOnsets(envelope: Float64Array) {
  const onsets: number[] = [];
  let positiveDeltaAvg = 0.001;
  let lastOnset = -10;

  for (let frame = 2; frame < envelope.length; frame += 1) {
    const delta = envelope[frame] - envelope[frame - 2];

    if (delta > 0) {
      positiveDeltaAvg += (delta - positiveDeltaAvg) * 0.02;
    }

    if (delta > Math.max(0.012, positiveDeltaAvg * 2.1) && frame - lastOnset >= 5) {
      onsets.push(frame);
      lastOnset = frame;

      if (onsets.length >= 1600) {
        break;
      }
    }
  }

  return Uint16Array.from(onsets.slice(0, 1600).map((frame) => Math.min(65535, frame)));
}

// Tempo from the 30fps bass envelope: normalized autocorrelation over the
// 45-180 BPM lag range, with a half-time correction so four-on-the-floor
// doesn't read as double speed.
function estimateBpm(envelope: Float64Array, fps: number) {
  const frameCount = envelope.length;

  if (frameCount < fps * 8) {
    return 0;
  }

  let mean = 0;

  for (let index = 0; index < frameCount; index += 1) {
    mean += envelope[index];
  }

  mean /= frameCount;

  const centered = new Float64Array(frameCount);
  let variance = 0;

  for (let index = 0; index < frameCount; index += 1) {
    centered[index] = envelope[index] - mean;
    variance += centered[index] * centered[index];
  }

  if (variance <= 0) {
    return 0;
  }

  const minLag = Math.round((fps * 60) / 180);
  const maxLag = Math.round((fps * 60) / 45);
  const correlations = new Float64Array(maxLag + 1);
  let bestLag = 0;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;

    for (let index = 0; index + lag < frameCount; index += 1) {
      sum += centered[index] * centered[index + lag];
    }

    const correlation = sum / variance;
    correlations[lag] = correlation;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (!bestLag || bestCorrelation < 0.04) {
    return 0;
  }

  let bpm = (fps * 60) / bestLag;

  // Prefer the half-time reading when its lag correlates nearly as well.
  const doubleLag = bestLag * 2;

  if (bpm > 150 && doubleLag <= maxLag && correlations[doubleLag] > bestCorrelation * 0.72) {
    bpm /= 2;
  }

  return Math.round(bpm);
}

export function spineFromAudioBuffer(buffer: AudioBuffer): TrackSpine {
  const cols = SPINE_COLS;
  const length = Math.max(1, buffer.length);
  const channelData = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const channelCount = Math.max(1, channelData.length);
  const lowAlpha = onePoleAlpha(180, buffer.sampleRate);
  const midAlpha = onePoleAlpha(2200, buffer.sampleRate);

  const energySum = new Float64Array(cols);
  const lowSum = new Float64Array(cols);
  const midSum = new Float64Array(cols);
  const highSum = new Float64Array(cols);
  const counts = new Uint32Array(cols);

  // 30fps bass envelope for tempo detection, filled during the same pass.
  const envelopeFps = 30;
  const envelopeFrameSize = Math.max(1, Math.floor(buffer.sampleRate / envelopeFps));
  const envelopeFrames = Math.max(1, Math.ceil(length / envelopeFrameSize));
  const bassEnvelope = new Float64Array(envelopeFrames);

  let lowState = 0;
  let midState = 0;
  let lowTotal = 0;
  let highTotal = 0;
  // Mono mixdown retained for the sparse FFT sweep (bandShape + chroma).
  const monoMix = new Float32Array(length);

  for (let cursor = 0; cursor < length; cursor += 1) {
    let mixed = 0;

    for (let channel = 0; channel < channelCount; channel += 1) {
      mixed += channelData[channel]?.[cursor] ?? 0;
    }

    mixed /= channelCount;
    monoMix[cursor] = mixed;
    lowState += lowAlpha * (mixed - lowState);
    midState += midAlpha * (mixed - midState);

    const lowSample = lowState;
    const midSample = midState - lowState;
    const highSample = mixed - midState;
    const column = Math.min(cols - 1, Math.floor((cursor / length) * cols));

    energySum[column] += mixed * mixed;
    lowSum[column] += lowSample * lowSample;
    midSum[column] += midSample * midSample;
    highSum[column] += highSample * highSample;
    counts[column] += 1;
    lowTotal += lowSample * lowSample;
    highTotal += highSample * highSample;
    bassEnvelope[Math.min(envelopeFrames - 1, Math.floor(cursor / envelopeFrameSize))] += lowSample * lowSample;
  }

  const energyRms = new Float64Array(cols);
  const lowRms = new Float64Array(cols);
  const midRms = new Float64Array(cols);
  const highRms = new Float64Array(cols);

  for (let column = 0; column < cols; column += 1) {
    const count = Math.max(1, counts[column]);
    energyRms[column] = Math.sqrt(energySum[column] / count);
    lowRms[column] = Math.sqrt(lowSum[column] / count);
    midRms[column] = Math.sqrt(midSum[column] / count);
    highRms[column] = Math.sqrt(highSum[column] / count);
  }

  const energyPeak = Math.max(spinePercentile(Array.from(energyRms), 0.98), 0.0001);
  const bandPeak = Math.max(
    spinePercentile([...Array.from(lowRms), ...Array.from(midRms), ...Array.from(highRms)], 0.985),
    0.0001
  );

  const toByte = (value: number, peak: number) =>
    Math.round(Math.min(1, Math.max(0, value / peak)) ** 0.62 * 255);

  const energy = new Uint8Array(cols);
  const low = new Uint8Array(cols);
  const mid = new Uint8Array(cols);
  const high = new Uint8Array(cols);

  for (let column = 0; column < cols; column += 1) {
    energy[column] = toByte(energyRms[column], energyPeak);
    low[column] = toByte(lowRms[column], bandPeak);
    mid[column] = toByte(midRms[column], bandPeak);
    high[column] = toByte(highRms[column], bandPeak);
  }

  for (let frame = 0; frame < envelopeFrames; frame += 1) {
    bassEnvelope[frame] = Math.sqrt(bassEnvelope[frame] / envelopeFrameSize);
  }

  // Brightness: high-band share of total tonal energy, 0..255 with 128 as an
  // even split — the identity system reads dark vs bright program from this.
  const bright = Math.round(
    Math.min(1, Math.sqrt(highTotal) / Math.max(1e-9, Math.sqrt(highTotal) + Math.sqrt(lowTotal))) * 255
  );

  const spectrum = analyzeSpectrum(monoMix, buffer.sampleRate);

  return {
    v: SPINE_VERSION,
    cols,
    duration: buffer.duration,
    bpm: estimateBpm(bassEnvelope, envelopeFps),
    bright,
    key: spectrum.key,
    energy,
    low,
    mid,
    high,
    bandShape: spectrum.bandShape,
    onsets: detectOnsets(bassEnvelope)
  };
}

export async function buildTrackSpine(url: string): Promise<TrackSpine> {
  const AudioContextConstructor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    throw new Error("AudioContext unavailable");
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Spine fetch failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const decodeContext = new AudioContextConstructor();

  try {
    const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
    return spineFromAudioBuffer(audioBuffer);
  } finally {
    decodeContext.close().catch(() => undefined);
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x2000;

  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }

  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function serializeSpine(spine: TrackSpine): SerializedSpine {
  const packed = new Uint8Array(spine.cols * 4);
  packed.set(spine.energy, 0);
  packed.set(spine.low, spine.cols);
  packed.set(spine.mid, spine.cols * 2);
  packed.set(spine.high, spine.cols * 3);

  const onsetBytes = new Uint8Array(spine.onsets.length * 2);

  for (let index = 0; index < spine.onsets.length; index += 1) {
    onsetBytes[index * 2] = spine.onsets[index] & 0xff;
    onsetBytes[index * 2 + 1] = spine.onsets[index] >> 8;
  }

  return {
    v: spine.v,
    cols: spine.cols,
    duration: Math.round(spine.duration * 100) / 100,
    bpm: spine.bpm,
    bright: spine.bright,
    key: spine.key,
    data: bytesToBase64(packed),
    shape: bytesToBase64(spine.bandShape),
    onsets: bytesToBase64(onsetBytes)
  };
}

export function deserializeSpine(raw: unknown): TrackSpine | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const candidate = raw as SerializedSpine;

  if (
    candidate.v !== SPINE_VERSION ||
    typeof candidate.cols !== "number" ||
    candidate.cols <= 0 ||
    candidate.cols > 2048 ||
    typeof candidate.duration !== "number" ||
    typeof candidate.data !== "string" ||
    typeof candidate.shape !== "string" ||
    typeof candidate.onsets !== "string"
  ) {
    return undefined;
  }

  try {
    const packed = base64ToBytes(candidate.data);
    const bandShape = base64ToBytes(candidate.shape);
    const onsetBytes = base64ToBytes(candidate.onsets);

    if (packed.length !== candidate.cols * 4 || bandShape.length !== SPINE_BANDS || onsetBytes.length % 2 !== 0) {
      return undefined;
    }

    const onsets = new Uint16Array(onsetBytes.length / 2);

    for (let index = 0; index < onsets.length; index += 1) {
      onsets[index] = onsetBytes[index * 2] | (onsetBytes[index * 2 + 1] << 8);
    }

    return {
      v: SPINE_VERSION,
      cols: candidate.cols,
      duration: candidate.duration,
      bpm: typeof candidate.bpm === "number" ? candidate.bpm : 0,
      bright: typeof candidate.bright === "number" ? candidate.bright : 128,
      key: typeof candidate.key === "number" ? candidate.key : -1,
      energy: packed.slice(0, candidate.cols),
      low: packed.slice(candidate.cols, candidate.cols * 2),
      mid: packed.slice(candidate.cols * 2, candidate.cols * 3),
      high: packed.slice(candidate.cols * 3, candidate.cols * 4),
      bandShape,
      onsets
    };
  } catch {
    return undefined;
  }
}

// Deterministic pseudo-random spine for store-demo/poster surfaces: a plausible
// song shape (intro build, sections, a drop, outro) seeded from the track id so
// screenshots stay pixel-stable without shipping audio.
export function syntheticSpine(seedText: string, duration = 214): TrackSpine {
  let seed = 2166136261;

  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }

  const random = () => {
    seed = Math.imul(seed ^ (seed >>> 15), seed | 1);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), seed | 61);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };

  const cols = SPINE_COLS;
  const energy = new Uint8Array(cols);
  const low = new Uint8Array(cols);
  const mid = new Uint8Array(cols);
  const high = new Uint8Array(cols);
  const sectionCount = 3 + Math.floor(random() * 3);
  const sectionLevels = Array.from({ length: sectionCount }, () => 0.45 + random() * 0.55);
  const dropAt = 0.52 + random() * 0.2;
  const wobbleA = 4 + random() * 5;
  const wobbleB = 11 + random() * 9;

  for (let column = 0; column < cols; column += 1) {
    const t = column / (cols - 1);
    const intro = Math.min(1, t / 0.07);
    const outro = Math.min(1, (1 - t) / 0.06);
    const section = sectionLevels[Math.min(sectionCount - 1, Math.floor(t * sectionCount))];
    const drop = t >= dropAt && t < dropAt + 0.02 ? 0.24 : 1;
    const pulse = 0.78 + Math.sin(t * Math.PI * wobbleA) * 0.12 + Math.sin(t * Math.PI * wobbleB) * 0.08;
    const jitter = 0.9 + random() * 0.2;
    const value = Math.min(1, Math.max(0.04, intro * outro * section * drop * pulse * jitter));

    energy[column] = Math.round(value * 255);
    low[column] = Math.round(Math.min(1, value * (0.62 + Math.sin(t * Math.PI * 2.3) * 0.2)) * 255);
    mid[column] = Math.round(Math.min(1, value * 0.7) * 255);
    high[column] = Math.round(Math.min(1, value * (0.3 + random() * 0.34)) * 255);
  }

  const syntheticBpm = 92 + Math.floor(random() * 62);
  const bandShape = new Uint8Array(SPINE_BANDS);

  for (let band = 0; band < SPINE_BANDS; band += 1) {
    // Plausible program curve: strong lows rolling off with a presence bump.
    const tiltDb = 10 - (band / (SPINE_BANDS - 1)) * 20 + Math.sin(band * 0.9) * 3 + (random() - 0.5) * 2;
    bandShape[band] = Math.round(Math.min(255, Math.max(0, (tiltDb / 24) * 127 + 128)));
  }

  const beatFrames = Math.round((30 * 60) / syntheticBpm);
  const onsetList: number[] = [];

  for (let frame = beatFrames; frame < duration * 30 && onsetList.length < 1200; frame += beatFrames) {
    onsetList.push(frame);
  }

  return {
    v: SPINE_VERSION,
    cols,
    duration,
    bpm: syntheticBpm,
    bright: 96 + Math.floor(random() * 96),
    key: Math.floor(random() * 12),
    energy,
    low,
    mid,
    high,
    bandShape,
    onsets: Uint16Array.from(onsetList)
  };
}

export function computeSpineStats(spine: TrackSpine): SpineStats {
  let peakValue = 0;
  let peakAt = 0;
  let filled = 0;
  const values: number[] = [];

  for (let column = 0; column < spine.cols; column += 1) {
    // Invert the storage compression curve so the ratio reflects real RMS.
    const value = (spine.energy[column] / 255) ** (1 / 0.62);
    values.push(value);

    if (value > peakValue) {
      peakValue = value;
      peakAt = column / Math.max(1, spine.cols - 1);
    }

    if (value > 0.08) {
      filled += 1;
    }
  }

  const loud = Math.max(spinePercentile(values, 0.95), 0.001);
  const quiet = Math.max(spinePercentile(values, 0.2), 0.004);
  const dynamicRangeDb = Math.min(40, Math.max(0, 20 * Math.log10(loud / quiet)));

  return {
    peakAt,
    dynamicRangeDb,
    fill: filled / spine.cols
  };
}

// The seismograph strip: mirrored energy envelope around a center line, a
// denser low-band core, and fine high-band ticks along the crest. `progress`
// splits played/unplayed tinting; `reveal` draws the plotter-pen sweep.
export function drawSpineStrip(
  context: CanvasRenderingContext2D,
  spine: TrackSpine,
  width: number,
  height: number,
  options: {
    progress?: number;
    reveal?: number;
    palette: SpinePalette;
    background?: string;
  }
) {
  const { palette } = options;
  const progress = options.progress ?? -1;
  const reveal = options.reveal ?? 1;

  context.clearRect(0, 0, width, height);

  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, width, height);
  }

  const middle = height / 2;
  const columnWidth = width / spine.cols;
  const barWidth = Math.max(1, columnWidth - Math.max(0.4, columnWidth * 0.28));

  for (let column = 0; column < spine.cols; column += 1) {
    const t = column / Math.max(1, spine.cols - 1);

    if (t > reveal) {
      break;
    }

    const x = column * columnWidth;
    const energyLevel = spine.energy[column] / 255;
    const lowLevel = spine.low[column] / 255;
    const highLevel = spine.high[column] / 255;
    const half = Math.max(0.6, energyLevel * height * 0.48);
    const played = progress >= 0 && t <= progress;

    context.fillStyle = played ? palette.played : palette.unplayed;
    context.fillRect(x, middle - half, barWidth, half * 2);

    const coreHalf = Math.max(0.4, lowLevel * height * 0.26);
    context.fillStyle = palette.core;
    context.fillRect(x, middle - coreHalf, barWidth, coreHalf * 2);

    if (highLevel > 0.24) {
      context.fillStyle = palette.tick;
      context.globalAlpha = Math.min(1, highLevel);
      context.fillRect(x, middle - half - 1.4, barWidth, 1);
      context.fillRect(x, middle + half + 0.4, barWidth, 1);
      context.globalAlpha = 1;
    }
  }

  if (reveal < 1) {
    const penX = reveal * width;
    context.fillStyle = palette.tick;
    context.globalAlpha = 0.9;
    context.fillRect(penX - 1, 0, 2, height);
    context.globalAlpha = 1;
  }
}

export function spineToDataUrl(
  spine: TrackSpine,
  width: number,
  height: number,
  palette: SpinePalette,
  background?: string
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return undefined;
  }

  drawSpineStrip(context, spine, width, height, { palette, background });
  return canvas.toDataURL("image/png");
}

// Procedural hero texture: a deterministic archival-transmission backdrop for
// tracks with no cover art — microfiche slats, scanlines, seeded static,
// horizontal tear bands, and oscilloscope ghost traces (spine-driven when a
// trace exists). Missing art becomes an aesthetic, not an error.
export function heroTextureDataUrl(seedText: string, hue: number, spine?: TrackSpine, width = 640, height = 360) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return undefined;
  }

  let seed = 2166136261;

  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }

  const random = () => {
    seed = Math.imul(seed ^ (seed >>> 15), seed | 1);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), seed | 61);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };

  // Base plate.
  context.fillStyle = `hsl(${hue}deg 16% 5%)`;
  context.fillRect(0, 0, width, height);

  // Microfiche slats: uneven vertical bands.
  const slatCount = 34 + Math.floor(random() * 22);
  let slatX = 0;

  while (slatX < width) {
    const slatWidth = 6 + random() * 26;
    context.fillStyle = `hsla(${hue + (random() - 0.5) * 30}deg 30% ${8 + random() * 9}% / ${(0.16 + random() * 0.3).toFixed(3)})`;
    context.fillRect(slatX, 0, slatWidth, height);
    slatX += slatWidth + random() * (width / slatCount);
  }

  // Horizontal tear bands: a few rows shifted and brightened.
  const tearCount = 2 + Math.floor(random() * 4);

  for (let tear = 0; tear < tearCount; tear += 1) {
    const y = Math.floor(random() * height);
    const bandHeight = 2 + Math.floor(random() * 5);
    context.fillStyle = `hsla(${hue}deg 24% ${26 + random() * 18}% / ${(0.1 + random() * 0.14).toFixed(3)})`;
    context.fillRect(0, y, width, bandHeight);
    context.fillStyle = `rgba(239, 239, 231, ${(0.05 + random() * 0.06).toFixed(3)})`;
    context.fillRect(random() * width * 0.5, y, width * (0.2 + random() * 0.5), 1);
  }

  // Seeded static: sparse dots and dashes.
  const grainCount = 640;

  for (let grain = 0; grain < grainCount; grain += 1) {
    const x = random() * width;
    const y = random() * height;
    const isDash = random() > 0.82;
    context.fillStyle =
      random() > 0.6
        ? `rgba(239, 239, 231, ${(0.03 + random() * 0.09).toFixed(3)})`
        : `hsla(${hue}deg 40% 52% / ${(0.03 + random() * 0.08).toFixed(3)})`;
    context.fillRect(x, y, isDash ? 2 + random() * 9 : 1, 1);
  }

  // Oscilloscope ghost traces.
  const traceCount = 2;

  for (let trace = 0; trace < traceCount; trace += 1) {
    const baseline = height * (0.3 + random() * 0.45);
    const amplitude = height * (0.05 + random() * 0.1);
    const frequencyA = 2 + random() * 6;
    const frequencyB = 9 + random() * 14;
    const phase = random() * Math.PI * 2;
    context.beginPath();

    for (let x = 0; x <= width; x += 3) {
      const t = x / width;
      const spineLevel =
        spine && trace === 0 ? spine.energy[Math.min(spine.cols - 1, Math.floor(t * spine.cols))] / 255 : 1;
      const y =
        baseline +
        (Math.sin(t * Math.PI * frequencyA + phase) * 0.62 + Math.sin(t * Math.PI * frequencyB + phase * 1.7) * 0.38) *
          amplitude *
          spineLevel;

      if (x === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.lineWidth = 1;
    context.strokeStyle =
      trace === 0 ? "rgba(156, 199, 216, 0.2)" : `hsla(${hue}deg 46% 60% / 0.12)`;
    context.stroke();
  }

  // Scanlines over everything.
  context.fillStyle = "rgba(0, 0, 0, 0.22)";

  for (let y = 0; y < height; y += 3) {
    context.fillRect(0, y, width, 1);
  }

  // Archive plate code, bottom-right.
  const plateCode = `ARC-${(Math.abs(seed) % 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
  context.font = "900 22px 'Courier New', monospace";
  context.fillStyle = "rgba(239, 239, 231, 0.07)";
  context.textAlign = "right";
  context.fillText(plateCode, width - 14, height - 12);

  return canvas.toDataURL("image/png");
}

// Circle-of-fifths hue for a pitch class: musically adjacent keys land on
// adjacent hues, anchored so C keeps the stock cool phosphor.
export function keyHue(pitchClass: number) {
  return pitchClass < 0 ? 202 : (202 + ((pitchClass * 7) % 12) * 30) % 360;
}

// Signal-identity features derived from a spine — the shared vocabulary for
// pressings, motion patterns, and palettes.
export type SpineIdentity = {
  bpm: number;
  meanEnergy: number;
  brightness: number;
  energetic: boolean;
  /** Second palette hue: complementary for bright program, analogous for dark. */
  hueB: (baseHue: number) => number;
};

export function spineIdentity(spine: TrackSpine): SpineIdentity {
  let energyTotal = 0;

  for (let column = 0; column < spine.cols; column += 1) {
    energyTotal += spine.energy[column];
  }

  const meanEnergy = energyTotal / spine.cols / 255;
  const brightness = spine.bright / 255;
  const energetic = spine.bpm >= 112 || meanEnergy > 0.58;

  return {
    bpm: spine.bpm,
    meanEnergy,
    brightness,
    energetic,
    hueB: (baseHue: number) => (brightness > 0.42 ? baseHue + 168 : baseHue + 36)
  };
}

// The "pressing", now a full signal identity: concentric grooves follow the
// song's energy history, the palette follows its brightness and energy, and a
// central geometric glyph encodes tempo (spokes) and dynamics (rings).
export function spineCoverDataUrl(spine: TrackSpine, hue: number, size = 160) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");

  if (!context) {
    return undefined;
  }

  const identity = spineIdentity(spine);
  const stats = computeSpineStats(spine);
  const secondHue = identity.hueB(hue);
  const saturation = Math.round(30 + identity.meanEnergy * 34);
  const center = size / 2;
  const innerRadius = size * 0.14;
  const outerRadius = size * 0.47;
  const rings = 96;
  const step = Math.max(1, Math.floor(spine.cols / rings));

  context.fillStyle = `hsl(${hue}deg ${Math.round(saturation * 0.6)}% 6%)`;
  context.fillRect(0, 0, size, size);

  for (let ring = 0; ring < rings; ring += 1) {
    const column = Math.min(spine.cols - 1, ring * step);
    const t = ring / Math.max(1, rings - 1);
    const energyLevel = spine.energy[column] / 255;
    const lowLevel = spine.low[column] / 255;
    const highLevel = spine.high[column] / 255;
    const tilt = highLevel - lowLevel;
    const ringHue = tilt > 0.06 ? secondHue : hue + tilt * 30;
    const radius = innerRadius + t * (outerRadius - innerRadius);

    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.lineWidth = 0.5 + energyLevel * 1.9;
    context.strokeStyle = `hsla(${ringHue}deg ${saturation}% ${Math.round(22 + energyLevel * 42)}% / ${(
      0.2 +
      energyLevel * 0.72
    ).toFixed(3)})`;
    context.stroke();
  }

  // Index line pointing at the loudest passage, like a groove marker.
  const markerAngle = stats.peakAt * Math.PI * 2 - Math.PI / 2;
  context.beginPath();
  context.moveTo(center + Math.cos(markerAngle) * innerRadius, center + Math.sin(markerAngle) * innerRadius);
  context.lineTo(center + Math.cos(markerAngle) * outerRadius, center + Math.sin(markerAngle) * outerRadius);
  context.lineWidth = 1;
  context.strokeStyle = `hsla(${hue}deg 18% 88% / 0.4)`;
  context.stroke();

  // Hub plate.
  context.beginPath();
  context.arc(center, center, innerRadius * 0.94, 0, Math.PI * 2);
  context.fillStyle = `hsl(${hue}deg ${Math.round(saturation * 0.8)}% 12%)`;
  context.fill();

  // Glyph: spokes count tracks tempo (slow 3 … fast 8); dynamic program gets
  // an extra inner ring, compressed program a filled core.
  const spokes = spine.bpm > 0 ? Math.max(3, Math.min(8, Math.round(spine.bpm / 24))) : 4;
  const glyphRadius = innerRadius * 0.72;
  context.strokeStyle = `hsla(${secondHue}deg ${saturation}% 68% / 0.85)`;
  context.lineWidth = Math.max(1, size * 0.008);
  context.beginPath();

  for (let spoke = 0; spoke <= spokes; spoke += 1) {
    const angle = (spoke / spokes) * Math.PI * 2 - Math.PI / 2;
    const x = center + Math.cos(angle) * glyphRadius;
    const y = center + Math.sin(angle) * glyphRadius;

    if (spoke === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();

  if (stats.dynamicRangeDb >= 8) {
    context.beginPath();
    context.arc(center, center, glyphRadius * 0.55, 0, Math.PI * 2);
    context.stroke();
  } else {
    context.beginPath();
    context.arc(center, center, glyphRadius * 0.3, 0, Math.PI * 2);
    context.fillStyle = `hsla(${secondHue}deg ${saturation}% 62% / 0.7)`;
    context.fill();
  }

  // Spindle hole.
  context.beginPath();
  context.arc(center, center, size * 0.02, 0, Math.PI * 2);
  context.fillStyle = "#050506";
  context.fill();

  // Outer rim.
  context.beginPath();
  context.arc(center, center, outerRadius + 1, 0, Math.PI * 2);
  context.lineWidth = 1.4;
  context.strokeStyle = "rgba(239, 239, 231, 0.16)";
  context.stroke();

  return canvas.toDataURL("image/png");
}
