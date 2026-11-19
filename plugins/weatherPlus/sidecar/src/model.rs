//! Shared types: an input row, and where a value lives in the bucket.

use crate::{BASE, IFS_BASE};
use serde::Deserialize;

/// Hours per `chunk_N.om` file (21 days); N = hours since 1970 / 504.
pub const CHUNK_HOURS: i64 = 504;

#[derive(Deserialize)]
pub struct Row {
    pub id: serde_json::Value,
    pub lat: f64,
    pub lng: f64,
    /// Unix seconds; floored to the UTC hour.
    pub t: f64,
}

#[cfg(test)]
impl Row {
    pub fn at(lat: f64, lng: f64, t: f64) -> Row {
        Row { id: serde_json::Value::Null, lat, lng, t }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum Source {
    /// ERA5 `year_YYYY.om`, dims [lat, lon, hour of year].
    Year(i64),
    /// ERA5 `chunk_N.om`, dims [lat, lon, hour in chunk].
    Chunk(i64),
    /// IFS `chunk_N.om`, dims [1, gridpoint, hour in chunk].
    IfsChunk(i64),
}

impl Source {
    pub fn url(self) -> String {
        match self {
            Source::Year(y) => format!("{BASE}/year_{y}.om"),
            Source::Chunk(n) => format!("{BASE}/chunk_{n}.om"),
            Source::IfsChunk(n) => format!("{IFS_BASE}/chunk_{n}.om"),
        }
    }
}

/// (file, a, b, c): the start of the single-value read in each of the file's three dimensions.
/// ERA5: lat, lon, hour. IFS: 0, gridpoint, hour.
pub type Key = (Source, u64, u64, u64);
