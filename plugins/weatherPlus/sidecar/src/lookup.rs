//! `lookup`: read cloud cover for a batch of (lat, lng, time) rows from Open-Meteo's public bucket.
//!
//! Two tiers, picked per row by capture time:
//!   * 2017-01-01 and later: ECMWF IFS HRES, ~9 km (`ifs`).
//!   * earlier, and as a fallback when IFS has no value: ERA5, 0.25 degree (`era5`).
//!
//! Each file is opened once and every row reads a single value from it with range requests.

use crate::model::{Key, Row};
use crate::reader::read_keys;
use crate::statics::{load_elevation, set_cache_dir};
use crate::{BASE, era5, http, ifs};
use omfiles::reader::OmFileReader;
use omfiles::traits::OmArrayVariable;
use std::io::Write;
use std::sync::Arc;

/// Where a row's value lives: the preferred key and, for IFS rows, the ERA5 key to fall back on.
struct Located {
    n: usize,
    primary: Key,
    fallback: Option<Key>,
}

/// Land masks per tier; `None` when one could not be loaded (the nearest cell is used then).
struct Elevations {
    era5: Option<Vec<f32>>,
    ifs: Option<Vec<f32>>,
}

fn locate(n: usize, row: &Row, elev: &Elevations) -> Result<Located, String> {
    if !(row.lat.is_finite() && row.lng.is_finite() && row.t.is_finite()) {
        return Err("not a number".into());
    }
    if !(-90.0..=90.0).contains(&row.lat) || !(-180.0..=180.0).contains(&row.lng) {
        return Err("coordinates out of range".into());
    }
    let hour_abs = (row.t / 3600.0).floor() as i64;
    let era5 = era5::key(row, hour_abs, elev.era5.as_deref());
    if hour_abs >= ifs::START_HOUR {
        return Ok(Located { n, primary: ifs::key(row, hour_abs, elev.ifs.as_deref()), fallback: era5.ok() });
    }
    era5.map(|k| Located { n, primary: k, fallback: None })
}

fn emit(out: &mut impl Write, v: serde_json::Value) {
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

/// Print the dimensions of a remote file (a full URL, or a name under the ERA5 base).
pub fn inspect(file: &str) {
    let stats = Arc::new(http::Stats::default());
    let agent = http::agent(4);
    let url = if file.starts_with("http") { file.to_string() } else { format!("{BASE}/{file}") };
    let backend = http::HttpBackend::open(agent, url, stats).expect("open");
    let reader = OmFileReader::new(Arc::new(backend)).expect("om reader");
    let arr = reader.expect_array().expect("array");
    println!("{file}: dims {:?} chunks {:?}", arr.get_dimensions(), arr.get_chunk_dimensions());
}

pub fn run(input: Option<&str>, threads: usize, data_dir: Option<&str>) {
    if let Some(dir) = data_dir {
        set_cache_dir(dir);
    }
    let mut out = std::io::stdout().lock();
    eprintln!("lookup: input {:?}, {threads} threads", input);
    let text = match input {
        Some(path) => std::fs::read_to_string(path).map_err(|e| e.to_string()),
        None => {
            let mut s = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut s).map(|_| s).map_err(|e| e.to_string())
        }
    };
    let rows: Vec<Row> = match text.and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string())) {
        Ok(r) => r,
        Err(e) => {
            emit(&mut out, serde_json::json!({ "fatal": format!("bad input: {e}") }));
            std::process::exit(2);
        }
    };
    process(&rows, threads, out);
}

/// Resolve every row and write one JSON line per row, then a `done` line, to `out`.
fn process(rows: &[Row], threads: usize, mut out: impl Write) {
    let started = std::time::Instant::now();
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads.max(1)).build().unwrap();
    let stats = Arc::new(http::Stats::default());
    let agent = http::agent(threads);

    let mut mask = |what: &str, url: &str, dims: &[u64]| match load_elevation(&agent, &stats, url, dims) {
        Ok(e) => Some(e),
        Err(e) => {
            emit(&mut out, serde_json::json!({ "warn": format!("no {what} land mask, using nearest cell: {e}") }));
            None
        }
    };
    let elevation = Elevations {
        era5: mask("ERA5", era5::ELEVATION, &[era5::NY as u64, era5::NX as u64]),
        ifs: mask("IFS", ifs::ELEVATION, &[1, ifs::COUNT as u64]),
    };
    eprintln!("lookup: land masks loaded in {:.1}s", started.elapsed().as_secs_f64());

    // Locate every row; bad rows are reported straight away.
    let mut located: Vec<Located> = Vec::with_capacity(rows.len());
    for (n, row) in rows.iter().enumerate() {
        match locate(n, row, &elevation) {
            Ok(l) => located.push(l),
            Err(e) => emit(&mut out, serde_json::json!({ "id": row.id, "error": e })),
        }
    }

    let (mut values, mut total) = read_keys(&pool, &agent, &stats, located.iter().map(|l| l.primary).collect());
    eprintln!("lookup: {total} primary reads done at {:.1}s", started.elapsed().as_secs_f64());

    // IFS rows without a usable value fall back to ERA5.
    let usable = |v: &Result<f32, String>| matches!(v, Ok(x) if x.is_finite());
    let fallbacks: Vec<Key> =
        located.iter().filter(|l| !usable(&values[&l.primary])).filter_map(|l| l.fallback).collect();
    let mut fell_back = 0usize;
    if !fallbacks.is_empty() {
        let (more, n) = read_keys(&pool, &agent, &stats, fallbacks);
        total += n;
        values.extend(more);
    }

    for l in &located {
        let id = &rows[l.n].id;
        let mut value = &values[&l.primary];
        if !usable(value) {
            if let Some(v) = l.fallback.and_then(|k| values.get(&k)).filter(|v| usable(v)) {
                value = v;
                fell_back += 1;
            }
        }
        match value {
            Ok(v) if v.is_finite() => {
                emit(&mut out, serde_json::json!({ "id": id, "cloudCover": (*v as f64 * 10.0).round() / 10.0 }))
            }
            Ok(_) => emit(&mut out, serde_json::json!({ "id": id, "error": "no data" })),
            Err(e) => emit(&mut out, serde_json::json!({ "id": id, "error": e })),
        }
    }
    emit(
        &mut out,
        serde_json::json!({ "done": true, "rows": rows.len(), "reads": total, "fellBack": fell_back,
            "requests": stats.requests.load(std::sync::atomic::Ordering::Relaxed) }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CHUNK_HOURS, Source};
    use crate::time::ts;

    const NO_ELEV: Elevations = Elevations { era5: None, ifs: None };

    fn at(lat: f64, lng: f64, t: f64) -> Result<Located, String> {
        locate(0, &Row::at(lat, lng, t), &NO_ELEV)
    }

    #[test]
    fn rows_before_2017_use_era5_only() {
        let l = at(52.5, 13.4, ts(2016, 12, 31, 23)).ok().unwrap();
        assert!(l.primary.0 == Source::Year(2016));
        assert!(l.fallback.is_none());
        // Hour index inside the year file: Dec 31 23:00 of a leap year.
        assert_eq!(l.primary.3, 366 * 24 - 1);
    }

    #[test]
    fn rows_from_2017_use_ifs_with_an_era5_fallback() {
        let l = at(52.5, 13.4, ts(2017, 1, 1, 0)).ok().unwrap();
        let n = ifs::START_HOUR.div_euclid(CHUNK_HOURS);
        assert!(l.primary.0 == Source::IfsChunk(n));
        assert_eq!(l.primary.1, 0);
        assert_eq!(l.primary.3 as i64, ifs::START_HOUR - n * CHUNK_HOURS);
        assert!(matches!(l.fallback, Some((Source::Year(2017), ..))));

        let l = at(52.5, 13.4, ts(2025, 5, 5, 5)).ok().unwrap();
        assert!(matches!(l.primary.0, Source::IfsChunk(_)));
        assert!(matches!(l.fallback, Some((Source::Chunk(_), ..))), "2024+ ERA5 lives in chunk files");
    }

    #[test]
    fn a_known_hour_lands_in_the_expected_chunk_and_url() {
        // 2024-07-15 12:00 UTC is hour 478068 since 1970: chunk 948, offset 276.
        let l = at(52.52, 13.405, 1_721_044_800.0).ok().unwrap();
        assert!(l.primary.0 == Source::IfsChunk(948));
        assert_eq!(l.primary.3, 276);
        assert_eq!(
            Source::IfsChunk(948).url(),
            "https://openmeteo.s3.amazonaws.com/data/ecmwf_ifs/cloud_cover/chunk_948.om"
        );
    }

    #[test]
    fn times_are_floored_to_the_utc_hour() {
        let a = at(0.0, 0.0, ts(2020, 1, 1, 5) + 3599.0).ok().unwrap();
        let b = at(0.0, 0.0, ts(2020, 1, 1, 5)).ok().unwrap();
        let c = at(0.0, 0.0, ts(2020, 1, 1, 6)).ok().unwrap();
        assert!(a.primary == b.primary);
        assert!(a.primary != c.primary);
    }

    #[test]
    fn bad_rows_are_rejected() {
        let t = ts(2020, 1, 1, 0);
        assert!(at(f64::NAN, 0.0, t).is_err());
        assert!(at(0.0, f64::INFINITY, t).is_err());
        assert!(at(0.0, 0.0, f64::NAN).is_err());
        assert!(at(90.5, 0.0, t).is_err());
        assert!(at(0.0, 180.5, t).is_err());
        assert!(at(0.0, 0.0, ts(1939, 12, 31, 23)).is_err());
        assert!(at(0.0, 0.0, ts(1940, 1, 1, 0)).is_ok());
    }

    #[test]
    fn locate_uses_the_ifs_mask_when_present() {
        // All sea keeps the nearest point; marking that point as land keeps it too.
        let mut elev = Elevations { era5: None, ifs: Some(vec![-999.0; ifs::COUNT as usize]) };
        let sea = locate(0, &Row::at(35.0, 139.7, ts(2020, 1, 1, 0)), &elev).ok().unwrap();
        elev.ifs.as_mut().unwrap()[sea.primary.2 as usize] = 20.0;
        let land = locate(0, &Row::at(35.0, 139.7, ts(2020, 1, 1, 0)), &elev).ok().unwrap();
        assert_eq!(sea.primary.2, land.primary.2);
    }
}
