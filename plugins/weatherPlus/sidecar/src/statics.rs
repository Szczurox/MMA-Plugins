//! Land masks: small static elevation grids (-999 marks sea). They never change, so each is fetched
//! in one GET and kept on disk; later batches load it in about 0.1 s.

use crate::http;
use omfiles::reader::OmFileReader;
use omfiles::traits::OmArrayVariable;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

/// Where masks are cached: `<data_dir>/weatherPlus-cache` when the host gives a data dir.
static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_cache_dir(data_dir: &str) {
    let _ = CACHE_DIR.set(std::path::Path::new(data_dir).join("weatherPlus-cache"));
}

pub fn is_sea(elevation: f32) -> bool {
    elevation.is_nan() || elevation <= -999.0
}

fn cache_path(url: &str) -> PathBuf {
    let dir = CACHE_DIR.get().cloned().unwrap_or_else(|| std::env::temp_dir().join("mma-weather-plus"));
    let name: String = url
        .trim_start_matches("https://")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' { c } else { '_' })
        .collect();
    dir.join(name)
}

/// The whole elevation grid from `url`, whose array must have dimensions `dims`.
pub fn load_elevation(
    agent: &ureq::Agent,
    stats: &Arc<http::Stats>,
    url: &str,
    dims: &[u64],
) -> Result<Vec<f32>, String> {
    let path = cache_path(url);
    if let Ok(bytes) = std::fs::read(&path) {
        match decode(bytes, dims) {
            Ok(v) => return Ok(v),
            Err(e) => {
                eprintln!("lookup: dropping bad cached {}: {e}", path.display());
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    let t0 = std::time::Instant::now();
    let backend = http::MemBackend::download(agent, url, stats)?;
    eprintln!("lookup: downloaded {url} in {:.1}s", t0.elapsed().as_secs_f64());
    let decoded = decode(backend.0.clone(), dims)?;
    if let Some(dir) = path.parent() {
        let tmp = path.with_extension("part");
        if std::fs::create_dir_all(dir).is_ok() && std::fs::write(&tmp, &backend.0).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
    }
    Ok(decoded)
}

fn decode(bytes: Vec<u8>, dims: &[u64]) -> Result<Vec<f32>, String> {
    let reader = OmFileReader::new(Arc::new(http::MemBackend(bytes))).map_err(|e| e.to_string())?;
    let arr = reader.expect_array().map_err(|e| e.to_string())?;
    if arr.get_dimensions() != dims {
        return Err(format!("unexpected elevation dims {:?}", arr.get_dimensions()));
    }
    let ranges: Vec<std::ops::Range<u64>> = dims.iter().map(|&d| 0..d).collect();
    let data = arr.read::<f32>(&ranges).map_err(|e| e.to_string())?;
    Ok(data.iter().copied().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sea_is_minus_999_or_missing() {
        assert!(is_sea(-999.0));
        assert!(is_sea(f32::NAN));
        assert!(!is_sea(0.0));
        assert!(!is_sea(-50.0), "below sea level is still land");
    }

    #[test]
    fn cache_names_are_flat_and_distinct_per_url() {
        let a = cache_path("https://openmeteo.s3.amazonaws.com/data/copernicus_era5/static/HSURF.om");
        let b = cache_path("https://openmeteo.s3.amazonaws.com/data/ecmwf_ifs/static/HSURF.om");
        assert_ne!(a, b);
        let name = a.file_name().unwrap().to_string_lossy().to_string();
        assert!(!name.contains('/') && !name.contains(':'), "{name}");
    }

    #[test]
    fn a_corrupt_mask_is_rejected_not_trusted() {
        assert!(decode(vec![1, 2, 3, 4], &[1, 4]).is_err());
        assert!(decode(Vec::new(), &[1, 4]).is_err());
    }
}
