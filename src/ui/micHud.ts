import type { Voice } from '../audio/voice';
import { el } from './dom';
import { settings } from './store';

/** Bottom-left mic state while playing: is my voice going out, and how loud. */
export class MicHud {
  private root = el('div', 'mic');
  private text = el('span');
  private bar = el('span', 'mic-bar');

  constructor(
    host: HTMLElement,
    private voice: Voice,
  ) {
    this.root.setAttribute('role', 'status');
    this.bar.append(el('i'));
    this.root.append(this.text, this.bar);
    host.append(this.root);
  }

  update(hidden: boolean): void {
    this.root.hidden = hidden;
    if (hidden) return;
    const v = this.voice;
    let text: string;
    let warn = false;
    let level = 0;
    switch (v.micState) {
      case 'off':
        text = 'Mikro aus';
        break;
      case 'starting':
        text = 'Mikro wird gestartet …';
        break;
      case 'blocked':
        text = 'Mikro blockiert · im Browser erlauben';
        warn = true;
        break;
      case 'missing':
        text = 'Kein Mikro gefunden';
        warn = true;
        break;
      case 'error':
        text = 'Mikro-Fehler';
        warn = true;
        break;
      default:
        if (v.muted) {
          text = 'Stumm · M';
          warn = true;
        } else if (settings.voiceMode === 'ptt' && !v.pttHeld) text = 'V halten zum Sprechen';
        else if (settings.voiceMode === 'auto' && !v.gateIsOpen) {
          text = 'Mikro · Automatisch';
          level = v.micLevel(true);
        } else {
          text = 'Mikro';
          level = v.micLevel();
        }
    }
    if (this.text.textContent !== text) this.text.textContent = text;
    this.root.classList.toggle('warn', warn);
    this.bar.hidden = v.micState !== 'on' || v.muted || (settings.voiceMode === 'ptt' && !v.pttHeld);
    this.bar.classList.toggle('gated', settings.voiceMode === 'auto' && !v.gateIsOpen);
    this.bar.style.setProperty('--l', level.toFixed(3));
  }
}
