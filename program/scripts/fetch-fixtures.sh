#!/usr/bin/env bash
# Dump the live mainnet programs the tests run against. Re-run to pick up a DBC upgrade.
set -euo pipefail
cd "$(dirname "$0")/.."
RPC="${RPC_URL:-https://api.mainnet-beta.solana.com}"
mkdir -p tests/fixtures
[ -f tests/fixtures/dbc.so ] || solana program dump dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN tests/fixtures/dbc.so --url "$RPC"
[ -f tests/fixtures/mpl_token_metadata.so ] || solana program dump metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s tests/fixtures/mpl_token_metadata.so --url "$RPC"
[ -f target/test-wallet.json ] || { mkdir -p target; solana-keygen new --no-bip39-passphrase -s -o target/test-wallet.json >/dev/null; }
