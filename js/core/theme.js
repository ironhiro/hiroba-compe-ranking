// 대회별 색 테마. 기준색 2개만 받고 나머지는 CSS(color-mix)에서 계산한다.
//
// event.json
//   "theme": {
//     "brand": "#45a5db",   배경·강조색 (보통 로고 배경색)
//     "ink":   "#035778",   테두리·진한 강조색 (흰 바탕 위에서 읽혀야 함)
//     "onBrand": "#fff"     (선택) brand 위 글자색을 직접 지정
//   }

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#14212b';
// 이 밝기보다 밝은 배경에는 진한 글자. 중간 톤(현재 하늘색 등)은 흰 글자 + 그림자로 읽히게 한다.
const LIGHT_BACKGROUND_LUMINANCE = 0.45;
const MIN_INK_CONTRAST = 4.5;

export const DEFAULT_THEME = Object.freeze({ brand: '#45a5db', ink: '#035778' });

const validHex = (value) => (typeof value === 'string' && HEX_RE.test(value.trim()) ? value.trim() : null);

const toRgb = (hex) => {
  const digits = hex.slice(1);
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
};

/** WCAG 상대 휘도 */
export function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const textOn = (background) => (luminance(background) > LIGHT_BACKGROUND_LUMINANCE ? DARK_TEXT : LIGHT_TEXT);

/** 테마를 문서에 적용한다. 잘못된 값은 기본 테마로 대체하고 경고를 남긴다. */
export function applyTheme(theme, root = document.documentElement) {
  const brand = validHex(theme?.brand) ?? DEFAULT_THEME.brand;
  const ink = validHex(theme?.ink) ?? DEFAULT_THEME.ink;
  const onBrand = validHex(theme?.onBrand) ?? textOn(brand);

  root.style.setProperty('--brand', brand);
  root.style.setProperty('--brand-ink', ink);
  root.style.setProperty('--on-brand', onBrand);
  root.style.setProperty('--on-ink', textOn(ink));
  // 흰 글자일 때만 진한 그림자로 윤곽을 준다.
  root.style.setProperty('--brand-shadow', onBrand.toLowerCase() === LIGHT_TEXT ? `0 2px 0 ${ink}` : 'none');

  if (theme?.brand && !validHex(theme.brand)) console.warn(`theme.brand 값이 올바른 색이 아닙니다: ${theme.brand}`);
  if (theme?.ink && !validHex(theme.ink)) console.warn(`theme.ink 값이 올바른 색이 아닙니다: ${theme.ink}`);
  if (contrastRatio(ink, LIGHT_TEXT) < MIN_INK_CONTRAST) {
    console.warn(`theme.ink(${ink})가 흰 바탕에서 잘 안 보입니다 (대비 ${contrastRatio(ink, LIGHT_TEXT).toFixed(1)}:1, 권장 ${MIN_INK_CONTRAST}:1 이상).`);
  }
  return { brand, ink, onBrand };
}

// 대회별 폰트. 지정이 없으면 기본 폰트를 그대로 쓴다.
//
// event.json
//   "font": { "family": "Paperlogy", "src": "assets/font.ttf" }

const FONT_STYLE_ID = 'event-font-face';
const FONT_FAMILY_RE = /^[\p{L}\p{N} _-]{1,64}$/u;
const FONT_SRC_RE = /^[\w./-]+\.(?:woff2?|ttf|otf)$/i;
const FONT_FORMATS = Object.freeze({ woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' });

export function applyFont(font, root = document.documentElement) {
  if (!font) return null;
  const family = typeof font.family === 'string' ? font.family.trim() : '';
  const src = typeof font.src === 'string' ? font.src.trim() : '';
  if (!FONT_FAMILY_RE.test(family) || !FONT_SRC_RE.test(src) || src.includes('..')) {
    console.warn('font 설정이 올바르지 않습니다 (family: 글자·숫자·공백, src: 사이트 안의 woff2/woff/ttf/otf 경로).', font);
    return null;
  }
  const format = FONT_FORMATS[src.split('.').pop().toLowerCase()];
  document.getElementById(FONT_STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = FONT_STYLE_ID;
  // 굵기 범위를 넓게 선언해 <strong> 등에서 가짜 굵게(faux bold)가 겹치지 않게 한다.
  style.textContent = `@font-face { font-family: "${family}"; src: url("${src}") format("${format}"); font-weight: 100 900; font-display: swap; }`;
  document.head.append(style);
  root.style.setProperty('--event-font', `"${family}", "Pretendard"`);
  return family;
}
