// A small, consistent set of line icons for the navigation (24×24 grid,
// 1.75 stroke, round joins). Drawn here rather than pulled from an icon
// package so the app takes on no new dependency.
import { ReactNode } from "react";

export type NavIconName =
  | "dashboard" | "calendar" | "leave" | "certificate" | "star" | "book" | "camera" | "checklist"
  | "handshake" | "events" | "target" | "gift" | "pencil" | "clinic" | "users" | "notes" | "swap"
  | "sun" | "shield" | "pin" | "send" | "puzzle" | "giftbox" | "money" | "chart" | "folder"
  | "logout" | "menu" | "close" | "chevron";

const PATHS: Record<NavIconName, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  calendar: <><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>,
  leave: <><path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  certificate: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M7 9h6M7 12h4" /><circle cx="16.5" cy="16" r="2.5" /><path d="M15 18.2 14.5 22l2-1.2 2 1.2-.5-3.8" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  book: <><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z" /><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3" /></>,
  camera: <><path d="M4 7.5h3l1.5-2.5h7L17 7.5h3a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" /></>,
  checklist: <><path d="m3.5 6 1.5 1.5L8 4.5M3.5 12.5 5 14l3-3M3.5 19l1.5 1.5L8 17.5" /><path d="M11.5 6H21M11.5 12.5H21M11.5 19H21" /></>,
  handshake: <><path d="m11 17 2 2a1.4 1.4 0 0 0 2-2" /><path d="m14 14 2.5 2.5a1.4 1.4 0 0 0 2-2l-3.9-3.9a2 2 0 0 0-2.8 0l-.9.9a1.4 1.4 0 0 1-2-2l2.8-2.8a3.5 3.5 0 0 1 4.6-.3l.4.3a3 3 0 0 0 1.8.6H21" /><path d="m21 15-2.5-2.5M3 6.3h2a3 3 0 0 1 2 .8L10 10M3 6.3V15l6 6a1.4 1.4 0 0 0 2-2" /></>,
  events: <><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /><path d="m12 12.5.9 1.9 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.5 2.1-.3z" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" /></>,
  gift: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M12 8v13M12 8S10.5 3.5 8 4.5c-2 .8-1 3.5 4 3.5zM12 8s1.5-4.5 4-3.5c2 .8 1 3.5-4 3.5z" /></>,
  pencil: <><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" /><path d="m14.5 5.5 3 3" /></>,
  clinic: <><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-5h6v5M12 8.5v5M9.5 11h5" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" /></>,
  notes: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  swap: <><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z" /><path d="m9 12 2 2 4-4" /></>,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  send: <><path d="M21 3 10 14" /><path d="m21 3-6.5 18-4.5-7-7-4.5z" /></>,
  puzzle: <path d="M10 4.5a2 2 0 1 1 4 0V6h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 1 0 0 4H19v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 1 0-4 0V20H6a1 1 0 0 1-1-1v-4h1.5a2 2 0 1 0 0-4H5V7a1 1 0 0 1 1-1h4z" />,
  giftbox: <><rect x="4" y="9" width="16" height="12" rx="1.5" /><path d="M3 9h18M12 9v12M12 9c-1.5-3-5-4.5-5-2s3.5 2 5 2zM12 9c1.5-3 5-4.5 5-2s-3.5 2-5 2z" /></>,
  money: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.8" /><path d="M6 9.5v5M18 9.5v5" /></>,
  chart: <><path d="M3.5 3.5v17h17" /><path d="m7.5 15 4-4.5 3 3 5-6" /></>,
  folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" /></>,
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="m9 6 6 6-6 6" />,
};

export function NavIcon({ name, size = 18, className, style }: { name: NavIconName; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>
      {PATHS[name]}
    </svg>
  );
}
