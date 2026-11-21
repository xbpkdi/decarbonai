// One-time setup for the demo agent wallet on DECARBONAI_NETWORK (fuji default | avalanche):
//  1. top up gas (AVAX) from the deployer if low,
//  2. Fuji: mint faucet tUSDC if low. Mainnet: only report the USDC balance (fund it yourself),
//  3. register an ERC-8004 identity owned by the agent (prints the id; add it to .env).
// Keys: FUJI_PRIVATE_KEY + AGENT_PRIVATE_KEY, or on mainnet MAINNET_PRIVATE_KEY + MAINNET_AGENT_PRIVATE_KEY.
import { createWalletClient, erc20Abi, formatEther, http, parseEther, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { explorerFor, identityRegistryAbi, network, testUSDCAbi } from "@decarbonai/chain";
import { clientFor, loadDeployment, rpcUrlFor } from "@decarbonai/chain/node";

const d = loadDeployment();
const net = network(d.chainId);
const mainnet = d.chainId === 43114;
const deployerKey = (mainnet ? process.env.MAINNET_PRIVATE_KEY : process.env.FUJI_PRIVATE_KEY) as Hex | undefined;
const agentKey = (mainnet ? process.env.MAINNET_AGENT_PRIVATE_KEY : process.env.AGENT_PRIVATE_KEY) as Hex | undefined;
const idVar = mainnet ? "MAINNET_AGENT_ID" : "AGENT_ID";
if (!deployerKey || !agentKey) throw new Error("deployer and agent keys missing in .env (see header)");

const client = clientFor(d);
const explorer = explorerFor(d.chainId);
const transport = http(rpcUrlFor(d));
const deployer = createWalletClient({ account: privateKeyToAccount(deployerKey), chain: net.chain, transport });
const agent = createWalletClient({ account: privateKeyToAccount(agentKey), chain: net.chain, transport });
const agentAddr = agent.account.address;
console.log(`${net.name}: agent ${agentAddr}`);

const avax = await client.getBalance({ address: agentAddr });
const minGas = mainnet ? parseEther("0.005") : parseEther("0.01");
if (avax < minGas) {
  const hash = await deployer.sendTransaction({ to: agentAddr, value: mainnet ? parseEther("0.01") : parseEther("0.05") });
  await client.waitForTransactionReceipt({ hash });
  console.log(`funded gas: ${explorer.tx(hash)}`);
} else console.log(`AVAX ok: ${formatEther(avax)}`);

const bal = await client.readContract({ address: d.paymentToken, abi: erc20Abi, functionName: "balanceOf", args: [agentAddr] });
if (mainnet) {
  console.log(`USDC: ${Number(bal) / 1e6}${bal < 2_000_000n ? "  <- send ~$5 USDC to the agent before the demo" : ""}`);
} else if (bal < 50_000_000n) {
  const hash = await agent.writeContract({ address: d.paymentToken, abi: testUSDCAbi, functionName: "mint", args: [agentAddr, 1_000_000_000n] });
  await client.waitForTransactionReceipt({ hash });
  console.log(`minted 1000 tUSDC: ${explorer.tx(hash)}`);
} else console.log(`tUSDC ok: ${Number(bal) / 1e6}`);

if (process.env[idVar]) {
  console.log(`${idVar}=${process.env[idVar]} already set`);
} else {
  const uri = `data:application/json,${encodeURIComponent(
    JSON.stringify({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "DecarbonAI demo agent",
      description: "Claude agent that pays for API calls over x402 on Avalanche and settles its own carbon.",
    }),
  )}`;
  const hash = await agent.writeContract({ address: net.erc8004Identity, abi: identityRegistryAbi, functionName: "register", args: [uri] });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const [ev] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: receipt.logs });
  console.log(`registered ERC-8004 agent: ${explorer.tx(hash)}`);
  console.log(`${idVar}=${ev.args.agentId}   <- add this line to .env`);
}
