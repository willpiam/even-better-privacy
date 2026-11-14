/** Convert a USD-cent price to atomic units, rounding up without floating point.
 * `usdPerToken` is a positive plain decimal string from a fresh price source.
 */
export function quoteAtomicUnits(
  usdCents: number,
  usdPerToken: string,
  decimals: number,
): bigint {
  if (
    !Number.isSafeInteger(usdCents) || usdCents <= 0 ||
    !Number.isInteger(decimals) || decimals < 0 || decimals > 30 ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(usdPerToken)
  ) {
    throw new Error("invalid quote parameters");
  }
  const [whole, fraction = ""] = usdPerToken.split(".");
  const rate = BigInt(whole + fraction);
  if (rate === 0n) throw new Error("invalid quote rate");
  const numerator = BigInt(usdCents) *
    10n ** BigInt(decimals + fraction.length);
  const denominator = 100n * rate;
  return (numerator + denominator - 1n) / denominator;
}
