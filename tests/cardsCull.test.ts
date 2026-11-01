import { describe, expect, it } from 'vitest';
import { cardHeight, cardOnScreen } from '../src/game/whoami/cardsView';

describe('cardsView: head card visibility', () => {
  const W = 1000;
  const H = 600;

  it('shows a card that is fully inside', () => {
    expect(cardOnScreen(500, 300, 100, 120, W, H)).toBe(true);
  });

  it('keeps a big card visible after its anchor (bottom edge) left the bottom of the screen', () => {
    expect(cardOnScreen(500, H + 50, 300, 400, W, H)).toBe(true);
    expect(cardOnScreen(500, H + 50, 300, 40, W, H)).toBe(false);
  });

  it('keeps a card visible while only a sliver is on screen at any side', () => {
    expect(cardOnScreen(-90, 300, 200, 100, W, H)).toBe(true); // right edge at x = 10
    expect(cardOnScreen(W + 90, 300, 200, 100, W, H)).toBe(true); // left edge at x = W - 10
    expect(cardOnScreen(500, 10, 100, 100, W, H)).toBe(true); // bottom edge 10px into the screen
    expect(cardOnScreen(500, H + 90, 100, 100, W, H)).toBe(true); // top edge at y = H - 10
  });

  it('hides a card that is completely off screen on every side', () => {
    expect(cardOnScreen(-100, 300, 200, 100, W, H)).toBe(false);
    expect(cardOnScreen(W + 100, 300, 200, 100, W, H)).toBe(false);
    expect(cardOnScreen(500, 0, 100, 100, W, H)).toBe(false); // above the top
    expect(cardOnScreen(500, H + 100, 100, 100, W, H)).toBe(false); // below the bottom
  });

  it('card height: picture plus name strip and borders', () => {
    expect(cardHeight(106, 1, 10)).toBeCloseTo(100 + 15.5 + 6);
    expect(cardHeight(106, 2, 10)).toBeLessThan(cardHeight(106, 1, 10));
  });
});
