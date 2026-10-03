#!/usr/bin/env bash
# Local validator with the real Meteora DBC + Metaplex programs (dumped from mainnet) and curvebook_router.
set -euo pipefail
cd "$(dirname "$0")/.."
FIX=program/tests/fixtures
[ -f "$FIX/dbc.so" ] || bash program/scripts/fetch-fixtures.sh
[ -f program/target/deploy/curvebook_router.so ] || (cd program && anchor build)
ROUTER=$(solana address -k program/target/deploy/curvebook_router-keypair.json)
exec solana-test-validator --reset --quiet --ledger .run/test-ledger \
  --bpf-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN "$FIX/dbc.so" \
  --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s "$FIX/mpl_token_metadata.so" \
  --bpf-program "$ROUTER" program/target/deploy/curvebook_router.so
