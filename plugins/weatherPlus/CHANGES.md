# Changes

Newest first. Each released version needs a `## <version>` entry; its text becomes the
GitHub release notes.

## 0.3.0

- Finer cloud cover from 2017 on: capture times from 2017-01-01 now use ECMWF IFS (~9 km resolution)
  instead of ERA5 (~28 km resolution). Earlier times and rows without IFS data still use ERA5.
- Much less time per batch: the land masks are downloaded once and cached, instead of on every batch.
- Now available for Linux (x64) and macOS (Apple silicon) as well as Windows. Each system has its own
  zip, `weatherPlus-<version>-<system>.zip`.

## 0.2.23

- First entry in this changelog. Earlier history is in the git log.
