//! Calendar helpers (UTC, proleptic Gregorian), so no date crate is needed.

/// Days since 1970-01-01 for a date (Howard Hinnant's algorithm).
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// The calendar year containing a day number (days since 1970-01-01).
pub fn year_of(days: i64) -> i64 {
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    yoe + era * 400 + if m <= 2 { 1 } else { 0 }
}

/// Unix seconds for a UTC date and hour, for tests.
#[cfg(test)]
pub fn ts(y: i64, m: i64, d: i64, h: i64) -> f64 {
    ((days_from_civil(y, m, d) * 24 + h) * 3600) as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates_round_trip() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11017);
        for days in (-25000..30000).step_by(7) {
            let y = year_of(days);
            assert!(days_from_civil(y, 1, 1) <= days && days < days_from_civil(y + 1, 1, 1), "day {days}");
        }
    }
}
