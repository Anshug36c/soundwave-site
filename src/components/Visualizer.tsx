/**
 * Canvas visualiser fed by the DspGraph's AnalyserNode. Two styles: mirrored frequency bars and a
 * time-domain waveform, both tinted with the launcher's cyan→violet gradient. Drawn only while
 * playing to avoid burning frames on a paused sheet.
 */
import { useEffect, useRef } from 'react';
import { store } from '../state/store';
import { AudioEngine } from '../audio/engine';

interface Props {
  style: 'bars' | 'wave' | 'off';
  playing: boolean;
  className?: string;
}

// The engine is a singleton owned by the store; grab its graph through a small accessor.
let engineRef: AudioEngine | null = null;
export function setVisualizerEngine(e: AudioEngine): void {
  engineRef = e;
}

export function Visualizer({ style, playing, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (style === 'off' || !playing || !engineRef) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = engineRef.graph.analyser;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const timeDomain = new Uint8Array(analyser.fftSize);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const gradient = () => {
      const rect = canvas.getBoundingClientRect();
      const g = ctx.createLinearGradient(0, 0, rect.width, 0);
      g.addColorStop(0, '#59D9FF');
      g.addColorStop(1, '#A58BFF');
      return g;
    };

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      if (style === 'bars') {
        analyser.getByteFrequencyData(bins as Uint8Array<ArrayBuffer>);
        const barCount = Math.min(64, Math.floor(w / 6));
        const step = Math.floor(bins.length / 2 / barCount) || 1;
        const gap = 2;
        const barW = Math.max(2, w / barCount - gap);
        ctx.fillStyle = gradient();
        for (let i = 0; i < barCount; i++) {
          const v = bins[i * step] / 255;
          const bh = Math.max(2, v * h);
          const x = i * (barW + gap);
          const y = h - bh;
          roundRect(ctx, x, y, barW, bh, Math.min(barW / 2, 3));
          ctx.fill();
        }
      } else {
        analyser.getByteTimeDomainData(timeDomain as Uint8Array<ArrayBuffer>);
        ctx.lineWidth = 2;
        ctx.strokeStyle = gradient();
        ctx.beginPath();
        const slice = w / timeDomain.length;
        let x = 0;
        for (let i = 0; i < timeDomain.length; i++) {
          const v = timeDomain[i] / 128.0;
          const y = (v * h) / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += slice;
        }
        ctx.stroke();
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [style, playing]);

  // Re-read style/playing from the store so parent re-renders keep us honest.
  void store;

  if (style === 'off') return null;
  return <canvas ref={canvasRef} className={className} />;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, 0);
  ctx.arcTo(x, y + h, x, y, 0);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
