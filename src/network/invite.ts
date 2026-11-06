/** Six readable characters; omit I/O/0/1 to avoid transcription mistakes. */
export const INVITE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_LENGTH=6;
export const INVITE_PATTERN='[A-HJ-NP-Za-hj-np-z2-9]{6}';
const validCode=new RegExp('^'+INVITE_PATTERN+'$');
export function normalizeInviteCode(value:unknown):string|null {
  if(typeof value!=='string')return null;
  const code=value.trim().toUpperCase();
  return validCode.test(code)?code:null;
}
