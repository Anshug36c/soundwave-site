/**
 * Dominant-colour extraction for the player backdrop — the web counterpart
 * of the app's Palette-based player gradient (PlayerColorExtractor). Draws
 * the artwork tiny, picks the most saturated bright pixel cluster, and
 * returns a CSS rgb() string. Falls back to the brand violet when the image
 * is missing, still loading, or drawn from a CORS-tainted source.
 */
const cache = new Map<string, string>();
const FALLBACK = '#7c5cff';

export function accentFor(src: string | null | undefined, onReady: (accent: string) => void): string {
  if (!src) return FALLBACK;
  const hit = cache.get(src);
  if (hit) return hit;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      let best = FALLBACK;
      let bestScore = -1;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        rSum += r;
        gSum += g;
        bSum += b;
        n++;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max === 0 ? 0 : (max - min) / max;
        const score = sat * 0.7 + (max / 255) * 0.3;
        if (score > bestScore && max > 40) {
          bestScore = score;
          best = `rgb(${r}, ${g}, ${b})`;
        }
      }
      if (bestScore < 0.12 && n > 0) {
        best = `rgb(${Math.round(rSum / n)}, ${Math.round(gSum / n)}, ${Math.round(bSum / n)})`;
      }
      cache.set(src, best);
      onReady(best);
    } catch {
      /* tainted canvas or decode failure — keep the fallback */
    }
  };
  img.src = src;
  return FALLBACK;
}
