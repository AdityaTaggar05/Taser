import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import solc from 'solc';
import { Common, Sepolia, Hardfork } from '@ethereumjs/common';
import { createVM } from '@ethereumjs/vm';
import { Account, createAddressFromString } from '@ethereumjs/util';
import {
  encodeDeployData,
  encodeFunctionData,
  encodeAbiParameters,
  decodeFunctionResult,
  hexToBytes,
  bytesToHex,
  zeroHash,
  type Hex,
} from 'viem';
const source = readFileSync('contracts/TaserCertificationRegistry.sol', 'utf8');
const compiled = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: 'Solidity',
      sources: { 'Registry.sol': { content: source } },
      settings: {
        evmVersion: 'cancun',
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
      },
    }),
  ),
);
const artifact = compiled.contracts?.['Registry.sol']?.TaserCertificationRegistry;
if (!artifact) throw new Error(JSON.stringify(compiled.errors));
async function fixture(simulation = true) {
  const vm = await createVM({ common: new Common({ chain: Sepolia, hardfork: Hardfork.Cancun }) });
  const owner = createAddressFromString('0x' + '11'.repeat(20)),
    forwarder = createAddressFromString('0x' + '22'.repeat(20)),
    stranger = createAddressFromString('0x' + '33'.repeat(20)),
    workflow = ('0x' + '44'.repeat(32)) as Hex;
  for (const address of [owner, forwarder, stranger])
    await vm.stateManager.putAccount(address, new Account(0n, 10n ** 22n));
  await vm.stateManager.putCode(forwarder, new Uint8Array([0]));
  const deployment = await vm.evm.runCall({
    caller: owner,
    data: hexToBytes(
      encodeDeployData({
        abi: artifact.abi,
        bytecode: ('0x' + artifact.evm.bytecode.object) as Hex,
        args: [forwarder.toString(), workflow, simulation],
      }),
    ),
    gasLimit: 8_000_000n,
  });
  expect(deployment.execResult.exceptionError).toBeUndefined();
  const address = deployment.createdAddress!;
  const call = (name: string, args: unknown[], caller = owner) =>
    vm.evm.runCall({
      caller,
      to: address,
      data: hexToBytes(encodeFunctionData({ abi: artifact.abi, functionName: name, args })),
      gasLimit: 1_000_000n,
    });
  const report = (
    id: Hex,
    hash: Hex,
    valid = true,
    steps = 8,
    chain = 11155111n,
    receiver = address.toString(),
  ) =>
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bool' },
        { type: 'uint32' },
        { type: 'uint256' },
        { type: 'address' },
      ],
      [id, hash, valid, steps, chain, receiver as Hex],
    );
  return { call, owner, forwarder, stranger, workflow, address, report };
}
it('enforces immutable owner-submitted requests, trusted forwarding and destination binding', async () => {
  const f = await fixture(),
    id = ('0x' + 'aa'.repeat(32)) as Hex,
    commitment = ('0x' + 'bb'.repeat(32)) as Hex;
  expect(
    (await f.call('registerSubmission', [id, commitment], f.stranger)).execResult.exceptionError,
  ).toBeDefined();
  expect(
    (await f.call('registerSubmission', [id, commitment])).execResult.exceptionError,
  ).toBeUndefined();
  expect(
    (await f.call('registerSubmission', [id, zeroHash])).execResult.exceptionError,
  ).toBeDefined();
  expect(
    (await f.call('onReport', ['0x', f.report(id, commitment)], f.stranger)).execResult
      .exceptionError,
  ).toBeDefined();
  for (const report of [
    f.report(id, zeroHash),
    f.report(id, commitment, true, 8, 1n),
    f.report(id, commitment, true, 8, 11155111n, f.stranger.toString()),
    f.report(id, commitment, true, 0),
  ])
    expect(
      (await f.call('onReport', ['0x', report], f.forwarder)).execResult.exceptionError,
    ).toBeDefined();
  expect(
    (await f.call('onReport', ['0x', f.report(id, commitment)], f.forwarder)).execResult
      .exceptionError,
  ).toBeUndefined();
  expect(
    (await f.call('onReport', ['0x', f.report(id, commitment)], f.forwarder)).execResult
      .exceptionError,
  ).toBeUndefined();
  expect(
    (await f.call('onReport', ['0x', f.report(id, commitment, false)], f.forwarder)).execResult
      .exceptionError,
  ).toBeDefined();
  const stored = await f.call('certifications', [id]);
  expect(
    decodeFunctionResult({
      abi: artifact.abi,
      functionName: 'certifications',
      data: bytesToHex(stored.execResult.returnValue),
    }),
  ).toEqual([commitment, true, 8, true]);
});
it('requires the exact 62-byte workflow metadata in DON mode', async () => {
  const f = await fixture(false),
    id = ('0x' + 'aa'.repeat(32)) as Hex,
    commitment = ('0x' + 'bb'.repeat(32)) as Hex;
  await f.call('registerSubmission', [id, commitment]);
  expect(
    (await f.call('onReport', ['0x', f.report(id, commitment)], f.forwarder)).execResult
      .exceptionError,
  ).toBeDefined();
  const metadata = (f.workflow + '00'.repeat(30)) as Hex;
  expect(
    (
      await f.call(
        'onReport',
        [(zeroHash + '00'.repeat(30)) as Hex, f.report(id, commitment)],
        f.forwarder,
      )
    ).execResult.exceptionError,
  ).toBeDefined();
  expect(
    (await f.call('onReport', [metadata, f.report(id, commitment)], f.forwarder)).execResult
      .exceptionError,
  ).toBeUndefined();
});
