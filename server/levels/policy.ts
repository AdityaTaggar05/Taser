import type { PlayerProfile } from '../../src/auth/types';
export function campaignPublisher(user: PlayerProfile, demoEnabled: boolean) {
  if (user.kind === 'demo') return demoEnabled && user.campaignPublisher === true;
  const allowed = (process.env.CAMPAIGN_PUBLISHER_WALLETS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s));
  return !!user.walletAddress && allowed.includes(user.walletAddress.toLowerCase());
}
