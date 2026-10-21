// ボタンの絵（自作の図形）

type IconProps = { name: IconName };

export type IconName =
  | 'play'
  | 'pause'
  | 'undo'
  | 'redo'
  | 'plus'
  | 'minus'
  | 'fit'
  | 'open'
  | 'save'
  | 'new'
  | 'theme'
  | 'keys'
  | 'film'
  | 'add'
  | 'trash'
  | 'next'
  | 'back'
  | 'info'
  | 'join'
  | 'scissors'
  | 'image'
  | 'music'
  | 'bell'
  | 'fade'
  | 'stop';

const PATHS: Record<IconName, string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  undo: 'M9 7H5V3M5.5 7.5A8 8 0 1 1 4 13',
  redo: 'M15 7h4V3M18.5 7.5A8 8 0 1 0 20 13',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  open: 'M3 7h6l2 2h10v10H3zM3 7V5h6',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  new: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6',
  theme: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
  keys: 'M3 7h18v10H3zM6 10h1M9 10h1M12 10h1M15 10h1M18 10h0M7 14h10',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  add: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  next: 'M9 5l7 7-7 7',
  back: 'M15 5l-7 7 7 7',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 11v6M12 7.5v.5',
  join: 'M4 12h6M14 12h6M10 8l4 4-4 4',
  scissors: 'M6 6a2.5 2.5 0 1 0 0 .1M6 18a2.5 2.5 0 1 0 0 .1M8 7.5l12 9M8 16.5l12-9',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 8.5a1 1 0 1 0 0 .1',
  music: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0M19 16a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  fade: 'M3 18L12 6l9 12M3 18h18',
  stop: 'M7 7h10v10H7z',
};

const FILLED: Partial<Record<IconName, boolean>> = { play: true, pause: true, stop: true };

export function Icon({ name }: IconProps) {
  const filled = FILLED[name];
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
