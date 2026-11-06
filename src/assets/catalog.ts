import raw from '../../public/themes/modern-gray/manifest.json';
import deploymentValue from './deployment.json';
import {ROLE_IDS,validateTheme,validateDeployment,spriteUrl,type Deployment,type ThemeManifest,type AssetRole} from './schema';
export interface ThemePack {
  id:string;name:string;manifest:ThemeManifest;deployment:Deployment;
  palette:Record<keyof ThemeManifest['palette'],number>;
}
export const modernGray:ThemePack=makePack(raw,deploymentValue);
export const registeredThemes:ThemePack[]=[modernGray];
/** Legacy Arkiv level IDs resolve here; rules and archived layouts do not need migrations. */
export const environments:Record<string,ThemePack>={foundry:modernGray,orbital:modernGray,'modern-gray':modernGray};
export function makePack(value:unknown,deployment:Deployment):ThemePack{
  const manifest=validateTheme(value);validateDeployment(deployment);
  return {id:manifest.id,name:manifest.name,manifest,deployment,palette:Object.fromEntries(Object.entries(manifest.palette).map(([k,v])=>[k,parseInt(v.slice(1),16)])) as ThemePack['palette']};
}
export function semantic(id:string){return Object.hasOwn(ROLE_IDS,id)?ROLE_IDS[id as AssetRole]:id;}
export function resolveSprite(pack:ThemePack,id:string){const key=semantic(id),sprite=pack.manifest.sprites[key];if(!sprite)throw new Error(`Theme ${pack.id} has no ${key}`);return {id:key,sprite,url:spriteUrl(pack.manifest,pack.deployment,sprite.sheet)};}
export function applyThemeVariables(pack:ThemePack){
  const root=document.documentElement;root.dataset.theme=pack.id;root.dataset.assetSource=pack.deployment.reference?'swarm':'local';
  for(const [k,v] of Object.entries(pack.manifest.palette))root.style.setProperty('--theme-'+k,v);
  root.style.setProperty('--cyan',pack.manifest.palette.p1);root.style.setProperty('--amber',pack.manifest.palette.p2);root.style.setProperty('--paper',pack.manifest.palette.ink);root.style.setProperty('--line',pack.manifest.palette.edge);
}
