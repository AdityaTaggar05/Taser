import solc from 'solc';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const source = readFileSync('contracts/WeldPointCertificationRegistry.sol', 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'WeldPointCertificationRegistry.sol': { content: source } },
  settings: {
    evmVersion: 'cancun',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const error of output.errors ?? [])
  if (error.severity === 'error') throw new Error(error.formattedMessage);
const contract =
  output.contracts['WeldPointCertificationRegistry.sol'].WeldPointCertificationRegistry;
mkdirSync('.data/cre', { recursive: true });
writeFileSync(
  '.data/cre/registry.json',
  JSON.stringify({ abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object }, null, 2) +
    '\n',
  { mode: 0o600 },
);
console.log('Compiled WeldPointCertificationRegistry; no network transaction sent.');
