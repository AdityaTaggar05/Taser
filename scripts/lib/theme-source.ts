import { themeSources } from '../../src/assets/sources';
export function themeSourceFromArgs(args = process.argv.slice(2)) {
  const at = args.indexOf('--theme'),
    id = at < 0 ? 'modern-gray' : args[at + 1];
  const source = themeSources.find((source) => source.id === id);
  if (!source)
    throw new Error(
      'Unknown theme. Use --theme ' + themeSources.map((source) => source.id).join('|'),
    );
  return source;
}
