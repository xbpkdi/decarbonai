import { CONTRACT_LIST, CREDIT_NOTE, DEPLOYMENT, NETWORK, REPO_URL, short } from "@/lib/config";
import { HEADLINE } from "@/lib/copy";

// The Offset mark sits in front of the word "carbon".
const [LEAD, TAIL = ""] = HEADLINE.split(/\s+(?=carbon\b)/i);

export function SiteFooter() {
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
              <li><a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a></li>
              <li><a href="/developers#mcp">MCP server</a></li>
            </ul>
          </div>
          <div>
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
          <div>
            <h4>Project</h4>
            <ul>
              <li><a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a></li>
              <li><span>Team1 Demo Day, Bangkok</span></li>
              <li><a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="foot-strip">
          <span>
            methodology {DEPLOYMENT.methodologyVersion} · hash {short(DEPLOYMENT.methodologyHash ?? "")} · {CREDIT_NOTE}
          </span>
          <span className="built">
            <span className="dot-live" />
            Built on {NETWORK.name} · © 2026 DecarbonAI
          </span>
        </div>
      </div>
    </footer>
  );
}
