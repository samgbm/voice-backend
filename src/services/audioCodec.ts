/**
 * Twilio Media Streams always use raw G.711 μ-law @ 8 kHz.
 * ElevenLabs agents often default to PCM — convert both directions when needed.
 */

const BIAS = 0x84; // 132
const CLIP = 32635;
const MULAW_DECODE: Int16Array = (() => {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const inv = ~i & 0xff;
    const sign = inv & 0x80;
    const exponent = (inv >> 4) & 0x07;
    const mantissa = inv & 0x0f;
    let sample = ((mantissa << 3) + BIAS) << exponent;
    sample -= BIAS;
    table[i] = sign !== 0 ? -sample : sample;
  }
  return table;
})();

function linearToMulaw(sample: number): number {
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample = sample + BIAS;
  let exponent = 7;
  for (
    let expMask = 0x4000;
    (sample & expMask) === 0 && exponent > 0;
    exponent--, expMask >>= 1
  ) {
    // find exponent
  }
  const mantissa = (sample >> (exponent === 0 ? 4 : exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function parsePcmSampleRate(format: string): number | null {
  const match = /^pcm_(\d+)$/i.exec(format);
  if (!match) return null;
  return Number(match[1]);
}

/** Downsample 16-bit LE PCM to 8 kHz, then encode as μ-law. Returns base64. */
export function pcmBase64ToMulaw8000Base64(
  pcmBase64: string,
  inputSampleRate: number
): string {
  const pcm = Buffer.from(pcmBase64, 'base64');
  const inputSamples = Math.floor(pcm.length / 2);
  const ratio = inputSampleRate / 8000;
  const outputSamples = Math.max(1, Math.floor(inputSamples / ratio));
  const mulaw = Buffer.alloc(outputSamples);

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = Math.min(inputSamples - 1, Math.floor(i * ratio));
    const sample = pcm.readInt16LE(srcIndex * 2);
    mulaw[i] = linearToMulaw(sample);
  }

  return mulaw.toString('base64');
}

/** Decode μ-law 8 kHz to 16-bit LE PCM at targetSampleRate. Returns base64. */
export function mulaw8000Base64ToPcmBase64(
  mulawBase64: string,
  targetSampleRate: number
): string {
  const mulaw = Buffer.from(mulawBase64, 'base64');
  const ratio = targetSampleRate / 8000;
  const outputSamples = Math.max(1, Math.floor(mulaw.length * ratio));
  const pcm = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = Math.min(mulaw.length - 1, Math.floor(i / ratio));
    pcm.writeInt16LE(MULAW_DECODE[mulaw[srcIndex]], i * 2);
  }

  return pcm.toString('base64');
}

/** EL → Twilio: ensure ulaw_8000 base64. */
export function toTwilioMulawPayload(
  audioBase64: string,
  agentOutputFormat: string | null
): string {
  if (!agentOutputFormat || agentOutputFormat === 'ulaw_8000') {
    return audioBase64;
  }

  const sampleRate = parsePcmSampleRate(agentOutputFormat);
  if (sampleRate == null) {
    console.warn(
      `Unknown agent output format "${agentOutputFormat}"; forwarding as-is`
    );
    return audioBase64;
  }

  return pcmBase64ToMulaw8000Base64(audioBase64, sampleRate);
}

/** Twilio → EL: convert ulaw_8000 to whatever the agent expects. */
export function toElevenLabsUserAudio(
  twilioMulawBase64: string,
  userInputFormat: string | null
): string {
  if (!userInputFormat || userInputFormat === 'ulaw_8000') {
    return twilioMulawBase64;
  }

  const sampleRate = parsePcmSampleRate(userInputFormat);
  if (sampleRate == null) {
    console.warn(
      `Unknown user input format "${userInputFormat}"; forwarding as-is`
    );
    return twilioMulawBase64;
  }

  return mulaw8000Base64ToPcmBase64(twilioMulawBase64, sampleRate);
}
