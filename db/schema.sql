-- Curvebook schema (Postgres / Supabase). Idempotent: the worker applies it on start.

create table if not exists configs (
  address text primary key,
  fee_claimer text not null,
  quote_mint text not null,
  activation_type smallint not null,
  collect_fee_mode smallint not null,
  token_type smallint not null,
  swap_base_amount numeric not null,          -- SNP10 denominator
  migration_quote_threshold numeric not null,
  pool_creation_fee numeric not null,
  base_fee jsonb not null,                    -- mode, cliff, first/second/third factor
  dynamic_fee boolean not null,
  enable_first_swap_with_min_fee boolean not null,
  creator_trading_fee_pct smallint not null,
  migration_option smallint not null,
  describe text[] not null,
  raw_b64 text not null,
  first_seen_slot bigint,
  fetched_at timestamptz not null default now()
);

create table if not exists pools (
  address text primary key,
  config text not null,
  creator text not null,
  base_mint text not null,
  create_sig text not null,
  create_slot bigint not null,
  created_at timestamptz,
  activation_point numeric not null,
  open_slot bigint,                           -- null until known (future timestamp activation)
  transfer_hook boolean not null default false,
  graduated_slot bigint,
  graduated_at timestamptz,
  graduated_sig text,
  source text not null                         -- 'grpc' | 'rpc'
);
create index if not exists pools_config on pools (config);
create index if not exists pools_create_slot on pools (create_slot desc);

-- Only buys inside the 10-slot window are kept: the DB stays small.
create table if not exists window_buys (
  sig text not null,
  pool text not null references pools (address) on delete cascade,
  idx smallint not null,                      -- position among this pool's buys in the tx
  slot bigint not null,
  slot_offset smallint not null,
  payer text,
  is_creator boolean not null,
  via_cpi boolean not null,
  quote_in numeric not null,
  fee numeric not null,
  base_out numeric not null,
  confirmed boolean not null default false,
  primary key (sig, pool, idx)
);
create index if not exists window_buys_pool on window_buys (pool);

create table if not exists pool_windows (
  pool text primary key references pools (address) on delete cascade,
  config text not null,
  creator text not null,
  snp10 double precision not null,
  per_slot double precision[] not null,
  nc_wallets int not null,
  top3_share double precision not null,
  creator_base numeric not null,
  nc_base numeric not null,
  nc_fees numeric not null,
  buys int not null,
  complete boolean not null,
  source text not null,
  finalized_at timestamptz not null default now()
);
create index if not exists pool_windows_config on pool_windows (config);

create table if not exists config_stats (
  config text primary key,
  launches int not null,
  creators int not null,
  top_creator_share double precision not null,
  snp10_p50 double precision,
  snp10_p90 double precision,
  ci_lo double precision,
  ci_hi double precision,
  median_strip double precision[],
  grad_rate double precision,
  grad_aged int not null,
  t_grad_p50 double precision,
  eligible boolean not null,
  rank int,
  tied boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Recent decoded events for /integrations/verify (pruned to the last few thousand).
create table if not exists events (
  id bigserial primary key,
  kind text not null,
  slot bigint not null,
  sig text not null,
  pool text,
  config text,
  payer text,
  detail jsonb,
  source text not null,
  seen_at timestamptz not null default now()
);
create index if not exists events_id_desc on events (id desc);

-- Curvebook presets: DBC configs whose fee_claimer is a curvebook_router vault PDA.
create table if not exists presets (
  config text primary key,
  name text not null,
  slug text unique not null,
  author text not null,
  author_bps int not null,
  vault text not null,
  create_sig text,
  register_sig text,
  params jsonb,
  network text not null default 'mainnet-beta'
);

-- Launches sent through Curvebook (own or third-party).
create table if not exists launches (
  pool text primary key,
  preset text not null,
  wallet text not null,
  base_mint text not null,
  sig text not null,
  landed_slot bigint,
  via text not null,                           -- 'beam' | 'rpc'
  swqos jsonb,
  third_party boolean not null default false,
  created_at timestamptz not null default now()
);

-- Relay guard (D3): the worker only lands transactions whose message it issued.
create table if not exists issued_tx (
  hash text primary key,
  preset text not null,
  wallet text not null,
  pool text not null,
  base_mint text not null,
  last_valid_block_height bigint not null,
  expires_at timestamptz not null
);

create table if not exists health (
  id int primary key default 1,
  source text not null,
  started_at timestamptz not null,
  capture_start_slot bigint,
  last_slot bigint,
  chain_slot bigint,
  lag_slots int,
  reconnects int not null default 0,
  last_from_slot bigint,
  pools_seen bigint not null default 0,
  windows_final bigint not null default 0,
  windows_incomplete bigint not null default 0,
  skipped_transfer_hook bigint not null default 0,
  rpc_errors bigint not null default 0,
  updated_at timestamptz not null default now()
);
