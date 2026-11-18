export type ThemeId = 'ember' | 'mint' | 'lilac' | 'midnight';

export interface Theme {
  id: ThemeId;
  name: string;
  blurb: string;
  swatch: [string, string];
}

export const THEMES: Theme[] = [
  { id: 'ember', name: 'Ember', blurb: 'Warm paper', swatch: ['#f6f1e7', '#d94e2a'] },
  { id: 'mint', name: 'Mint', blurb: 'Cool studio', swatch: ['#eef2ec', '#16795b'] },
  { id: 'lilac', name: 'Lilac', blurb: 'Soft violet', swatch: ['#f2eef7', '#7a3fd1'] },
  { id: 'midnight', name: 'Midnight', blurb: 'Low light', swatch: ['#14120f', '#ff7a4d'] },
];

const KEY = 'varispeed:theme';

function isThemeId(value: string | null): value is ThemeId {
  return !!value && THEMES.some((theme) => theme.id === value);
}

/** Stored preference, falling back to the warm default. */
export function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    /* storage can be blocked in private mode */
  }
  return 'ember';
}

export function applyTheme(id: ThemeId): void {
  const theme = THEMES.find((item) => item.id === id) ?? THEMES[0];
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.swatch[0]);
  try {
    localStorage.setItem(KEY, theme.id);
  } catch {
    /* not fatal: the theme still applies for this session */
  }
}

/** Apply the saved theme before React paints, so a reload never flashes the default. */
export function initTheme(): ThemeId {
  const id = loadTheme();
  applyTheme(id);
  return id;
}
