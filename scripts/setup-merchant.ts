// One-time merchant setup on DECARBONAI_NETWORK (fuji default | avalanche):
//  - Fuji only: top up gas for the meter and payTo wallets from the deployer,
//  - payTo approves the pool to pull up to 25 USDC of carbon surcharges (pool.surchargeFunder(meter) must be
//    payTo). Bounded on purpose: a leaked meter key can push at most this much from payTo into the pool. The
//    API fails closed below 10 USDC; run this again to top it up,
//  - prints the role layout so you can check the meter holds METER_ROLE only.
import { createWalletClient, erc20Abi, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { explorerFor, network, retirementPoolAbi } from "@decarbonai/chain";
import { clientFor, rpcUrlFor } from "@decarbonai/chain/node";
import { need, scriptEnv } from "./env.ts";

const env = scriptEnv();
const { d } = env;
const net = network(d.chainId);
const client = clientFor(d);
const explorer = explorerFor(d.chainId);
const transport = http(rpcUrlFor(d));
const meter = privateKeyToAccount(need(env.meterKey, "meter key")).address;
const payToAccount = privateKeyToAccount(need(env.payToKey, "payTo key"));

if (!env.mainnet) {
  const deployer = createWalletClient({ account: privateKeyToAccount(need(env.deployerKey, "FUJI_PRIVATE_KEY")), chain: net.chain, transport });
  for (const [label, addr, amount] of [["meter", meter, "0.3"], ["payTo", payToAccount.address, "0.02"]] as const) {
    const bal = await client.getBalance({ address: addr });
    if (bal < parseEther(amount) / 2n) {
      const hash = await deployer.sendTransaction({ to: addr, value: parseEther(amount) });
      await client.waitForTransactionReceipt({ hash });
      console.log(`funded ${label} ${amount} AVAX: ${explorer.tx(hash)}`);
    } else console.log(`${label} gas ok: ${formatEther(bal)} AVAX`);
  }
}

const ALLOWANCE = 25_000_000n; // 25 USDC, about 45,000 demo calls
const TOP_UP_BELOW = 15_000_000n; // above the API's 10 USDC fail-closed floor
const allowance = await client.readContract({ address: d.paymentToken, abi: erc20Abi, functionName: "allowance", args: [payToAccount.address, d.retirementPool] });
if (allowance < TOP_UP_BELOW || allowance > ALLOWANCE) {
  const payTo = createWalletClient({ account: payToAccount, chain: net.chain, transport });
  const hash = await payTo.writeContract({ address: d.paymentToken, abi: erc20Abi, functionName: "approve", args: [d.retirementPool, ALLOWANCE] });
  await client.waitForTransactionReceipt({ hash });
  console.log(`payTo approved the pool for ${Number(ALLOWANCE) / 1e6} USDC of surcharges: ${explorer.tx(hash)}`);
} else console.log(`payTo allowance ok: ${Number(allowance) / 1e6} USDC`);

const pool = { address: d.retirementPool, abi: retirementPoolAbi } as const;
const [funder, admin, meterRole, treasuryRole] = await Promise.all([
  client.readContract({ ...pool, functionName: "surchargeFunder", args: [meter] }),
  client.readContract({ ...pool, functionName: "defaultAdmin" }),
  client.readContract({ ...pool, functionName: "METER_ROLE" }),
  client.readContract({ ...pool, functionName: "TREASURY_ROLE" }),
]);
const [isMeter, meterIsTreasury] = await Promise.all([
  client.readContract({ ...pool, functionName: "hasRole", args: [meterRole, meter] }),
  client.readContract({ ...pool, functionName: "hasRole", args: [treasuryRole, meter] }),
]);
console.log({ meter, payTo: payToAccount.address, surchargeFunder: funder, admin, meterHasMeterRole: isMeter, meterIsTreasury });
