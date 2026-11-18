//! `lookup`: read ERA5 cloud cover for a batch of (lat, lng, time) rows.
//!
//! ERA5 up to 2023 lives in one file per year (`year_YYYY.om`, dims [lat, lon, hour of year]);
//! later data is in 504-hour chunk files (`chunk_N.om`, N = hours since 1970 / 504). Each file is
//! opened once and every row reads a single value from it with range requests.

use crate::BASE;
use crate::http;
use omfiles::reader::OmFileReader;
use omfiles::traits::OmArrayVariable;
use rayon::prelude::*;
use serde::Deserialize;
use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;

const CHUNK_HOURS: i64 = 504;
const LAST_YEAR_FILE: i64 = 2023;

#[derive(Deserialize)]
struct Row {
    id: serde_json::Value,
    lat: f64,
    lng: f64,
    t: f64,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Source {
    Year(i64),
    Chunk(i64),
}

impl Source {
    fn file(self) -> String {
        match self {
            Source::Year(y) => format!("year_{y}.om"),
            Source::Chunk(n) => format!("chunk_{n}.om"),
        }
    }
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn year_of(days: i64) -> i64 {
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    yoe + era * 400 + if m <= 2 { 1 } else { 0 }
}

type Key = (Source, u64, u64, u64);

/// Where a row's value lives: file, and (lat index, lon index, time index) inside it.
fn locate(row: &Row) -> Result<Key, String> {
    if !(row.lat.is_finite() && row.lng.is_finite() && row.t.is_finite()) {
        return Err("not a number".into());
    }
    if !(-90.0..=90.0).contains(&row.lat) || !(-180.0..=180.0).contains(&row.lng) {
        return Err("coordinates out of range".into());
    }
    let hour_abs = (row.t / 3600.0).floor() as i64;
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
    let j = (((row.lng + 180.0).rem_euclid(360.0) / 0.25).round() as u64) % 1440;
    Ok((src, i, j, idx as u64))
}

type Reader = OmFileReader<http::HttpBackend>;

fn open(agent: &ureq::Agent, stats: &Arc<http::Stats>, src: Source) -> Result<Reader, String> {
    let url = format!("{BASE}/{}", src.file());
    let backend = http::HttpBackend::open(agent.clone(), url, stats.clone())?;
    OmFileReader::new(Arc::new(backend)).map_err(|e| format!("{}: {e}", src.file()))
}

const STATIC_ELEVATION: &str = "https://openmeteo.s3.amazonaws.com/data/copernicus_era5/static/HSURF.om";
const NY: usize = 721;
const NX: usize = 1440;

/// ERA5 surface elevation for the whole grid; -999 marks sea cells. One small file (~380 KB).
fn load_elevation(agent: &ureq::Agent, stats: &Arc<http::Stats>) -> Result<Vec<f32>, String> {
    let backend = http::HttpBackend::open(agent.clone(), STATIC_ELEVATION.into(), stats.clone())?;
    let reader = OmFileReader::new(Arc::new(backend)).map_err(|e| e.to_string())?;
    let arr = reader.expect_array().map_err(|e| e.to_string())?;
    if arr.get_dimensions() != [NY as u64, NX as u64] {
        return Err(format!("unexpected elevation dims {:?}", arr.get_dimensions()));
    }
    let data = arr.read::<f32>(&[0..NY as u64, 0..NX as u64]).map_err(|e| e.to_string())?;
    Ok(data.iter().copied().collect())
}

/// Open-Meteo's default `cell_selection=land` avoids sea cells for coastal points. Without the
/// point's own elevation the full rule cannot be reproduced, so when the nearest cell is sea this
/// takes the nearest land cell among the 3x3 around it (the API considers the same 3x3).
fn snap_to_land(elev: &[f32], lat: f64, lng: f64, i: u64, j: u64) -> (u64, u64) {
    let is_sea = |y: usize, x: usize| {
        let e = elev[y * NX + x];
        e.is_nan() || e <= -999.0
    };
    if !is_sea(i as usize, j as usize) {
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
            if is_sea(y as usize, x) {
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

fn emit(out: &mut impl Write, v: serde_json::Value) {
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

pub fn inspect(file: &str) {
    let stats = Arc::new(http::Stats::default());
    let agent = http::agent(4);
    let backend = http::HttpBackend::open(agent, format!("{BASE}/{file}"), stats).expect("open");
    let reader = OmFileReader::new(Arc::new(backend)).expect("om reader");
    let arr = reader.expect_array().expect("array");
    println!("{file}: dims {:?} chunks {:?}", arr.get_dimensions(), arr.get_chunk_dimensions());
}

pub fn run(input: Option<&str>, threads: usize) {
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

    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads.max(1)).build().unwrap();
    let stats = Arc::new(http::Stats::default());
    let agent = http::agent(threads);

    let elevation = match load_elevation(&agent, &stats) {
        Ok(e) => Some(e),
        Err(e) => {
            emit(&mut out, serde_json::json!({ "warn": format!("no land mask, using nearest cell: {e}") }));
            None
        }
    };

    // Locate every row; bad rows are reported straight away.
    let mut located: Vec<(usize, Key)> = Vec::with_capacity(rows.len());
    for (n, row) in rows.iter().enumerate() {
        match locate(row) {
            Ok((s, i, j, t)) => {
                let (i, j) = match &elevation {
                    Some(e) => snap_to_land(e, row.lat, row.lng, i, j),
                    None => (i, j),
                };
                located.push((n, (s, i, j, t)));
            }
            Err(e) => emit(&mut out, serde_json::json!({ "id": row.id, "error": e })),
        }
    }

    // Open each needed file once, in parallel.
    let mut sources: Vec<Source> = located.iter().map(|l| l.1.0).collect();
    sources.sort_by_key(|s| s.file());
    sources.dedup();
    let readers: HashMap<Source, Result<Reader, String>> =
        pool.install(|| sources.par_iter().map(|&s| (s, open(&agent, &stats, s))).collect());

    // Identical (file, cell, hour) lookups are read once.
    let mut keys: Vec<Key> = located.iter().map(|l| l.1).collect();
    keys.sort_by_key(|k| (k.0.file(), k.1, k.2, k.3));
    keys.dedup();
    let total = keys.len();
    let values: HashMap<Key, Result<f32, String>> = pool.install(|| {
        keys.par_iter()
            .map(|&k| {
                let r = match &readers[&k.0] {
                    Err(e) => Err(e.clone()),
                    Ok(reader) => reader
                        .expect_array()
                        .map_err(|e| e.to_string())
                        .and_then(|a| {
                            a.read::<f32>(&[k.1..k.1 + 1, k.2..k.2 + 1, k.3..k.3 + 1])
                                .map_err(|e| e.to_string())
                        })
                        .and_then(|v| v.iter().next().copied().ok_or_else(|| "empty read".to_string())),
                };
                (k, r)
            })
            .collect()
    });

    for (n, key) in &located {
        let id = &rows[*n].id;
        match &values[key] {
            Ok(v) if v.is_finite() => emit(
                &mut out,
                serde_json::json!({ "id": id, "cloudCover": (*v as f64 * 10.0).round() / 10.0 }),
            ),
            Ok(_) => emit(&mut out, serde_json::json!({ "id": id, "error": "no data" })),
            Err(e) => emit(&mut out, serde_json::json!({ "id": id, "error": e })),
        }
    }
    emit(
        &mut out,
        serde_json::json!({ "done": true, "rows": rows.len(), "reads": total,
            "requests": stats.requests.load(std::sync::atomic::Ordering::Relaxed) }),
    );
}
