//! Opens the needed remote files and range-reads single values from them.

use crate::http;
use crate::model::{Key, Source};
use omfiles::reader::OmFileReader;
use rayon::prelude::*;
use std::collections::HashMap;
use std::sync::Arc;

type Reader = OmFileReader<http::HttpBackend>;

fn open(agent: &ureq::Agent, stats: &Arc<http::Stats>, src: Source) -> Result<Reader, String> {
    let url = src.url();
    let backend = http::HttpBackend::open(agent.clone(), url.clone(), stats.clone())?;
    OmFileReader::new(Arc::new(backend)).map_err(|e| format!("{url}: {e}"))
}

/// Read every distinct key once: open each needed file, then range-read the single values.
/// Returns the values and the number of distinct reads.
pub fn read_keys(
    pool: &rayon::ThreadPool,
    agent: &ureq::Agent,
    stats: &Arc<http::Stats>,
    mut keys: Vec<Key>,
) -> (HashMap<Key, Result<f32, String>>, usize) {
    let mut sources: Vec<Source> = keys.iter().map(|k| k.0).collect();
    sources.sort_by_key(|s| s.url());
    sources.dedup();
    let readers: HashMap<Source, Result<Reader, String>> =
        pool.install(|| sources.par_iter().map(|&s| (s, open(agent, stats, s))).collect());

    keys.sort_by_key(|k| (k.0.url(), k.1, k.2, k.3));
    keys.dedup();
    let total = keys.len();
    let values = pool.install(|| {
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
            .collect::<HashMap<_, _>>()
    });
    (values, total)
}
