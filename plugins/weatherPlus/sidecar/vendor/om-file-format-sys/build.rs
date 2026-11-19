// Vendored from open-meteo/om-file-format (rust/om-file-format-sys, GPL-2.0-only). Compiles the C
// library. Unlike upstream, the Rust bindings are not generated at build time: src/bindings.rs is
// committed, so no libclang is needed. To rewrite it after updating c/:
//
//   cargo build --features regenerate-bindings      (in this folder; needs libclang)
//
// The bindings only cover the library's own headers (c/include), which use fixed-width integer
// types, so one file serves every 64-bit target.

use std::env;
use std::process::Command;

struct BuildConfig {
    arch: String,
    sysroot: Option<String>,
    is_windows: bool,
}

fn get_build_config() -> BuildConfig {
    BuildConfig {
        arch: env::var("CARGO_CFG_TARGET_ARCH").unwrap(),
        sysroot: env::var("SYSROOT").ok(),
        is_windows: env::var("TARGET").unwrap().contains("windows"),
    }
}

fn setup_compiler(build: &mut cc::Build) -> cc::Tool {
    // Check if CC is set in environment
    if let Ok(cc) = env::var("CC") {
        build.compiler(cc);
    } else {
        // Try using clang if available
        let clang_available = Command::new("clang")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false);

        if clang_available {
            build.compiler("clang");
        }
        // Otherwise cc::Build will use system default
    }

    build.get_compiler()
}

fn configure_build_flags(build: &mut cc::Build, config: &BuildConfig, compiler: &cc::Tool) {
    // If CFLAGS is set in the environment, the build system (e.g. Conda, Nix)
    // owns the flags. The cc crate will automatically pick up CFLAGS, so we
    // must not add any conflicting -O or -march flags on top of them.
    let cflags_from_env = env::var("CFLAGS").is_ok();

    if !cflags_from_env {
        // Basic compiler flags — only applied when no environment CFLAGS exist
        build.flag("-O3");

        // --- Architecture-specific flags ---
        match config.arch.as_str() {
            "aarch64" => {
                // ARM64
                build.flag("-march=armv8-a");
            }
            "x86_64" => {
                // x86_64 Architecture
                if config.is_windows && compiler.is_like_msvc() {
                    // No special flags needed for MSVC atm
                } else {
                    // x86-64-v3 has AVX2 (2013 Haswell Architecture) and should be a safe and performant baseline
                    build.flag("-march=x86-64-v3");
                }
            }
            _ => {
                // Handle other architectures if necessary
            }
        }
    }
}

#[cfg(feature = "regenerate-bindings")]
fn generate_bindings(submodule: &str, sysroot: &Option<String>) {
    use bindgen::EnumVariation;
    let bindings = bindgen::Builder::default()
        // Set sysroot for bindgen if specified (for cross compilation)
        .clang_arg(
            sysroot
                .as_ref()
                .map_or("".to_string(), |s| format!("--sysroot={}", s)),
        )
        .clang_arg(format!("-I{}/include", submodule))
        .header(format!("{}/include/om_file_format.h", submodule))
        // Only the library's own items, not the platform's C headers they include.
        .allowlist_file(r".*c/include/.*\.h")
        // Rust enums have the downside of potentially causing UB if the C code returns a value
        // that is not defined in the enum; the C code here only returns valid values.
        // https://mdaverde.com/posts/rust-bindgen-enum/
        .default_enum_style(EnumVariation::Rust {
            non_exhaustive: false,
        })
        .generate()
        .expect("Unable to generate bindings");

    let out = std::path::PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("src/bindings.rs");
    bindings.write_to_file(out).expect("Couldn't write bindings!");
}

fn main() {
    const LIB_NAME: &str = "omfileformatc";
    let submodule_path = "c";

    // Check if the C sources exist
    if !std::path::Path::new(submodule_path).exists() {
        panic!("C sources not found at path: {}", submodule_path);
    }

    // Re-run build script if these files change
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed={}", submodule_path);

    let config = get_build_config();
    let mut build = cc::Build::new();
    let compiler = setup_compiler(&mut build);

    println!("cargo:compiler={:?}", compiler.path());

    // Include directories
    build.include(format!("{}/include", submodule_path));
    // Add all .c files from the src directory
    let src_path = format!("{}/src", submodule_path);
    for entry in std::fs::read_dir(&src_path).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) == Some("c") {
            build.file(path);
        }
    }

    configure_build_flags(&mut build, &config, &compiler);

    // Set sysroot if specified
    if let Some(sysroot_path) = &config.sysroot {
        build.flag(&format!("--sysroot={}", sysroot_path));
    }

    // Compile the library
    build.warnings(false);
    build.compile(LIB_NAME);

    #[cfg(feature = "regenerate-bindings")]
    generate_bindings(submodule_path, &config.sysroot);

    // Link the static library
    println!("cargo:rustc-link-lib=static={}", LIB_NAME);
}
