// Minimal JSON-RPC server for tests: answers eth_call from a table, logs/receipts/blocks from fields.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type Abi, type Hex, decodeFunctionData, encodeFunctionResult, erc20Abi, parseAbi } from "viem";
import { dCO2Abi, retirementPoolAbi } from "@decarbonai/chain";

const eip3009 = parseAbi(["function authorizationState(address, bytes32) view returns (bool)"]);
const abis: Abi[] = [retirementPoolAbi as Abi, dCO2Abi as Abi, erc20Abi as Abi, eip3009 as Abi];

export type RpcState = {
  chainId: number;
  blockNumber: bigint;
  timestamp: number;
  balance: bigint;
  /** Result of a read, by "<address>.<function>" (lowercase address) or "<function>". */
  reads: Record<string, unknown | ((args: readonly unknown[]) => unknown)>;
  logs: unknown[];
  receipts: Record<string, unknown>;
  down?: boolean;
};

export async function rpcMock(state: RpcState) {
  const hex = (n: bigint | number) => `0x${n.toString(16)}`;
  const call = ({ to, data }: { to: string; data: Hex }) => {
    for (const abi of abis) {
      let decoded: { functionName: string; args?: readonly unknown[] };
      try {
        decoded = decodeFunctionData({ abi, data });
      } catch {
        continue;
      }
      const value = state.reads[`${to.toLowerCase()}.${decoded.functionName}`] ?? state.reads[decoded.functionName];
      if (value === undefined) throw new Error(`unmocked read ${to}.${decoded.functionName}`);
      const result = typeof value === "function" ? value(decoded.args ?? []) : value;
      return encodeFunctionResult({ abi, functionName: decoded.functionName, result } as never);
    }
    throw new Error(`unknown selector ${data.slice(0, 10)}`);
  };
  const block = () => ({ number: hex(state.blockNumber), timestamp: hex(state.timestamp), hash: `0x${"0".repeat(64)}`, transactions: [] });
  const answer = (method: string, params: never[]): unknown => {
    switch (method) {
      case "eth_chainId": return hex(state.chainId);
      case "eth_blockNumber": return hex(state.blockNumber);
      case "eth_getBlockByNumber": return block();
      case "eth_getBalance": return hex(state.balance);
      case "eth_getLogs": return state.logs;
      case "eth_getTransactionReceipt": return state.receipts[params[0]] ?? null;
      case "eth_call": return call(params[0]);
      default: throw new Error(`unmocked method ${method}`);
    }
  };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      try {
        if (state.down) throw new Error("down");
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result: answer(method, params) }));
      } catch (e) {
        res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: (e as Error).message } }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}
