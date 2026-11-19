# Research scripts (Step 1)

One-off analysis scripts behind the numbers in RESEARCH.md. They need GDAL's Python
bindings, NumPy and Pillow (on Ubuntu 24.04: `/usr/bin/python3.12`).

- `encoding_benchmark.py <tile.tif>` compares height-tile encodings (Terrarium PNG/WebP,
  16-bit quantised with gzip/xz/PNG16) on the first 256×256 block of a 2 m swissALTI3D tile.
- `compare_sources.py <dir-of-swissalti3d-2m-tiles> <other-dem.tif>` compares another DEM
  against swissALTI3D, aggregating swissALTI3D (2 m) to the other DEM's grid ("average").

Example inputs (2024 edition, 2 m, LV95/LN02):
https://data.geo.admin.ch/ch.swisstopo.swissalti3d/swissalti3d_2024_2615-1093/swissalti3d_2024_2615-1093_2_2056_5728.tif
