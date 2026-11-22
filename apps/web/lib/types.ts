type Hex = `0x${string}`;

/** One CarbonAccrued event. `t` is the block time in ms. */
export type SnapAccrual = { id: Hex; tx: Hex; t: number; block: number; agent: number; payer: Hex; mg: number; sur: number };

/** One Retired event: receipt `n`, minted to the payer when its pool reached the threshold. */
export type SnapRetirement = { n: number; tx: Hex; t: number; block: number; agent: number; payer: Hex; mg: number; calls: number; lot: number };

export type Snapshot = {
  network: string;
  block: number;
  thresholdMg: number;
  pricePerTonne: number;
  totals: { accruedMg: number; retiredMg: number; surcharge: number };
  accruals: SnapAccrual[];
  retirements: SnapRetirement[];
  fetchedAt: number;
};
