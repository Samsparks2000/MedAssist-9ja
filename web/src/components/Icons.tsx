import type { ReactElement, SVGProps } from 'react';

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
type P = SVGProps<SVGSVGElement>;
const make = (paths: ReactElement) => (p: P) => <svg width={20} height={20} {...base} {...p}>{paths}</svg>;

export const SearchIcon = make(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const PhoneIcon = make(<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />);
export const RouteIcon = make(<path d="M3 11l19-9-9 19-2-8-8-2z" />);
export const PinIcon = make(<><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></>);
export const BellIcon = make(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>);
export const AlertIcon = make(<><path d="M12 2 1 21h22L12 2z" /><path d="M12 9v5M12 17.5v.5" /></>);
export const CheckIcon = make(<path d="m5 12 5 5L20 7" />);
export const HomeIcon = make(<><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" /></>);
export const ReceiptIcon = make(<><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" /></>);
export const UserIcon = make(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>);
export const PulseIcon = make(<path d="M3 12h4l2-5 4 10 2-5h6" />);
export const MapIcon = make(<><path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></>);
export const BackIcon = make(<path d="m15 18-6-6 6-6" />);
export const CardIcon = make(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h3" /></>);
export const BankIcon = make(<><path d="M3 10 12 4l9 6" /><path d="M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" /></>);
export const MobileIcon = make(<><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>);
export const LockIcon = make(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>);
export const UploadIcon = make(<><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></>);
export const FileIcon = make(<><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4" /></>);
export const ImageIcon = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>);
export const ClockIcon = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const XIcon = make(<path d="M6 6l12 12M18 6 6 18" />);
export const LocateIcon = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>);
export const MenuIcon = make(<path d="M4 6h16M4 12h16M4 18h16" />);
export const ShieldIcon = make(<><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>);
export const PlusIcon = make(<path d="M12 5v14M5 12h14" />);

const needPaths: Record<string, ReactElement> = {
  drug: <><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)" /><path d="m9 9 6 6" /></>,
  equipment: <><rect x="4" y="4" width="16" height="12" rx="2" /><path d="M7 10h3l1.5-3 2 6 1.5-3H17M9 20h6M12 16v4" /></>,
  doctor: <><path d="M6 3v6a5 5 0 0 0 10 0V3" /><path d="M11 14v2a5 5 0 0 0 10 0v-3" /><circle cx="21" cy="11" r="2" /></>,
  bed: <><path d="M3 7v12M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6" /><circle cx="7" cy="11" r="2" /></>,
  oxygen: <><rect x="8" y="6" width="8" height="15" rx="4" /><path d="M10 6V3h4v3M12 11v5" /></>,
  open: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  pharmacy: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8M8 12h8" /></>,
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" />,
};

export function NeedIcon({ name, ...p }: P & { name: string }) {
  return <svg width={26} height={26} {...base} {...p}>{needPaths[name] ?? needPaths.pharmacy}</svg>;
}

export function LogoMark() {
  return (
    <span className="mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z" fill="currentColor" /></svg>
    </span>
  );
}
