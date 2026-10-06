(function (root) {
  'use strict';
  // One gentle two-tone reminder loop, even when several orders are ready.
  class PickupSound {
    constructor(environment) {
      this.env = environment;
      this.pending = new Set();
      this.nodes = new Set();
      this.enabled = true;
      this.context = null;
      this.timer = null;
    }
    async activate() {
      const AudioContext = this.env.AudioContext || this.env.webkitAudioContext;
      if (!AudioContext) return false;
      try {
        if (!this.context) this.context = new AudioContext();
        if (this.context.state === 'suspended') await this.context.resume();
        return this.context.state === 'running';
      } catch (_) { return false; }
    }
    tone() {
      if (!this.enabled || !this.pending.size || this.context?.state !== 'running') return;
      const context = this.context;
      [880, 1174.66].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + index * 0.23;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.08, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.19);
        oscillator.connect(gain);
        gain.connect(context.destination);
        this.nodes.add(oscillator);
        oscillator.onended = () => {
          this.nodes.delete(oscillator);
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + 0.2);
      });
    }
    begin(id) {
      this.pending.add(String(id));
      if (!this.enabled || this.timer !== null) return;
      void this.activate().then(() => this.tone());
      this.timer = this.env.setInterval(() => this.tone(), 3500);
    }
    stopNodes() {
      for (const oscillator of this.nodes) {
        try { oscillator.stop(); } catch (_) {}
      }
      this.nodes.clear();
    }
    stopLoop() {
      if (this.timer !== null) this.env.clearInterval(this.timer);
      this.timer = null;
      this.stopNodes();
    }
    end(id) {
      this.pending.delete(String(id));
      if (!this.pending.size) this.stopLoop();
    }
    clear() {
      this.pending.clear();
      this.stopLoop();
    }
    setEnabled(enabled) {
      this.enabled = !!enabled;
      if (!this.enabled) this.stopLoop();
      else if (this.pending.size) this.begin(this.pending.values().next().value);
    }
  }
  if (typeof module === 'object' && module.exports) module.exports = PickupSound;
  else root.DenfiPickupSound = new PickupSound(root);
}(typeof window === 'undefined' ? globalThis : window));
