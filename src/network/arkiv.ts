/** Public activity contains no move inputs, account IDs, layouts or RPC credentials. */
export interface ArkivActivity {
  id: string;
  kind: 'draft' | 'community' | 'campaign' | 'run' | 'move' | 'attempt';
  label: string;
  createdAt: number;
  state: 'pending' | 'confirmed' | 'failed';
  txHash?: string;
  entityKey?: string;
  message?: string;
}
export interface ArkivFeed {
  storage: 'arkiv' | 'test' | 'unconfigured';
  activities: ArkivActivity[];
}
export const ARKIV_NETWORK = {
  name: 'Rabdi',
  chainId: 7794095,
  explorer: 'https://rabdi.explorer.arkiv.network',
};
export function explorerLink(kind: 'tx' | 'entity', value?: string) {
  return value && /^0x[a-fA-F0-9]{64}$/.test(value)
    ? `${ARKIV_NETWORK.explorer}/${kind}/${value}`
    : undefined;
}

export interface PairedMove {
  sequence: number;
  turn: number;
  state: 'pending' | 'confirmed' | 'failed' | 'unavailable';
  inputs?: [import('../core/types').Direction, import('../core/types').Direction];
  txHash?: string;
  entityKey?: string;
}
export interface MoveSequenceFeed {
  storage: ArkivFeed['storage'];
  moves: PairedMove[];
}
