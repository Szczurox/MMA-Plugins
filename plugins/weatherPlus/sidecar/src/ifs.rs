//! ECMWF IFS HRES (~9 km, 2017 on) on its O1280 reduced Gaussian grid. Files are 504-hour chunks
//! `chunk_N.om`, dims [1, gridpoint, hour in chunk]. The grid math mirrors Open-Meteo's
//! `GaussianGrid.swift`: latitude line y (0 = northernmost) has 20 + 4y points, mirrored in the
//! southern half, and grid points are numbered line by line.

use crate::model::{CHUNK_HOURS, Key, Row, Source};
use crate::statics::is_sea;

/// First hour (hours since 1970) served by this tier: 2017-01-01 00:00 UTC.
pub const START_HOUR: i64 = 17167 * 24;
pub const ELEVATION: &str = "https://openmeteo.s3.amazonaws.com/data/ecmwf_ifs/static/HSURF.om";

const LINES: i64 = 1280;
/// 6_599_680 grid points.
pub const COUNT: i64 = 4 * LINES * (LINES + 9);

/// Number of grid points on latitude line `y`.
fn nx(y: i64) -> i64 {
    if y < LINES { 20 + y * 4 } else { (2 * LINES - y - 1) * 4 + 20 }
}

/// Index of the first grid point of latitude line `y`.
fn integral(y: i64) -> i64 {
    if y < LINES {
        2 * y * y + 18 * y
    } else {
        let m = 2 * LINES - y;
        COUNT - (2 * m * m + 18 * m)
    }
}

/// The 3x3 grid points around a coordinate (three neighbours on each of three latitude lines) as
/// (distance^2, gridpoint), the way Open-Meteo picks candidates for land selection.
fn surrounding(lat: f64, lng: f64) -> [(f64, i64); 9] {
    let dy = 180.0 / (2.0 * LINES as f64 + 0.5);
    let center_y = (((LINES - 1) as f64 - (lat - dy / 2.0) / dy).round() as i64).clamp(1, 2 * LINES - 2);
    let mut out = [(f64::MAX, 0i64); 9];
    for j in 0..3i64 {
        let y = center_y + j - 1;
        let nx = nx(y);
        let dx = 360.0 / nx as f64;
        let x_center = (lng / dx).round() as i64;
        let point_lat = (LINES - y - 1) as f64 * dy + dy / 2.0;
        for i in 0..3i64 {
            let x = x_center + i - 1;
            let gridpoint = integral(y) + x.rem_euclid(nx);
            let d = (point_lat - lat).powi(2) + (x as f64 * dx - lng).powi(2);
            out[(j * 3 + i) as usize] = (d, gridpoint);
        }
    }
    out
}

/// Nearest grid point; when it is sea and the elevation grid is known, the nearest land point of
/// the 3x3 around it (as `cell_selection=land` does without a point elevation).
fn gridpoint(lat: f64, lng: f64, elev: Option<&[f32]>) -> i64 {
    let cands = surrounding(lat, lng);
    let nearest = cands.iter().copied().min_by(|a, b| a.0.total_cmp(&b.0)).unwrap();
    let Some(e) = elev else { return nearest.1 };
    if !is_sea(e[nearest.1 as usize]) {
        return nearest.1;
    }
    cands
        .iter()
        .copied()
        .filter(|c| !is_sea(e[c.1 as usize]))
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map_or(nearest.1, |c| c.1)
}

/// Where the row's value is, at `hour_abs` (hours since 1970).
pub fn key(row: &Row, hour_abs: i64, elev: Option<&[f32]>) -> Key {
    let n = hour_abs.div_euclid(CHUNK_HOURS);
    let gp = gridpoint(row.lat, row.lng, elev);
    (Source::IfsChunk(n), 0, gp as u64, (hour_abs - n * CHUNK_HOURS) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::{days_from_civil, ts};

    #[test]
    fn start_is_2017_01_01_utc() {
        assert_eq!(START_HOUR, days_from_civil(2017, 1, 1) * 24);
        assert_eq!(START_HOUR * 3600, 1_483_228_800);
        assert_eq!(ts(2017, 1, 1, 0) as i64, START_HOUR * 3600);
    }

    #[test]
    fn grid_has_the_documented_size() {
        assert_eq!(COUNT, 6_599_680);
        assert_eq!(integral(0), 0);
        assert_eq!(integral(LINES), COUNT / 2);
        assert_eq!(integral(2 * LINES), COUNT);
        assert_eq!(nx(0), 20);
        assert_eq!(nx(LINES - 1), 20 + 4 * (LINES - 1));
        assert_eq!(nx(LINES), nx(LINES - 1));
        assert_eq!(nx(2 * LINES - 1), 20);
    }

    #[test]
    fn latitude_lines_are_contiguous_and_mirrored() {
        for y in 0..2 * LINES {
            assert_eq!(integral(y) + nx(y), integral(y + 1), "line {y}");
            assert_eq!(nx(y), nx(2 * LINES - 1 - y), "mirror of {y}");
        }
    }

    /// Latitude and longitude of a grid point, as Open-Meteo's `getCoordinates` computes them.
    fn coords(y: i64, x: i64) -> (f64, f64) {
        let dy = 180.0 / (2.0 * LINES as f64 + 0.5);
        let lon = x as f64 * (360.0 / nx(y) as f64);
        ((LINES - y - 1) as f64 * dy + dy / 2.0, if lon >= 180.0 { lon - 360.0 } else { lon })
    }

    #[test]
    fn grid_point_coordinates_map_back_to_themselves() {
        for y in (0..2 * LINES).step_by(37).chain([0, 1, 2, 1278, 1279, 1280, 1281, 2557, 2558, 2559]) {
            let n = nx(y);
            for x in [0, 1, n / 4, n / 2 - 1, n / 2, n - 2, n - 1] {
                let (lat, lng) = coords(y, x);
                assert_eq!(gridpoint(lat, lng, None), integral(y) + x, "line {y} x {x}");
            }
        }
    }

    #[test]
    fn gridpoint_stays_in_range_at_the_edges() {
        for lat in [-90.0, -89.99, -45.0, 0.0, 45.0, 89.99, 90.0] {
            for lng in [-180.0, -179.99, -90.0, 0.0, 90.0, 179.99, 180.0] {
                let gp = gridpoint(lat, lng, None);
                assert!((0..COUNT).contains(&gp), "({lat}, {lng}) -> {gp}");
            }
        }
    }

    #[test]
    fn gridpoint_is_a_nearby_point() {
        // A deterministic scatter; the chosen point must be within one cell of the target.
        let mut s = 7u64;
        let mut rnd = || {
            s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (s >> 33) as f64 / (1u64 << 31) as f64
        };
        for _ in 0..2000 {
            let lat = (rnd() * 2.0 - 1.0).asin().to_degrees();
            let lng = rnd() * 360.0 - 180.0;
            let gp = gridpoint(lat, lng, None);
            let y = (0..2 * LINES).rev().find(|&y| integral(y) <= gp).unwrap();
            let (plat, plng) = coords(y, gp - integral(y));
            let dlng = ((plng - lng + 540.0).rem_euclid(360.0) - 180.0) * lat.to_radians().cos();
            assert!((plat - lat).abs() < 0.2 && dlng.abs() < 0.2, "({lat}, {lng}) -> ({plat}, {plng})");
        }
    }

    #[test]
    fn land_snap_prefers_nearest_land_in_the_3x3() {
        let (lat, lng) = (35.0, 139.7);
        let cands = surrounding(lat, lng);
        let nearest = gridpoint(lat, lng, None);

        // All sea: keep the nearest point.
        let mut elev = vec![-999.0f32; COUNT as usize];
        assert_eq!(gridpoint(lat, lng, Some(&elev)), nearest);

        // Only one neighbour is land: it wins over the (sea) nearest.
        let other = cands.iter().find(|c| c.1 != nearest).unwrap().1;
        elev[other as usize] = 12.0;
        assert_eq!(gridpoint(lat, lng, Some(&elev)), other);

        // Nearest is land: it wins even when another neighbour is land too.
        elev[nearest as usize] = 5.0;
        assert_eq!(gridpoint(lat, lng, Some(&elev)), nearest);
    }

    #[test]
    fn key_uses_the_chunk_layout() {
        // 2024-07-15 12:00 UTC is hour 478068 since 1970: chunk 948, offset 276.
        let k = key(&Row::at(52.52, 13.405, 0.0), 478_068, None);
        assert!(k.0 == Source::IfsChunk(948));
        assert_eq!((k.1, k.3), (0, 276));
        assert!((0..COUNT as u64).contains(&k.2));
    }
}
