//! Pure split math, kept free of account types so it can be property-tested on the host.

pub const BPS_DENOMINATOR: u64 = 10_000;
/// The treasury always keeps at least 10%; this is what pays for the router's crank.
pub const MAX_AUTHOR_BPS: u16 = 9_000;

/// Splits `claimed` into (author, treasury). The author share rounds down, so the
/// rounding remainder always lands in the treasury and the two parts sum to `claimed`.
/// Returns `None` for an out-of-range `author_bps`; the arithmetic itself cannot overflow
/// because the product is formed in u128 and the quotient is ≤ `claimed`.
pub fn split(claimed: u64, author_bps: u16) -> Option<(u64, u64)> {
    if author_bps > MAX_AUTHOR_BPS {
        return None;
    }
    let author = (claimed as u128)
        .checked_mul(author_bps as u128)?
        .checked_div(BPS_DENOMINATOR as u128)?;
    let author = u64::try_from(author).ok()?;
    let treasury = claimed.checked_sub(author)?;
    Some((author, treasury))
}

#[cfg(test)]
mod tests {
    use super::*;

    const AMOUNTS: [u64; 12] = [
        0, 1, 2, 9, 10, 9_999, 10_000, 10_001, 1_000_000_007, u32::MAX as u64,
        u64::MAX - 1, u64::MAX,
    ];
    const BPS: [u16; 8] = [0, 1, 2_500, 4_999, 5_000, 7_777, 8_999, 9_000];

    #[test]
    fn i2_parts_sum_to_claimed_exactly() {
        for &a in &AMOUNTS {
            for &b in &BPS {
                let (author, treasury) = split(a, b).unwrap();
                assert_eq!(author.checked_add(treasury), Some(a), "a={a} b={b}");
            }
        }
    }

    #[test]
    fn i2_remainder_goes_to_treasury() {
        // 1 lamport at 90%: author floor(0.9) = 0, treasury takes it.
        assert_eq!(split(1, 9_000), Some((0, 1)));
        // 10_001 at 50%: author 5_000, treasury 5_001.
        assert_eq!(split(10_001, 5_000), Some((5_000, 5_001)));
        for &a in &AMOUNTS {
            for &b in &BPS {
                let (author, _) = split(a, b).unwrap();
                let exact = (a as u128) * (b as u128);
                // author is the floor: author*D ≤ a*b < (author+1)*D
                assert!((author as u128) * 10_000 <= exact);
                assert!(exact < (author as u128 + 1) * 10_000);
            }
        }
    }

    #[test]
    fn i2_zero_and_extremes() {
        assert_eq!(split(0, 9_000), Some((0, 0)));
        assert_eq!(split(0, 0), Some((0, 0)));
        assert_eq!(split(u64::MAX, 0), Some((0, u64::MAX)));
        let (author, treasury) = split(u64::MAX, 9_000).unwrap();
        assert_eq!(author, ((u64::MAX as u128) * 9 / 10) as u64);
        assert_eq!(author + treasury, u64::MAX);
        assert!(treasury >= u64::MAX / 10);
    }

    #[test]
    fn i5_bps_above_cap_rejected() {
        assert_eq!(split(100, 9_001), None);
        assert_eq!(split(100, u16::MAX), None);
    }

    #[test]
    fn i2_pseudo_random_sweep() {
        // Deterministic xorshift so failures reproduce without a proptest dependency.
        let mut s: u64 = 0x9E37_79B9_7F4A_7C15;
        for _ in 0..100_000 {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            let amount = s;
            let bps = (s % 9_001) as u16;
            let (author, treasury) = split(amount, bps).unwrap();
            assert_eq!(author as u128 + treasury as u128, amount as u128);
            assert!(author <= amount);
        }
    }
}
