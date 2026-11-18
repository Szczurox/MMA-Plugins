//! Weather+ bulk sidecar. Reads ERA5 cloud cover from Open-Meteo's public archive bucket with
//! HTTP range requests, so nothing large is ever downloaded or left on disk.
//!
//! Commands:
//!   lookup  --input rows.json   one JSON line per row: {"id":..,"cloudCover":..} or {"id":..,"error":..}
//!   inspect --file chunk_950.om print a remote file's dimensions
//!   bench                       throughput test on random Australian points

mod http;
mod lookup;

use clap::{Parser, Subcommand};
use omfiles::reader::OmFileReader;
use omfiles::traits::OmArrayVariable;
use rayon::prelude::*;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Instant;

pub const BASE: &str = "https://openmeteo.s3.amazonaws.com/data/copernicus_era5/cloud_cover";

#[derive(Parser)]
#[command(name = "mma-weather-plus")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Cloud cover (%) for [{id, lat, lng, t}] rows; `t` is unix seconds, floored to the UTC hour.
    Lookup {
        /// JSON file with the rows; read from stdin when absent.
        #[arg(long)]
        input: Option<String>,
        #[arg(long, default_value_t = 128)]
        threads: usize,
        /// The host passes these to every sidecar; this one needs neither.
        #[arg(long, hide = true)]
        model_dir: Option<String>,
        #[arg(long, hide = true)]
        data_dir: Option<String>,
        /// Anything else the host adds is ignored.
        #[arg(trailing_var_arg = true, allow_hyphen_values = true, hide = true)]
        rest: Vec<String>,
    },
    /// Print the dimensions of one remote file, e.g. `chunk_950.om`.
    Inspect {
        #[arg(long)]
        file: String,
    },
    /// Read N random Australian location-hours and report throughput.
    Bench {
        #[arg(long, default_value_t = 2000)]
        n: usize,
        #[arg(long, default_value_t = 32)]
        threads: usize,
        #[arg(long, default_value_t = 2012)]
        from_year: i32,
        #[arg(long, default_value_t = 2023)]
        to_year: i32,
    },
}

/// Tiny deterministic generator, so a benchmark run is repeatable without a rand dependency.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (self.next() as f64 / (1u64 << 31) as f64) * (hi - lo)
    }
}

fn hours_in_year(y: i32) -> u64 {
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    if leap { 8784 } else { 8760 }
}

fn main() {
    // Report how the host launched us (stderr reaches the host's sidecar log).
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(e) => {
            eprintln!("bad arguments {:?}: {e}", std::env::args().collect::<Vec<_>>());
            e.exit();
        }
    };
    let Cli { command } = cli;
    match command {
        Command::Lookup { input, threads, .. } => lookup::run(input.as_deref(), threads),
        Command::Inspect { file } => lookup::inspect(&file),
        Command::Bench { n, threads, from_year, to_year } => bench(n, threads, from_year, to_year),
    }
}

fn bench(n: usize, threads: usize, from_year: i32, to_year: i32) {
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads).build().unwrap();
    let stats = Arc::new(http::Stats::default());
    let agent = http::agent(threads);

    // Open one reader per year; each costs a few small requests.
    let t0 = Instant::now();
    let mut readers = Vec::new();
    for y in from_year..=to_year {
        let url = format!("{BASE}/year_{y}.om");
        let backend = http::HttpBackend::open(agent.clone(), url, stats.clone()).expect("open");
        let reader = OmFileReader::new(Arc::new(backend)).expect("om reader");
        let dims = reader.expect_array().expect("array").get_dimensions().to_vec();
        if y == from_year {
            println!("year file dims {dims:?}");
        }
        readers.push((y, reader));
    }
    println!(
        "opened {} files in {:.2}s ({} requests)",
        readers.len(),
        t0.elapsed().as_secs_f64(),
        stats.requests.load(Ordering::Relaxed)
    );

    // Random Australian location-hours.
    let mut rng = Lcg(42);
    let points: Vec<(usize, f64, f64, u64)> = (0..n)
        .map(|_| {
            let yi = (rng.next() as usize) % readers.len();
            let y = readers[yi].0;
            (yi, rng.range(-38.0, -12.0), rng.range(114.0, 153.0), rng.next() % hours_in_year(y))
        })
        .collect();

    stats.reset();
    let t1 = Instant::now();
    let sum: f64 = pool.install(|| {
        points
            .par_iter()
            .map(|&(yi, lat, lng, hour)| {
                let i = ((lat + 90.0) / 0.25).round() as u64;
                let j = ((((lng + 180.0) % 360.0) / 0.25).round() as u64) % 1440;
                let arr = readers[yi].1.expect_array().unwrap();
                let v = arr.read::<f32>(&[i..i + 1, j..j + 1, hour..hour + 1]).expect("read");
                *v.iter().next().unwrap() as f64
            })
            .sum()
    });
    let secs = t1.elapsed().as_secs_f64();
    println!(
        "{n} reads in {secs:.1}s = {:.0}/s | {} requests, {:.1} MB | mean cloud cover {:.1}",
        n as f64 / secs,
        stats.requests.load(Ordering::Relaxed),
        stats.bytes.load(Ordering::Relaxed) as f64 / 1e6,
        sum / n as f64
    );
    println!("projected for 250k reads: {:.0} min", 250_000.0 / (n as f64 / secs) / 60.0);
}
