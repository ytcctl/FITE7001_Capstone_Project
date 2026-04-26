import { ethers } from 'ethers';

/**
 * Returns a NonceManager that hands out monotonically-increasing nonces for a
 * single multi-tx flow on a single click. Call `nm.next()` to get the tx
 * options object for each call:
 *
 *   const nm = await createNonceManager(signer);
 *   const tx1 = await contract.foo(args, nm.next());
 *   await tx1.wait();
 *   const tx2 = await contract.bar(args, nm.next());
 *   await tx2.wait();
 *
 * Why this exists: ethers' default nonce resolution and MetaMask's per-account
 * activity tracker both consult per-block caches that don't observe a freshly
 * mined tx in time for the *next* tx in the same handler. The result is a
 * `nonce too low` / `NONCE_EXPIRED` revert. Fetching once at handler entry
 * (against `'latest'`) and incrementing locally bypasses the cache entirely.
 *
 * Provider/runner extraction mirrors what each page already does to obtain the
 * underlying provider from a contract instance.
 */
export async function createNonceManager(signer: ethers.Signer | { provider?: ethers.Provider | null; getAddress: () => Promise<string> }): Promise<{
  next: () => { nonce: number };
  current: () => number;
}> {
  const provider = (signer as ethers.Signer).provider;
  if (!provider) {
    throw new Error('createNonceManager: signer has no provider attached');
  }
  const from = await signer.getAddress();
  let next = await provider.getTransactionCount(from, 'latest');
  return {
    next: () => ({ nonce: next++ }),
    current: () => next,
  };
}
