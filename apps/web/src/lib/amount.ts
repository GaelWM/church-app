/** Minor units (a bigint serialised as a string) → exact decimal text for an amount input ("1234,56"). Never via float division. */
export function exactAmount(minor: string | bigint): string {
  const neg = BigInt(minor) < 0n;
  const s = (neg ? -BigInt(minor) : BigInt(minor)).toString().padStart(3, "0");
  return `${neg ? "-" : ""}${s.slice(0, -2)},${s.slice(-2)}`;
}
