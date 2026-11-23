// v1 certificates were written to a local `.data/certificates.json`, which is read-only/ephemeral
// on Vercel and lost on redeploy. That store is gone: v2 receipts live on-chain (CarbonReceipt on
// Fuji) and are read with @decarbonai/chain. Until the web redesign wires that in, no v1
// certificate is resolvable here (the /certificate/demo page still works).

export type Certificate = {
  id: string;
  tonnes: number;
  mgCO2e: number;
  carbonmarkUrl: string | null;
  sourceTx: string | null;
  snowtraceUrl: string | null;
  receiptId: string | null;
  createdAt: string;
  beneficiary?: string;
};

export function listCertificates(): Certificate[] {
  return [];
}

export function getCertificate(_id: string): Certificate | undefined {
  return undefined;
}
