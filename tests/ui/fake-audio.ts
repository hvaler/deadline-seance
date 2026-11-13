import type {
  AudioLike,
  BufferLike,
  BufferSourceLike,
  ConvolverLike,
  FilterLike,
  GainLike,
  OscillatorLike,
  ParamLike,
} from '../../src/ui/audio/types';

/** An audio parameter that remembers what it was told. */
export class FakeParam implements ParamLike {
  value: number;
  readonly calls: { kind: 'set' | 'linear' | 'exp'; value: number; time: number }[] = [];

  constructor(initial = 0) {
    this.value = initial;
  }

  setValueAtTime(value: number, time: number): void {
    this.calls.push({ kind: 'set', value, time });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.calls.push({ kind: 'linear', value, time });
  }

  exponentialRampToValueAtTime(value: number, time: number): void {
    this.calls.push({ kind: 'exp', value, time });
  }

  /** The first value the parameter was given at the start of a note: `setValueAtTime` or the plain value. */
  get first(): number {
    return this.calls.find((c) => c.kind === 'set')?.value ?? this.value;
  }

  /** The last value it ramps to. */
  get last(): number {
    const ramps = this.calls.filter((c) => c.kind !== 'set');
    return ramps.length > 0 ? (ramps[ramps.length - 1] as { value: number }).value : this.first;
  }
}

export type NodeKind = 'oscillator' | 'gain' | 'filter' | 'source' | 'convolver';

class FakeNode<K extends NodeKind> {
  readonly connections: unknown[] = [];
  constructor(
    readonly kind: K,
    readonly id: number,
  ) {}

  connect(destination: unknown): void {
    this.connections.push(destination);
  }
}

export class FakeOscillator extends FakeNode<'oscillator'> implements OscillatorLike {
  type = 'sine';
  readonly frequency = new FakeParam(440);
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  constructor(id: number) {
    super('oscillator', id);
  }
  start(time = 0): void {
    this.startedAt = time;
  }
  stop(time = 0): void {
    this.stoppedAt = time;
  }
}

export class FakeGain extends FakeNode<'gain'> implements GainLike {
  readonly gain = new FakeParam(1);
  constructor(id: number) {
    super('gain', id);
  }
}

export class FakeFilter extends FakeNode<'filter'> implements FilterLike {
  type = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  constructor(id: number) {
    super('filter', id);
  }
}

export class FakeSource extends FakeNode<'source'> implements BufferSourceLike {
  buffer: BufferLike | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  constructor(id: number) {
    super('source', id);
  }
  start(time = 0): void {
    this.startedAt = time;
  }
  stop(time = 0): void {
    this.stoppedAt = time;
  }
}

export class FakeConvolver extends FakeNode<'convolver'> implements ConvolverLike {
  buffer: BufferLike | null = null;
  constructor(id: number) {
    super('convolver', id);
  }
}

export class FakeBuffer implements BufferLike {
  private readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number): Float32Array {
    return this.data[channel] as Float32Array;
  }
}

/** An audio context that builds nothing real and remembers everything. */
export class FakeAudio implements AudioLike {
  currentTime = 10;
  readonly sampleRate = 8000;
  state = 'suspended';
  readonly destination = { name: 'destination' };
  readonly nodes: (FakeOscillator | FakeGain | FakeFilter | FakeSource | FakeConvolver)[] = [];
  readonly buffers: FakeBuffer[] = [];
  resumed = 0;
  suspended = 0;
  private nextId = 1;

  async resume(): Promise<void> {
    this.resumed++;
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.suspended++;
    this.state = 'suspended';
  }

  createOscillator(): FakeOscillator {
    const node = new FakeOscillator(this.nextId++);
    this.nodes.push(node);
    return node;
  }
  createGain(): FakeGain {
    const node = new FakeGain(this.nextId++);
    this.nodes.push(node);
    return node;
  }
  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter(this.nextId++);
    this.nodes.push(node);
    return node;
  }
  createBufferSource(): FakeSource {
    const node = new FakeSource(this.nextId++);
    this.nodes.push(node);
    return node;
  }
  createConvolver(): FakeConvolver {
    const node = new FakeConvolver(this.nextId++);
    this.nodes.push(node);
    return node;
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    const buffer = new FakeBuffer(channels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  of<K extends NodeKind>(kind: K): Extract<FakeAudio['nodes'][number], { kind: K }>[] {
    return this.nodes.filter((n) => n.kind === kind) as Extract<FakeAudio['nodes'][number], { kind: K }>[];
  }
}
