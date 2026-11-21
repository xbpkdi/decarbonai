// One-time demo setup for the agent wallet (AGENT_PRIVATE_KEY):
//  1. top up gas (AVAX) from the deployer if low, 2. mint faucet tUSDC if low,
//  3. register an ERC-8004 identity owned by the agent (prints AGENT_ID; add it to .env).
import { createWalletClient, formatEther, http, parseEther, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { ERC8004_IDENTITY_FUJI, FUJI, explorer, fujiClient, identityRegistryAbi, testUSDCAbi } from "@decarbonai/chain";

const deployerKey = process.env.FUJI_PRIVATE_KEY as Hex | undefined;
const agentKey = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
if (!deployerKey || !agentKey) throw new Error("Set FUJI_PRIVATE_KEY and AGENT_PRIVATE_KEY in .env");

const client = fujiClient();
const transport = http(process.env.FUJI_RPC_URL);
const deployer = createWalletClient({ account: privateKeyToAccount(deployerKey), chain: avalancheFuji, transport });
const agent = createWalletClient({ account: privateKeyToAccount(agentKey), chain: avalancheFuji, transport });
const agentAddr = agent.account.address;
console.log(`agent ${agentAddr}`);

const avax = await client.getBalance({ address: agentAddr });
if (avax < parseEther("0.01")) {
  const hash = await deployer.sendTransaction({ to: agentAddr, value: parseEther("0.05") });
  await client.waitForTransactionReceipt({ hash });
  console.log(`funded 0.05 AVAX: ${explorer.tx(hash)}`);
} else console.log(`AVAX ok: ${formatEther(avax)}`);

const bal = await client.readContract({ address: FUJI.paymentToken, abi: testUSDCAbi, functionName: "balanceOf", args: [agentAddr] });
if (bal < 50_000_000n) {
  const hash = await agent.writeContract({ address: FUJI.paymentToken, abi: testUSDCAbi, functionName: "mint", args: [agentAddr, 1_000_000_000n] });
  await client.waitForTransactionReceipt({ hash });
  console.log(`minted 1000 tUSDC: ${explorer.tx(hash)}`);
} else console.log(`tUSDC ok: ${Number(bal) / 1e6}`);

if (process.env.AGENT_ID) {
  console.log(`AGENT_ID=${process.env.AGENT_ID} already set`);
} else {
  const uri = `data:application/json,${encodeURIComponent(
    JSON.stringify({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "DecarbonAI demo agent",
      description: "Claude agent that pays for API calls over x402 on Avalanche and settles its own carbon.",
    }),
  )}`;
  const hash = await agent.writeContract({ address: ERC8004_IDENTITY_FUJI, abi: identityRegistryAbi, functionName: "register", args: [uri] });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const [ev] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: receipt.logs });
  console.log(`registered ERC-8004 agent: ${explorer.tx(hash)}`);
  console.log(`AGENT_ID=${ev.args.agentId}   <- add this line to .env`);
}
