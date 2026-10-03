"use client";
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

// wallets=[]: Phantom, Solflare and other Wallet Standard wallets register themselves.
export function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com";
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
