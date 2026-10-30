/**
 * Small synthesized sound effects (Web Audio), so the game ships without any
 * audio files. Sounds are generated from noise bursts and simple tones.
 */
export type SoundName = 'place' | 'break' | 'click' | 'door' | 'piston' | 'chat' | 'step' | 'error';

export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.6;

  private context(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private burst(ctx: AudioContext, duration: number, filterFreq: number, gain: number, type: BiquadFilterType = 'lowpass'): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * this.volume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + duration);
  }

  private tone(ctx: AudioContext, freq: number, duration: number, gain: number, type: OscillatorType = 'square', endFreq?: number): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * this.volume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  play(name: SoundName): void {
    if (this.volume <= 0) return;
    const ctx = this.context();
    if (!ctx || !this.noise) return;
    switch (name) {
      case 'place':
        this.burst(ctx, 0.09, 900, 0.5);
        this.tone(ctx, 140, 0.08, 0.15, 'sine', 90);
        break;
      case 'break':
        this.burst(ctx, 0.18, 1800, 0.6);
        break;
      case 'click':
        this.tone(ctx, 900, 0.04, 0.2, 'square', 600);
        break;
      case 'door':
        this.burst(ctx, 0.25, 500, 0.4);
        this.tone(ctx, 220, 0.2, 0.08, 'triangle', 160);
        break;
      case 'piston':
        this.burst(ctx, 0.3, 700, 0.35, 'bandpass');
        break;
      case 'chat':
        this.tone(ctx, 880, 0.08, 0.08, 'sine', 1320);
        break;
      case 'step':
        this.burst(ctx, 0.05, 600, 0.12);
        break;
      case 'error':
        this.tone(ctx, 200, 0.12, 0.12, 'square', 140);
        break;
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
