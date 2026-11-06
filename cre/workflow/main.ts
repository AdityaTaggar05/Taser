import {
  handler,
  HTTPCapability,
  Runner,
  HTTPClient,
  EVMClient,
  TxStatus,
  consensusIdenticalAggregation,
  encodeCallMsg,
  LAST_FINALIZED_BLOCK_NUMBER,
  LATEST_BLOCK_NUMBER,
  prepareReportRequest,
  type Runtime,
  type NodeRuntime,
  type HTTPPayload,
} from '@chainlink/cre-sdk';
import {
  encodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  bytesToHex,
  zeroAddress,
  type Hex,
} from 'viem';
import { hash32, registryAbi, requestHash, validRequest } from '../../src/certification/model';
import { assessSubmission } from './verify';
import { parseConfig, type Config } from './config';
function replay(node: NodeRuntime<Config>, id: string, commitment: string, token: string): string {
  const client = new HTTPClient(),
    base = node.config.apiBase + '/api/cre/submissions/' + id,
    headers = { Authorization: 'Bearer ' + token };
  // These two reads are independent. Only the compact replay verdict enters consensus.
  const inputCall = client.sendRequest(node, {
    url: base,
    method: 'GET',
    headers,
    cacheSettings: { store: false, maxAge: '0s' },
  });
  const requestCall =
    node.config.mode === 'local-simulation'
      ? client.sendRequest(node, {
          url: base + '/request',
          method: 'GET',
          headers,
          cacheSettings: { store: false, maxAge: '0s' },
        })
      : undefined;
  const response = inputCall.result();
  if (response.statusCode !== 200 || response.body.length > 96_000)
    throw new Error('Verification input unavailable.');
  const input: unknown = JSON.parse(new TextDecoder().decode(response.body));
  if (requestCall) {
    const metadata = requestCall.result();
    if (metadata.statusCode !== 200 || metadata.body.length > 4096)
      throw new Error('Rehearsal request unavailable.');
    const request: unknown = JSON.parse(new TextDecoder().decode(metadata.body));
    if (!validRequest(request) || request.id !== id) throw new Error('Invalid rehearsal request.');
    commitment = requestHash(request);
  }
  return JSON.stringify(assessSubmission(input, commitment, id));
}
const handle = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const { submissionId } = JSON.parse(new TextDecoder().decode(payload.input)) as {
    submissionId: unknown;
  };
  if (!hash32(submissionId)) throw new Error('Invalid submission ID.');
  const tokenCall = runtime.getSecret({ id: 'TASER_VERIFIER_TOKEN' });
  if (runtime.config.mode === 'local-simulation') {
    const result = JSON.parse(
      runtime
        .runInNodeMode(replay, consensusIdenticalAggregation<string>())(
          submissionId,
          '',
          tokenCall.result().value,
        )
        .result(),
    ) as { commitment: Hex; valid: boolean; steps: number };
    runtime.log(
      'Taser local-simulation: ' +
        (result.valid ? 'WINNING' : 'REJECTED') +
        ' solution; ' +
        result.steps +
        ' turns. No certificate or publication created.',
    );
    return JSON.stringify({
      submissionId,
      commitment: result.commitment,
      valid: result.valid,
      steps: result.steps,
      mode: 'local-simulation',
      certified: false,
    });
  }
  const evm = new EVMClient(EVMClient.SUPPORTED_CHAIN_SELECTORS['ethereum-testnet-sepolia']);
  const data = encodeFunctionData({
    abi: registryAbi,
    functionName: 'requests',
    args: [submissionId],
  });
  // Registry lookup and secret retrieval do not depend on one another.
  const readCall = evm.callContract(runtime, {
    call: encodeCallMsg({ from: zeroAddress, to: runtime.config.registry, data }),
    blockNumber:
      runtime.config.mode === 'simulation' ? LATEST_BLOCK_NUMBER : LAST_FINALIZED_BLOCK_NUMBER,
  });
  const token = tokenCall.result().value,
    read = readCall.result();
  const commitment = decodeFunctionResult({
    abi: registryAbi,
    functionName: 'requests',
    data: bytesToHex(read.data),
  });
  if (!hash32(commitment) || /^0x0+$/.test(commitment))
    throw new Error('Register the frozen submission onchain before verification.');
  const result = JSON.parse(
    runtime
      .runInNodeMode(replay, consensusIdenticalAggregation<string>())(
        submissionId,
        commitment,
        token,
      )
      .result(),
  ) as { id: Hex; commitment: Hex; valid: boolean; steps: number };
  const report = runtime
    .report(
      prepareReportRequest(
        encodeAbiParameters(
          [
            { type: 'bytes32' },
            { type: 'bytes32' },
            { type: 'bool' },
            { type: 'uint32' },
            { type: 'uint256' },
            { type: 'address' },
          ],
          [
            result.id,
            result.commitment,
            result.valid,
            result.steps,
            11155111n,
            runtime.config.registry,
          ],
        ),
      ),
    )
    .result();
  const write = evm
    .writeReport(runtime, {
      receiver: runtime.config.registry,
      report,
      gasConfig: { gasLimit: '350000' },
    })
    .result();
  if (write.txStatus !== TxStatus.SUCCESS) throw new Error('Certificate report delivery failed.');
  // Dry-run simulation prepares a write without a transaction; DON success requires one.
  if (runtime.config.mode === 'don' && !write.txHash?.length)
    throw new Error('Certificate delivery returned no transaction hash.');
  runtime.log(
    'Submission ' + submissionId + ' replay completed: ' + (result.valid ? 'winning' : 'rejected'),
  );
  return JSON.stringify({
    submissionId,
    valid: result.valid,
    steps: result.steps,
    mode: runtime.config.mode,
  });
};
export const initWorkflow = (value: Config) => {
  const config = parseConfig(value);
  return [handler(new HTTPCapability().trigger({ authorizedKeys: config.authorizedKeys }), handle)];
};
export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
