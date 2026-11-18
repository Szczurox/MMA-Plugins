//! A read-only `OmFileReaderBackend` over HTTP range requests.

use omfiles::OmFilesError;
use omfiles::traits::OmFileReaderBackend;
use std::io::Read;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Default)]
pub struct Stats {
    pub requests: AtomicU64,
    pub bytes: AtomicU64,
}

impl Stats {
    pub fn reset(&self) {
        self.requests.store(0, Ordering::Relaxed);
        self.bytes.store(0, Ordering::Relaxed);
    }
}

pub fn agent(pool: usize) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .max_idle_connections_per_host(pool.max(4))
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout_read(std::time::Duration::from_secs(60))
        .build()
}

pub struct HttpBackend {
    agent: ureq::Agent,
    url: String,
    len: usize,
    stats: Arc<Stats>,
}

impl HttpBackend {
    pub fn open(agent: ureq::Agent, url: String, stats: Arc<Stats>) -> Result<Self, String> {
        let head = agent.head(&url).call().map_err(|e| format!("HEAD {url}: {e}"))?;
        let len = head
            .header("Content-Length")
            .and_then(|v| v.parse::<usize>().ok())
            .ok_or_else(|| format!("no Content-Length for {url}"))?;
        stats.requests.fetch_add(1, Ordering::Relaxed);
        Ok(Self { agent, url, len, stats })
    }
}

impl OmFileReaderBackend for HttpBackend {
    type Bytes<'a> = Vec<u8>;

    fn count(&self) -> usize {
        self.len
    }

    fn prefetch_data(&self, _offset: usize, _count: usize) {}

    fn get_bytes(&self, offset: u64, count: u64) -> Result<Vec<u8>, OmFilesError> {
        if count == 0 {
            return Ok(Vec::new());
        }
        let range = format!("bytes={}-{}", offset, offset + count - 1);
        let mut last = String::new();
        // Transient S3 hiccups are routine at this request volume.
        for attempt in 0..4 {
            match self.agent.get(&self.url).set("Range", &range).call() {
                Ok(resp) => {
                    let mut buf = Vec::with_capacity(count as usize);
                    match resp.into_reader().take(count).read_to_end(&mut buf) {
                        Ok(_) if buf.len() as u64 == count => {
                            self.stats.requests.fetch_add(1, Ordering::Relaxed);
                            self.stats.bytes.fetch_add(count, Ordering::Relaxed);
                            return Ok(buf);
                        }
                        Ok(_) => last = format!("short read {} of {count}", buf.len()),
                        Err(e) => last = e.to_string(),
                    }
                }
                Err(e) => last = e.to_string(),
            }
            std::thread::sleep(std::time::Duration::from_millis(200 * (attempt + 1)));
        }
        Err(OmFilesError::GenericError(format!("range {range} of {}: {last}", self.url)))
    }
}
