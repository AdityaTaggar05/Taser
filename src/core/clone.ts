/** Levels and snapshots are bounded JSON data; QuickJS does not provide every browser global. */
export function cloneData<T>(value:T):T{
  const native=(globalThis as {structuredClone?:<U>(input:U)=>U}).structuredClone;
  return typeof native==='function'?native(value):JSON.parse(JSON.stringify(value)) as T;
}
