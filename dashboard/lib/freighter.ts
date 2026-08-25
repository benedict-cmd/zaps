/**
 * freighter.ts
 * Helper utilities for @stellar/freighter-api browser wallet integration.
 * All functions are async-safe and handle the case where Freighter is not installed.
 *
 * Also exports WalletProvider / useWallet so wallet state is shared across the
 * whole app and survives page navigation without requiring the user to reconnect.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FreighterWalletState {
  installed: boolean;
  connected: boolean;
  publicKey: string | null;
  network: string | null;
}

/** Default disconnected state returned before any detection. */
export const DEFAULT_WALLET_STATE: FreighterWalletState = {
  installed: false,
  connected: false,
  publicKey: null,
  network: null,
};

// ── Stateless helpers (safe to call outside React) ────────────────────────────

/**
 * Detect whether Freighter is installed in the browser and, if so,
 * whether it is already connected and which public key / network are active.
 */
export async function detectFreighter(): Promise<FreighterWalletState> {
  try {
    const { isConnected, getAddress, getNetwork } = await import(
      "@stellar/freighter-api"
    );

    const connectedResult = await isConnected();
    if (!connectedResult.isConnected) {
      return { installed: true, connected: false, publicKey: null, network: null };
    }

    const [addrResult, networkResult] = await Promise.allSettled([
      getAddress(),
      getNetwork(),
    ]);

    const publicKey =
      addrResult.status === "fulfilled" && addrResult.value.address
        ? addrResult.value.address
        : null;

    const network =
      networkResult.status === "fulfilled" && networkResult.value.network
        ? networkResult.value.network
        : null;

    return { installed: true, connected: true, publicKey, network };
  } catch {
    // Extension not installed or not accessible (SSR / non-browser context).
    return DEFAULT_WALLET_STATE;
  }
}

/**
 * Request the user to connect / grant access to Freighter.
 * Returns the resulting wallet state after the prompt.
 */
export async function connectFreighter(): Promise<FreighterWalletState> {
  try {
    const { requestAccess } = await import("@stellar/freighter-api");
    const result = await requestAccess();
    if ("error" in result && result.error) {
      throw new Error(result.error);
    }
    return detectFreighter();
  } catch (err) {
    throw err instanceof Error ? err : new Error("Failed to connect Freighter");
  }
}

export interface SignResult {
  signedTxXdr: string;
}

/**
 * Sign an XDR-encoded transaction envelope with Freighter.
 *
 * @param xdr              Base64-encoded XDR transaction envelope.
 * @param networkPassphrase Stellar network passphrase (testnet or mainnet).
 * @returns                Signed XDR string.
 */
export async function signWithFreighter(
  xdr: string,
  networkPassphrase: string
): Promise<SignResult> {
  const { signTransaction } = await import("@stellar/freighter-api");
  const result = await signTransaction(xdr, { networkPassphrase });
  if ("error" in result && result.error) {
    throw new Error(result.error);
  }
  return result as SignResult;
}

/** Truncate a Stellar public key for display: "GABC…WXYZ". */
export function truncateKey(key: string, head = 4, tail = 4): string {
  if (key.length <= head + tail + 3) return key;
  return `${key.slice(0, head)}…${key.slice(-tail)}`;
}

// ── WalletContext ─────────────────────────────────────────────────────────────

interface WalletContextValue {
  wallet: FreighterWalletState;
  /** True while the initial session-restore check is running. */
  restoring: boolean;
  /** True while a user-initiated connect request is in flight. */
  connecting: boolean;
  connect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/**
 * Wrap the dashboard (or the whole app) with this provider so any page can
 * call `useWallet()` without managing its own wallet state.
 *
 * On mount it calls `isConnected()` via `detectFreighter()` and, if the user
 * had previously granted access, restores the public key and network in state
 * automatically — no prompt required.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<FreighterWalletState>(DEFAULT_WALLET_STATE);
  const [restoring, setRestoring] = useState(true);
  const [connecting, setConnecting] = useState(false);

  // Restore session on mount (client-only — detectFreighter guards against SSR)
  useEffect(() => {
    let cancelled = false;
    detectFreighter().then((state) => {
      if (!cancelled) {
        setWallet(state);
        setRestoring(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const state = await connectFreighter();
      setWallet(state);
    } finally {
      setConnecting(false);
    }
  }, []);

  return (
    <WalletContext.Provider value={{ wallet, restoring, connecting, connect }}>
      {children}
    </WalletContext.Provider>
  );
}

/**
 * Consume the shared Freighter wallet state from any client component.
 * Must be used inside a `<WalletProvider>`.
 */
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used inside <WalletProvider>");
  }
  return ctx;
}
