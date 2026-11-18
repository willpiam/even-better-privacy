export const SEPOLIA_SYMBOLS = ["tUSDC", "tUSDT"];
export const PREVIEW_SYMBOLS = ["tUSDM", "tUSDA", "tUSDCx", "tDJED", "tiUSD"];
export const DECIMALS = 6;
export const ETH_ADDRESS = /^0x[0-9a-f]{40}$/i;

export function atomicAmount(whole: string): bigint {
  if (!/^[1-9][0-9]{0,11}$/.test(whole)) {
    throw new Error(
      "Enter a positive whole-token amount with at most 12 digits.",
    );
  }
  return BigInt(whole) * 10n ** BigInt(DECIMALS);
}
