export interface PlayerProfile {
  id:string; displayName:string; walletAddress:string|null; ensName:string|null;
  kind:'wallet'|'demo'; completed:number[];
}
export interface AuthState { user:PlayerProfile|null; demoEnabled:boolean }
