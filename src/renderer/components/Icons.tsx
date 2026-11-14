const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, viewBox: "0 0 24 24", "aria-hidden": true };

export const IconLive = () => (<svg {...base}><path d="M3 12h4l3 -7 4 14 3 -7h4" /></svg>);
export const IconBoost = () => (<svg {...base}><path d="M13 3 5 14h6l-1 7 8 -11h-6z" /></svg>);
export const IconSessions = () => (<svg {...base}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 15l3 -4 3 2 4 -5" /></svg>);
export const IconDrivers = () => (<svg {...base}><rect x="6" y="6" width="12" height="12" rx="1.5" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></svg>);
export const IconAssistant = () => (<svg {...base}><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8 -4.7L5.5 9.5l4.7 -1.8z" /><path d="M18.5 15.5l.8 2 2 .8 -2 .8 -.8 2 -.8 -2 -2 -.8 2 -.8z" /></svg>);
export const IconSettings = () => (<svg {...base}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1 -2.8 2.8l-.1 -.1a1.7 1.7 0 0 0 -1.8 -.3 1.7 1.7 0 0 0 -1 1.5V21a2 2 0 1 1 -4 0v-.1a1.7 1.7 0 0 0 -1.1 -1.5 1.7 1.7 0 0 0 -1.8 .3l-.1 .1a2 2 0 1 1 -2.8 -2.8l.1 -.1a1.7 1.7 0 0 0 .3 -1.8 1.7 1.7 0 0 0 -1.5 -1H3a2 2 0 1 1 0 -4h.1a1.7 1.7 0 0 0 1.5 -1.1 1.7 1.7 0 0 0 -.3 -1.8l-.1 -.1a2 2 0 1 1 2.8 -2.8l.1 .1a1.7 1.7 0 0 0 1.8 .3H9a1.7 1.7 0 0 0 1 -1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8 -.3l.1 -.1a2 2 0 1 1 2.8 2.8l-.1 .1a1.7 1.7 0 0 0 -.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0 -1.5 1z" /></svg>);
export const IconFan = () => (<svg {...base}><circle cx="12" cy="12" r="1.8" /><path d="M12 10.2c0 -3 .8 -6.2 3.6 -6.2 2.4 0 2.6 3.6 -.6 5.4M13.8 12c3 0 6.2 .8 6.2 3.6 0 2.4 -3.6 2.6 -5.4 -.6M12 13.8c0 3 -.8 6.2 -3.6 6.2 -2.4 0 -2.6 -3.6 .6 -5.4M10.2 12c-3 0 -6.2 -.8 -6.2 -3.6 0 -2.4 3.6 -2.6 5.4 .6" /></svg>);
export const IconLight = () => (<svg {...base}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0 -3.5 10.9c.6 .5 1 1.2 1 2V16h5v-.1c0 -.8 .4 -1.5 1 -2A6 6 0 0 0 12 3z" /></svg>);
export const IconCheck = () => (<svg {...base} strokeWidth={2.4}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>);
export const IconX = () => (<svg {...base} width={12} height={12} strokeWidth={2.4}><path d="M6 6l12 12M18 6L6 18" /></svg>);
export const IconExternal = () => (<svg {...base} width={14} height={14}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1 -1 1H5a1 1 0 0 1 -1 -1V7a1 1 0 0 1 1 -1h5" /></svg>);

export const BrandMark = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden>
    <path d="M5.6 18.4A9 9 0 0 1 18.4 5.6" fill="none" stroke="var(--cpu)" strokeWidth="2.6" strokeLinecap="round" />
    <path d="M20.5 9.2A9 9 0 0 1 20.5 14.8" fill="none" stroke="var(--gpu)" strokeWidth="2.6" strokeLinecap="round" />
    <circle cx="12" cy="12" r="2.4" fill="var(--ink)" />
  </svg>
);
