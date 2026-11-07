export type PlayOptions = {
  players: 'solo' | 'coop';
  collection: 'campaign' | 'community';
  role: 1 | 2;
};
export const playOptions: PlayOptions = { players: 'solo', collection: 'campaign', role: 1 };
try {
  const saved = JSON.parse(sessionStorage.getItem('weldpoint:options') ?? '{}');
  if (['solo', 'coop'].includes(saved.players)) playOptions.players = saved.players;
  if (['campaign', 'community'].includes(saved.collection))
    playOptions.collection = saved.collection;
  if ([1, 2].includes(saved.role)) playOptions.role = saved.role;
} catch {}
export function saveOptions() {
  try {
    sessionStorage.setItem('weldpoint:options', JSON.stringify(playOptions));
  } catch {}
}
