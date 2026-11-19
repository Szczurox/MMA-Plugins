//! ERA5 (regular 0.25 degree grid, 1940 on). Years up to 2023 live in one file per year
//! (`year_YYYY.om`, dims [lat, lon, hour of year]); later data is in 504-hour chunk files.

use crate::model::{CHUNK_HOURS, Key, Row, Source};
use crate::statics::is_sea;
use crate::time::{days_from_civil, year_of};

pub const NY: usize = 721;
pub const NX: usize = 1440;
pub const ELEVATION: &str = "https://openmeteo.s3.amazonaws.com/data/copernicus_era5/static/HSURF.om";

const LAST_YEAR_FILE: i64 = 2023;

/// Where the row's value is: the nearest cell (land-snapped when the mask is known) at `hour_abs`
/// (hours since 1970).
pub fn key(row: &Row, hour_abs: i64, elev: Option<&[f32]>) -> Result<Key, String> {
    let days = hour_abs.div_euclid(24);
    let year = year_of(days);
    if year < 1940 {
        return Err("before 1940".into());
    }
    let (src, idx) = if year <= LAST_YEAR_FILE {
        (Source::Year(year), hour_abs - days_from_civil(year, 1, 1) * 24)
    } else {
        let n = hour_abs.div_euclid(CHUNK_HOURS);
        (Source::Chunk(n), hour_abs - n * CHUNK_HOURS)
    };
    let i = ((row.lat + 90.0) / 0.25).round() as u64;
    let j = (((row.lng + 180.0).rem_euclid(360.0) / 0.25).round() as u64) % NX as u64;
    let (i, j) = match elev {
        Some(e) => snap_to_land(e, row.lat, row.lng, i, j),
        None => (i, j),
    };
    Ok((src, i, j, idx as u64))
}

/// Open-Meteo's default `cell_selection=land` avoids sea cells for coastal points. Without the
/// point's own elevation the full rule cannot be reproduced, so when the nearest cell is sea this
/// takes the nearest land cell among the 3x3 around it (the API considers the same 3x3).
fn snap_to_land(elev: &[f32], lat: f64, lng: f64, i: u64, j: u64) -> (u64, u64) {
    let sea = |y: usize, x: usize| is_sea(elev[y * NX + x]);
    if !sea(i as usize, j as usize) {
        return (i, j);
    }
    let mut best: Option<(f64, usize, usize)> = None;
    for dy in -1i64..=1 {
        for dx in -1i64..=1 {
            let y = i as i64 + dy;
            if y < 0 || y >= NY as i64 {
                continue;
            }
            let x = (j as i64 + dx).rem_euclid(NX as i64) as usize;
            if sea(y as usize, x) {
                continue;
            }
            let cell_lat = y as f64 * 0.25 - 90.0;
            let cell_lng = x as f64 * 0.25 - 180.0;
            let dlng = (cell_lng - lng + 540.0).rem_euclid(360.0) - 180.0;
            let d = (cell_lat - lat).powi(2) + dlng.powi(2);
            if best.is_none_or(|b| d < b.0) {
                best = Some((d, y as usize, x));
            }
        }
    }
    best.map_or((i, j), |b| (b.1 as u64, b.2 as u64))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::ts;

    #[test]
    fn land_snap_moves_off_sea_cells() {
        let (lat, lng) = (-38.0, 144.9);
        let i = ((lat + 90.0) / 0.25f64).round() as u64;
        let j = ((lng + 180.0) / 0.25f64).round() as u64;
        let mut elev = vec![-999.0f32; NY * NX];
        assert_eq!(snap_to_land(&elev, lat, lng, i, j), (i, j), "all sea keeps the nearest cell");
        elev[(i as usize + 1) * NX + j as usize] = 8.0;
        assert_eq!(snap_to_land(&elev, lat, lng, i, j), (i + 1, j));
        elev[i as usize * NX + j as usize] = 3.0;
        assert_eq!(snap_to_land(&elev, lat, lng, i, j), (i, j), "land nearest cell is kept");
    }

    #[test]
    fn land_snap_wraps_across_the_antimeridian() {
        // Nearest cell is column 0 (-180); the only land is column 1439 (-179.75 minus 360 = 179.75).
        let (lat, lng) = (10.0, -179.9);
        let i = ((lat + 90.0) / 0.25f64).round() as u64;
        let mut elev = vec![-999.0f32; NY * NX];
        elev[i as usize * NX + (NX - 1)] = 4.0;
        assert_eq!(snap_to_land(&elev, lat, lng, i, 0), (i, NX as u64 - 1));
    }

    #[test]
    fn longitude_wraps_at_the_antimeridian() {
        let t = ts(2015, 6, 1, 0);
        for lng in [180.0, -180.0] {
            let k = key(&Row::at(10.0, lng, t), t as i64 / 3600, None).unwrap();
            assert_eq!(k.2, 0, "{lng} maps to column 0");
        }
    }

    #[test]
    fn files_switch_from_year_to_chunk_after_2023() {
        let t = ts(2023, 12, 31, 23);
        let k = key(&Row::at(0.0, 0.0, t), t as i64 / 3600, None).unwrap();
        assert!(k.0 == Source::Year(2023));
        assert_eq!(k.3, 365 * 24 - 1);
        let t = ts(2024, 1, 1, 0);
        let k = key(&Row::at(0.0, 0.0, t), t as i64 / 3600, None).unwrap();
        assert!(matches!(k.0, Source::Chunk(_)));
    }

    #[test]
    fn nothing_before_1940() {
        let t = ts(1939, 12, 31, 23);
        assert!(key(&Row::at(0.0, 0.0, t), t as i64 / 3600, None).is_err());
        let t = ts(1940, 1, 1, 0);
        assert!(key(&Row::at(0.0, 0.0, t), t as i64 / 3600, None).is_ok());
    }
}
