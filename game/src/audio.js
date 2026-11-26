// MERAPI AIRMAIL — all sound is synthesised with WebAudio in code:
// engine hum, wind, ring chime, parcel thump, touchdown thud, alarm.
export function createAudio() {
  const audio = {
    ctx: null, engineOsc: null, engineGain: null, windGain: null, windSrc: null,
    muted: false, started: false,
  };

  audio.init = function init() {
    if (audio.started) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audio.ctx = new AC();
      // Engine: two detuned sawtooth oscillators through a low-pass filter.
      audio.engineOsc = audio.ctx.createOscillator();
      audio.engineOsc.type = 'sawtooth';
      audio.engineOsc.frequency.value = 55;
      const osc2 = audio.ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.value = 55.7;
      const filter = audio.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      audio.engineGain = audio.ctx.createGain();
      audio.engineGain.gain.value = 0;
      audio.engineOsc.connect(filter);
      osc2.connect(filter);
      filter.connect(audio.engineGain);
      audio.engineGain.connect(audio.ctx.destination);
      audio.engineOsc.start();
      osc2.start();
      audio.osc2 = osc2;
      // Wind: looped filtered noise buffer.
      const len = audio.ctx.sampleRate * 2;
      const buf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      audio.windSrc = audio.ctx.createBufferSource();
      audio.windSrc.buffer = buf;
      audio.windSrc.loop = true;
      const windFilter = audio.ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 500;
      audio.windGain = audio.ctx.createGain();
      audio.windGain.gain.value = 0;
      audio.windSrc.connect(windFilter);
      windFilter.connect(audio.windGain);
      audio.windGain.connect(audio.ctx.destination);
      audio.windSrc.start();
      audio.started = true;
    } catch { /* audio unavailable — game still plays */ }
  };

  audio.update = function update(throttle, speed, onGround) {
    if (!audio.started || audio.muted) return;
    const t = audio.ctx.currentTime;
    audio.engineOsc.frequency.setTargetAtTime(45 + throttle * 90 + speed * 0.4, t, 0.1);
    audio.osc2.frequency.setTargetAtTime(45.7 + throttle * 90 + speed * 0.4, t, 0.1);
    audio.engineGain.gain.setTargetAtTime(onGround && throttle < 0.05 ? 0 : 0.05 + throttle * 0.09, t, 0.1);
    audio.windGain.gain.setTargetAtTime(Math.min(0.12, speed * 0.0012), t, 0.2);
  };

  audio.blip = function blip(freq, dur, type, vol) {
    if (!audio.started || audio.muted) return;
    try {
      const o = audio.ctx.createOscillator();
      const g = audio.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.15, audio.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.ctx.currentTime + dur);
      o.connect(g); g.connect(audio.ctx.destination);
      o.start();
      o.stop(audio.ctx.currentTime + dur);
    } catch { /* ignore */ }
  };

  audio.ring = function ring() { audio.blip(880, 0.5, 'sine', 0.2); setTimeout(() => audio.blip(1320, 0.6, 'sine', 0.15), 90); };
  audio.thud = function thud() { audio.blip(70, 0.3, 'triangle', 0.3); };
  audio.alarm = function alarm() { audio.blip(440, 0.25, 'square', 0.08); };
  audio.toggleMute = function toggleMute() {
    audio.muted = !audio.muted;
    if (audio.ctx) audio.ctx.resume();
    return audio.muted;
  };
  return audio;
}
