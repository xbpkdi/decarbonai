import { Mark, XIcon } from "@/components/Icons";
import { MAINNET_PROOF, type Net, netHref, NETS, REPO_URL, short } from "@/lib/config";
import { HEADLINE } from "@/lib/copy";

// The Offset mark sits in front of the word "carbon".
const [LEAD, TAIL = ""] = HEADLINE.split(/\s+(?=carbon\b)/i);

const X_HANDLES = ["ktsukixb", "101beere"];

const Arrow = () => (
  <span className="arr" aria-hidden="true">
    ↗
  </span>
);

export function SiteFooter({ net }: { net: Net }) {
  const { contractList: CONTRACT_LIST } = net;
  const NETWORK = net;
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-band">
          <p className="display">
            {LEAD}{" "}
            <span className="mark-inline" aria-hidden="true">
              <svg viewBox="6 6 20 20" aria-hidden="true">
                <rect className="g" x="6" y="6" width="14" height="14" rx="2" />
                <rect className="m" x="12" y="12" width="14" height="14" rx="2" />
                <rect className="r" x="12" y="12" width="8" height="8" />
              </svg>
            </span>{" "}
            {TAIL}.
          </p>
          {/* The featured agent's pool toward the next kg; extras.js fills the grid and shows it. At 1 kg it becomes the mark. */}
          <div className="viz" aria-hidden="true" hidden>
            <figure className="grams">
              <div className="blk">
                <i className="g" />
                <div className="grid" />
                <i className="m" />
                <i className="r" />
              </div>
              <figcaption>
                <span className="k">Pool · next kg</span>
                <b className="gv">0 g</b>
                <span className="s">1 square = 10 g CO₂e</span>
                <span className="done" />
              </figcaption>
            </figure>
          </div>
          <div className="acts">
            <a className="btn btn-primary" href="/">
              See {NETWORK.short} activity
            </a>
            <a className="btn btn-outline" href="/developers">
              Read the docs
            </a>
          </div>
        </div>
        <div className="foot-cols">
          <div>
            <h4>Product</h4>
            <ul>
              <li><a href="/">Live</a></li>
              <li><a href="/receipts">Receipts</a></li>
              <li><a href="/methodology">Methodology</a></li>
            </ul>
          </div>
          <div>
            <h4>Developers</h4>
            <ul>
              <li><a href="/developers">Docs</a></li>
              <li><a href={REPO_URL} target="_blank" rel="noreferrer">GitHub <Arrow /></a></li>
              <li><a href="/developers#mcp">MCP server</a></li>
            </ul>
          </div>
          {/* Both proofs are on mainnet: the Fuji view says so and the receipt link names the network. */}
          <div className="full">
            <h4>Proof{NETWORK.testnet && " · Mainnet"}</h4>
            <ul>
              <li><a href={MAINNET_PROOF.certificate} target="_blank" rel="noreferrer" title="Certificate of the retired credit on Carbonmark">Retired credit <Arrow /></a></li>
              <li><a href={netHref("mainnet", "/receipt/1")} title={`Receipt on ${NETS.mainnet.name}`}>Receipt No. 0001{NETWORK.testnet && " (switches to mainnet)"}</a></li>
            </ul>
          </div>
          <div className="full">
            <h4>On-chain · {NETWORK.short}</h4>
            <ul>
              {CONTRACT_LIST.map(([name, address]) => (
                <li className="addr" key={name}>
                  <span>{name}</span>
                  <a className="hash" href={`${NETWORK.explorer}/address/${address}`} target="_blank" rel="noreferrer" title={address}>
                    {short(address)}
                    <span className="arr">↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="foot-strip">
          <div className="foot-id">
            <span className="brand">
              <Mark />
              DecarbonAI
            </span>
            <span>
              Team1 Demo Day, Bangkok<span className="built"> · Live on Avalanche mainnet + Fuji testnet</span> · © 2026
            </span>
          </div>
          <div className="foot-x">
            {X_HANDLES.map((h) => (
              <a key={h} className="btn btn-outline" href={`https://x.com/${h}`} target="_blank" rel="noopener noreferrer" aria-label={`@${h} on X (opens in a new tab)`}>
                <XIcon />@{h}
                <Arrow />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
