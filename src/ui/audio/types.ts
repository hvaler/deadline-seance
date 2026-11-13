/**
 * The small part of the Web Audio API the sounds use, as interfaces. The real `AudioContext` fits them, and a test can supply a fake that
 * records what was built. Nothing in `src/ui/audio` imports or names a browser global.
 */

export interface ParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}

export interface NodeLike {
  connect(destination: unknown): unknown;
}

export interface OscillatorLike extends NodeLike {
  type: string;
  readonly frequency: ParamLike;
  start(time?: number): void;
  stop(time?: number): void;
}

export interface GainLike extends NodeLike {
  readonly gain: ParamLike;
}

export interface FilterLike extends NodeLike {
  type: string;
  readonly frequency: ParamLike;
  readonly Q: ParamLike;
}

export interface BufferLike {
  readonly length: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceLike extends NodeLike {
  buffer: BufferLike | null;
  start(time?: number): void;
  stop(time?: number): void;
}

export interface ConvolverLike extends NodeLike {
  buffer: BufferLike | null;
}

export interface AudioLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<unknown>;
  suspend(): Promise<unknown>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  createBiquadFilter(): FilterLike;
  createBufferSource(): BufferSourceLike;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createConvolver(): ConvolverLike;
}
