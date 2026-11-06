import { makeTar, type UploadBundle, type UploadFile } from './swarm-theme';
/** One manifest probe, then complete PNG groups below the public UI's 10 MB limit. */
export function splitPublicBundle(bundle: UploadBundle, maxBytes = 8_000_000): UploadBundle[] {
  const manifest = bundle.files.find((f) => f.name === 'manifest.json');
  if (!manifest) throw new Error('Missing manifest');
  const pack = (files: UploadFile[]): UploadBundle => ({ ...bundle, files, tar: makeTar(files) });
  const result = [pack([manifest])];
  let group = [manifest];
  for (const file of bundle.files
    .filter((f) => f.name !== 'manifest.json')
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (pack([manifest, file]).tar.length > maxBytes)
      throw new Error('Sheet exceeds public upload boundary');
    if (pack([...group, file]).tar.length > maxBytes) {
      result.push(pack(group));
      group = [manifest];
    }
    group.push(file);
  }
  if (group.length > 1) result.push(pack(group));
  return result;
}
