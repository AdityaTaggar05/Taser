import modernManifest from './modern-gray.manifest.json';
import modernDeployment from './deployment.json';
import type {Deployment} from './schema';

/** Add packs here. Renderers, screens and publication tools use this same registry. */
export const themeSources:Array<{id:string;manifest:unknown;deployment:Deployment;deploymentFile:string;evidenceFile:string;aliases:string[]}>= [
  {id:'modern-gray',manifest:modernManifest,deployment:modernDeployment,deploymentFile:'src/assets/deployment.json',evidenceFile:'docs/theme-release.json',aliases:['foundry','orbital']},
];
