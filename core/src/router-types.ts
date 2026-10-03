/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/curvebook_router.json`.
 */
export type CurvebookRouter = {
  "address": "4bjaHzaDTYxKiJ7fTMWTyMbHkQtG8t1rc8nNcHHk4iKd",
  "metadata": {
    "name": "curvebookRouter",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Splits Meteora DBC partner fees between a preset author and a treasury"
  },
  "instructions": [
    {
      "name": "claimCreationSplit",
      "discriminator": [
        63,
        22,
        3,
        39,
        114,
        94,
        140,
        4
      ],
      "accounts": [
        {
          "name": "preset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  101,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "dbcConfig"
              }
            ]
          }
        },
        {
          "name": "dbcConfig",
          "relations": [
            "preset"
          ]
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "dbcConfig"
              }
            ]
          }
        },
        {
          "name": "author",
          "writable": true,
          "relations": [
            "preset"
          ]
        },
        {
          "name": "treasury",
          "writable": true,
          "relations": [
            "preset"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "dbcEventAuthority",
          "address": "8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF"
        },
        {
          "name": "dbcProgram",
          "address": "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
        }
      ],
      "args": []
    },
    {
      "name": "claimTradingSplit",
      "discriminator": [
        6,
        88,
        99,
        85,
        27,
        43,
        150,
        125
      ],
      "accounts": [
        {
          "name": "preset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  101,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "dbcConfig"
              }
            ]
          }
        },
        {
          "name": "dbcConfig",
          "relations": [
            "preset"
          ]
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "dbcConfig"
              }
            ]
          }
        },
        {
          "name": "vaultBaseAccount",
          "docs": [
            "Required by DBC even though max_amount_a = 0; must be the vault's, so a stray",
            "base payout could never leave the router's custody."
          ],
          "writable": true
        },
        {
          "name": "vaultQuoteAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenQuoteProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "authorQuoteAccount",
          "writable": true
        },
        {
          "name": "treasuryQuoteAccount",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "quoteVault",
          "writable": true
        },
        {
          "name": "baseMint"
        },
        {
          "name": "quoteMint",
          "relations": [
            "preset"
          ]
        },
        {
          "name": "tokenBaseProgram"
        },
        {
          "name": "tokenQuoteProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "dbcPoolAuthority",
          "address": "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM"
        },
        {
          "name": "dbcEventAuthority",
          "address": "8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF"
        },
        {
          "name": "dbcProgram",
          "address": "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
        }
      ],
      "args": [
        {
          "name": "maxQuote",
          "type": "u64"
        }
      ]
    },
    {
      "name": "registerPreset",
      "discriminator": [
        138,
        109,
        237,
        61,
        79,
        223,
        29,
        49
      ],
      "accounts": [
        {
          "name": "author",
          "writable": true,
          "signer": true
        },
        {
          "name": "dbcConfig",
          "docs": [
            "The DBC config keypair must co-sign. Its fee claimer is a public, derivable PDA, so",
            "without this anyone could front-run the creator and register themselves as author;",
            "the config key only ever signs in the creator's own `create_config` transaction."
          ],
          "signer": true
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "dbcConfig"
              }
            ]
          }
        },
        {
          "name": "preset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  101,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "dbcConfig"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "authorBps",
          "type": "u16"
        },
        {
          "name": "treasury",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setSplit",
      "discriminator": [
        133,
        67,
        66,
        245,
        114,
        175,
        32,
        51
      ],
      "accounts": [
        {
          "name": "author",
          "signer": true,
          "relations": [
            "preset"
          ]
        },
        {
          "name": "preset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  101,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "preset.dbc_config",
                "account": "preset"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "authorBps",
          "type": "u16"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "preset",
      "discriminator": [
        0,
        20,
        95,
        225,
        110,
        88,
        220,
        190
      ]
    }
  ],
  "events": [
    {
      "name": "royaltySplit",
      "discriminator": [
        123,
        7,
        225,
        206,
        42,
        89,
        165,
        204
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidAuthorBps",
      "msg": "author_bps must be <= 9000"
    },
    {
      "code": 6001,
      "name": "notDbcAccount",
      "msg": "Account is not owned by the Meteora DBC program"
    },
    {
      "code": 6002,
      "name": "invalidDbcAccount",
      "msg": "Account data does not match the expected DBC account type"
    },
    {
      "code": 6003,
      "name": "feeClaimerMismatch",
      "msg": "DBC config fee_claimer is not this preset's vault PDA"
    },
    {
      "code": 6004,
      "name": "unsupportedCollectFeeMode",
      "msg": "DBC config must collect fees in the quote token (collect_fee_mode = 0)"
    },
    {
      "code": 6005,
      "name": "poolConfigMismatch",
      "msg": "DBC pool belongs to a different config than this preset"
    },
    {
      "code": 6006,
      "name": "nothingToClaim",
      "msg": "Nothing was claimed from DBC"
    },
    {
      "code": 6007,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "preset",
      "docs": [
        "One registered DBC config (\"preset\"). Its vault PDA is the config's DBC fee claimer."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "dbcConfig",
            "type": "pubkey"
          },
          {
            "name": "authorBps",
            "type": "u16"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "launchesClaimed",
            "docs": [
              "Pool-creation fees claimed — one per launch on this preset."
            ],
            "type": "u64"
          },
          {
            "name": "totalSplitQuote",
            "type": "u64"
          },
          {
            "name": "totalSplitLamports",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "royaltySplit",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "preset",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "docs": [
              "0 = partner trading fee (quote token), 1 = partner pool-creation fee (lamports)."
            ],
            "type": "u8"
          },
          {
            "name": "claimed",
            "type": "u64"
          },
          {
            "name": "authorAmount",
            "type": "u64"
          },
          {
            "name": "treasuryAmount",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
