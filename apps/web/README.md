# DecarbonAI web

Next.js app for the v3 "Capture" frontend: Live, Agent, Receipts, Receipt, Developers, Methodology.

```sh
npm install            # from the repo root
npm run dev -w web     # http://localhost:3000
npm run build -w web
npm run smoke -w web   # Playwright: desktop, phone, iPad (WebKit), overlap and frame-time checks
```

Every page shows Avalanche mainnet by default. The header chip switches to Fuji: the choice goes into `?network=fuji`, a cookie (`middleware.ts`) and localStorage. Contract addresses come from `deployments/avalanche.json` and `deployments/fuji.json`; the mainnet lot from `deployments/avalanche-lot1.json`.

`?source=mock` switches a tab to the simulated stream for rehearsal (amber "SIMULATED" badge and banner, B = 100-call burst, P = pause). The banner's "Back to live chain data" link returns to real data.

## Environment variables (Vercel → Settings → Environment Variables)

Names only; never commit values. Variables marked server-only must **not** get a `NEXT_PUBLIC_` prefix.

| Name | Scope | Needed for |
|---|---|---|
| `NEXT_PUBLIC_AGENT_NAMES` | public | JSON map of ERC-8004 id to display name, e.g. `{"360":"Demo agent"}`; unknown ids show as "Agent #id" |
| `NEXT_PUBLIC_FEATURED_AGENT_ID` | public | Optional. Fuji agent on the Live pool card (default: the demo agent, else 360). Mainnet always features 1855 |
| `NEXT_PUBLIC_SITE_URL` | public | Optional. Canonical origin for OG and metadata (default: this Vercel deployment, else `https://decarbonai.vercel.app`) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | public | Optional. QR wallets in Connect wallet; extension wallets work without it |
| `RPC_URL`, `NEXT_PUBLIC_RPC_URL` | server / public | Optional Fuji RPC overrides |
| `MAINNET_RPC_URL` | server | Optional mainnet RPC override (default publicnode; needs a wide `eth_getLogs` range) |

### Live demo payments (Developers "Run", Agent "Pay one call")

`DEMO_API_URL`, `DEMO_AGENT_PRIVATE_KEY` and `NEXT_PUBLIC_DEMO_AGENT_ID` must all be set and well formed, or `POST /api/demo/pay` answers 503 and both buttons show a calm "switched off on this deployment" state instead of paying:

| Name | Scope | Value to use |
|---|---|---|
| `DEMO_API_URL` | server-only | Base URL of the deployed paid API (`apps/paid-api`), https (http only on localhost) |
| `DEMO_AGENT_PRIVATE_KEY` | server-only | A **Fuji test** agent key (0x + 64 hex) funded with TestUSDC. Never a mainnet, deployer or meter key |
| `NEXT_PUBLIC_DEMO_AGENT_ID` | public | Decimal ERC-8004 id of that agent. Public: never paste a key here (the "Pay one call" button shows on its Agent page) |
| `NEXT_PUBLIC_DEMO_API_URL` | public | Same URL as `DEMO_API_URL`, https only; shown in the Developers code samples |

Payments run on Fuji only, whichever network the page shows; on mainnet both buttons point to Fuji instead and are rate-limited (4 per IP and 20 total per minute). After setting them, redeploy and do one test click on Developers → Run before going on stage.
