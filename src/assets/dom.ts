import { resolveSprite, type ThemePack } from './catalog';
/** Same manifest and source rectangles as Phaser. No standalone icon paths in UI code. */
export function applySprite(element: HTMLElement, pack: ThemePack, id: string) {
  const { sprite, url } = resolveSprite(pack, id),
    r = sprite.frame,
    sheet = pack.manifest.sheets[sprite.sheet];
  element.style.setProperty('--sprite-ratio', String(r.w / r.h));
  element.dataset.sprite = id;
  element.classList.add('theme-sprite');
  element.style.backgroundImage = `url("${url}")`;
  element.style.backgroundSize = `${(sheet.width / r.w) * 100}% ${(sheet.height / r.h) * 100}%`;
  element.style.backgroundPosition = `${sheet.width === r.w ? 0 : (r.x / (sheet.width - r.w)) * 100}% ${sheet.height === r.h ? 0 : (r.y / (sheet.height - r.h)) * 100}%`;
  element.setAttribute('aria-hidden', 'true');
}
export function spriteElement(pack: ThemePack, id: string, className = '') {
  const el = document.createElement('span');
  el.className = className;
  applySprite(el, pack, id);
  return el;
}
