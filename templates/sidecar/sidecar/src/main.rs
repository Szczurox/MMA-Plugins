//! __TITLE__ sidecar. The host passes the rows as a JSON array on stdin, plus extra arguments
//! (such as --model-dir) that are ignored here. Prints one JSON object per row on stdout;
//! diagnostics go to stderr.

use serde::Deserialize;
use std::io::Read;

#[derive(Deserialize)]
struct Row {
    id: i64,
    lat: f64,
    lng: f64,
}

fn main() {
    let mut input = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut input) {
        eprintln!("could not read stdin: {e}");
        std::process::exit(1);
    }
    let rows: Vec<Row> = match serde_json::from_str(&input) {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("invalid input: {e}");
            std::process::exit(1);
        }
    };
    for row in rows {
        // TODO: compute the real value.
        let example = row.lat + row.lng;
        println!("{}", serde_json::json!({ "id": row.id, "example": example }));
    }
}
