import { WHOAMI } from '../../config';

/**
 * Card images: whatever comes in (file, pasted image, link) is drawn into a canvas no bigger than
 * WHOAMI.cardPx and leaves as a JPEG data URL. It only ever lives in memory and goes straight to
 * the other players; nothing is uploaded anywhere.
 */
function toDataUrl(img: CanvasImageSource, w: number, h: number): string {
  const k = Math.min(1, WHOAMI.cardPx / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const x = c.getContext('2d')!;
  // JPEG has no transparency: a light card background shows through transparent PNGs.
  x.fillStyle = '#f2f2ee';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', WHOAMI.cardQuality);
}

export async function cardFromBlob(blob: Blob): Promise<string> {
  if (!blob.type.startsWith('image/')) throw new Error('Das ist kein Bild.');
  const bmp = await createImageBitmap(blob);
  try {
    return toDataUrl(bmp, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
}

/**
 * Links only work when the image host allows other sites to read the picture (CORS); otherwise the
 * browser refuses to hand out the pixels. Then the message says how to get it in anyway.
 */
export function cardFromUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url.trim());
    } catch {
      reject(new Error('Das ist kein gültiger Link.'));
      return;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      reject(new Error('Nur http- und https-Links.'));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      try {
        resolve(toDataUrl(img, img.naturalWidth, img.naturalHeight));
      } catch {
        reject(new Error('Diese Seite gibt das Bild nicht frei. Rechtsklick aufs Bild → „Bild kopieren“ und hier einfügen.'));
      }
    };
    img.onerror = () => reject(new Error('Bild ließ sich nicht laden. Rechtsklick aufs Bild → „Bild kopieren“ und hier einfügen, oder herunterladen und reinziehen.'));
    img.src = u.href;
  });
}

/** Card payload from a peer: only our own format (JPEG data URL) and within size. */
export function parseCardData(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > WHOAMI.cardMaxChars) return null;
  return /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v) ? v : null;
}

/** Placeholder cards for the test bots: an emoji and a word on a coloured card. */
const BOT_CARDS: [string, string, string][] = [
  ['🦆', 'Quietscheente', '#ffd21f'],
  ['🥒', 'Gurke', '#6bbf3a'],
  ['🍍', 'Ananas', '#f2b23a'],
  ['🐔', 'Huhn', '#f06aa8'],
  ['🚇', 'U-Bahn', '#4f8dff'],
  ['🥨', 'Brezel', '#d9a06b'],
  ['🦔', 'Igel', '#9bd0a0'],
];

export function botCard(i: number): string {
  const [emoji, word, bg] = BOT_CARDS[i % BOT_CARDS.length];
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = bg;
  x.fillRect(0, 0, 256, 256);
  x.font = '120px system-ui, "Noto Color Emoji", sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(emoji, 128, 112);
  x.font = 'bold 28px system-ui, sans-serif';
  x.fillStyle = '#111';
  x.fillText(word, 128, 214);
  return c.toDataURL('image/jpeg', WHOAMI.cardQuality);
}
