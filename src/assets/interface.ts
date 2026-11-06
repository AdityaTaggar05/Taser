import type { PlayerProfile } from '../auth/types';
import { applyThemeVariables, type ThemePack } from './catalog';
import { applySprite, spriteElement } from './dom';
/** Decorate existing screens with the same semantic pack; screen logic stays independent. */
export function applyThemeInterface(
  pack: ThemePack,
  user: PlayerProfile | null,
  status?: string,
  partnerReady = false,
) {
  applyThemeVariables(pack);
  document.querySelectorAll<HTMLElement>('.home-brand>span,.wordmark>.mark').forEach((el) => {
    el.textContent = '';
    applySprite(el, pack, 'ui.emblem');
  });
  const avatar =
    user?.kind === 'demo'
      ? user.displayName.toLowerCase() === 'nova'
        ? 'avatar.demo.nova'
        : 'avatar.demo.atlas'
      : 'avatar.default';
  document.querySelectorAll<HTMLElement>('.guest-avatar').forEach((el) => {
    el.textContent = '';
    applySprite(el, pack, avatar);
  });
  const profile = document.querySelector('#home-profile');
  if (profile) {
    let el = profile.querySelector<HTMLElement>('.theme-profile-avatar');
    if (!el) {
      el = spriteElement(pack, avatar, 'theme-profile-avatar');
      profile.querySelector('h2')?.before(el);
    } else applySprite(el, pack, avatar);
  }
  const wallet = document.querySelector('.signin-wallet');
  if (wallet && !wallet.querySelector('.theme-wallet-icon'))
    wallet.prepend(spriteElement(pack, 'ui.wallet', 'theme-wallet-icon'));
  document
    .querySelectorAll<HTMLElement>('.theme-wallet-icon')
    .forEach((el) => applySprite(el, pack, 'ui.wallet'));
  document.querySelectorAll<HTMLElement>('[data-demo]').forEach((button) => {
    let el = button.querySelector<HTMLElement>('.theme-demo-avatar');
    const id = button.dataset.demo === 'nova' ? 'avatar.demo.nova' : 'avatar.demo.atlas';
    if (!el) {
      el = spriteElement(pack, id, 'theme-demo-avatar');
      button.prepend(el);
    } else applySprite(el, pack, id);
  });
  document
    .querySelectorAll<HTMLElement>('.role-options [data-player],.mode-roles [data-player]')
    .forEach((button) => {
      const id = `player.p${button.dataset.player}.idle.south.0`;
      let el = button.querySelector<HTMLElement>('.theme-role-operator');
      if (!el) {
        el = spriteElement(pack, id, 'theme-role-operator');
        button.prepend(el);
      } else applySprite(el, pack, id);
    });
  document.querySelectorAll<HTMLElement>('.party-members [data-party-player]').forEach((card) => {
    const id = `player.p${card.dataset.partyPlayer}.idle.south.0`;
    let el = card.querySelector<HTMLElement>('.theme-party-operator');
    if (!el) {
      el = spriteElement(pack, id, 'theme-party-operator');
      card.prepend(el);
    } else applySprite(el, pack, id);
  });
  const statusId =
    status === 'full'
      ? 'status.full'
      : status === 'connecting'
        ? 'status.connecting'
        : status === 'connected'
          ? partnerReady
            ? 'status.ready'
            : 'status.waiting'
          : 'status.reconnecting';
  for (const [selector, id] of [
    ['#connection', statusId],
    ['#peer-status', partnerReady ? 'status.ready' : 'status.waiting'],
  ] as const) {
    const target = document.querySelector(selector);
    if (target && !target.querySelector('.theme-status-icon'))
      target.prepend(spriteElement(pack, id, 'theme-status-icon'));
    else {
      const icon = target?.querySelector<HTMLElement>('.theme-status-icon');
      if (icon) applySprite(icon, pack, id);
    }
  }
}
