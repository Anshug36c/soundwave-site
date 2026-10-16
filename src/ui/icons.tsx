/**
 * Inline SVG icon set. No icon font or network request — the built site is fully self-contained,
 * which matters for GitHub Pages and for offline/PWA use. Icons follow the Material symbol shapes
 * the Android app uses so the two builds read the same.
 */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Filled variant for transport glyphs (play/pause/skip) where a solid shape reads better. */
function SvgFilled({ size = 24, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconPlay = (p: P) => (
  <SvgFilled {...p}>
    <path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l11.03-6.86a1.03 1.03 0 0 0 0-1.76L9.56 4.26A1.03 1.03 0 0 0 8 5.14Z" />
  </SvgFilled>
);
export const IconPause = (p: P) => (
  <SvgFilled {...p}>
    <rect x="6" y="4" width="4" height="16" rx="1.2" />
    <rect x="14" y="4" width="4" height="16" rx="1.2" />
  </SvgFilled>
);
export const IconNext = (p: P) => (
  <SvgFilled {...p}>
    <path d="M6 5.5v13c0 .78.86 1.25 1.52.83l9.1-6.5a1 1 0 0 0 0-1.66l-9.1-6.5A1 1 0 0 0 6 5.5Z" />
    <rect x="17" y="4.5" width="2.4" height="15" rx="1.1" />
  </SvgFilled>
);
export const IconPrev = (p: P) => (
  <SvgFilled {...p}>
    <path d="M18 5.5v13c0 .78-.86 1.25-1.52.83l-9.1-6.5a1 1 0 0 1 0-1.66l9.1-6.5A1 1 0 0 1 18 5.5Z" />
    <rect x="4.6" y="4.5" width="2.4" height="15" rx="1.1" />
  </SvgFilled>
);
export const IconShuffle = (p: P) => (
  <Svg {...p}>
    <path d="M16 3h5v5" />
    <path d="M4 20 21 3" />
    <path d="M21 16v5h-5" />
    <path d="m15 15 6 6" />
    <path d="M4 4l5 5" />
  </Svg>
);
export const IconRepeat = (p: P) => (
  <Svg {...p}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </Svg>
);
export const IconRepeatOne = (p: P) => (
  <Svg {...p}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    <path d="M11 10h1v4" strokeWidth={1.6} />
  </Svg>
);
export const IconHeart = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Svg {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  </Svg>
);
export const IconQueue = (p: P) => (
  <Svg {...p}>
    <path d="M3 6h13M3 12h13M3 18h9" />
    <path d="m18 15 4 3-4 3z" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
);
export const IconLibrary = (p: P) => (
  <Svg {...p}>
    <path d="M3 5v14" />
    <path d="M8 3v18" />
    <rect x="12" y="4" width="9" height="16" rx="2" />
  </Svg>
);
export const IconPlaylist = (p: P) => (
  <Svg {...p}>
    <path d="M3 7h11M3 12h11M3 17h7" />
    <path d="M17 12v6.5" />
    <circle cx="19.5" cy="18.5" r="2" fill="currentColor" stroke="none" />
    <path d="m16 6 5 1.5-5 1.5z" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconTaste = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v3M12 18v3M4.2 7.2l2.1 2.1M17.7 14.7l2.1 2.1M3 12h3M18 12h3M4.2 16.8l2.1-2.1M17.7 9.3l2.1-2.1" />
    <circle cx="12" cy="12" r="3.2" />
  </Svg>
);
export const IconEqualizer = (p: P) => (
  <Svg {...p}>
    <path d="M5 21V9M5 5V3M12 21v-8M12 9V3M19 21v-4M19 13V3" />
    <circle cx="5" cy="7" r="2" />
    <circle cx="12" cy="11" r="2" />
    <circle cx="19" cy="15" r="2" />
  </Svg>
);
export const IconSettings = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.61.66 1.06 1.29 1.09H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconFolder = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-7.5l-2-2.5H4A1 1 0 0 0 3 5.5v13.5a1 1 0 0 0 1 1Z" />
  </Svg>
);
export const IconUpload = (p: P) => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M12 4v12" />
  </Svg>
);
export const IconLink = (p: P) => (
  <Svg {...p}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);
export const IconChevronUp = (p: P) => (
  <Svg {...p}>
    <path d="m18 15-6-6-6 6" />
  </Svg>
);
export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const IconVolume = (p: P) => (
  <Svg {...p}>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
  </Svg>
);
export const IconMore = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="5" r="1.6" fill="currentColor" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    <circle cx="12" cy="19" r="1.6" fill="currentColor" />
  </Svg>
);
export const IconMusic = (p: P) => (
  <Svg {...p}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Svg>
);
export const IconWave = (p: P) => (
  <Svg {...p} strokeWidth={2.4}>
    <path d="M3 12h2M7 8v8M11 4v16M15 7v10M19 10v4M21 12h0" />
  </Svg>
);
export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m20 6-11 11-5-5" />
  </Svg>
);
export const IconSave = (p: P) => (
  <Svg {...p}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </Svg>
);
export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5M12 15V3" />
  </Svg>
);
export const IconGithub = (p: P) => (
  <Svg {...p}>
    <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
  </Svg>
);
