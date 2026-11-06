/** Levels and snapshots are bounded JSON data; QuickJS does not provide every browser global. */
export function cloneData<T>(value:T):T{return typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value)) as T;}
