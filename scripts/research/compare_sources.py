"""Compare a DEM against swissALTI3D 2 m tiles, per 1 km tile, at the other DEM's resolution.

usage: python3.12 compare_sources.py <swissalti3d_dir> <other.tif|vrt> <res_m>
The other DEM may be in any CRS; it is warped (bilinear) to LV95 at <res_m>.
"""
import glob
import sys

import numpy as np
from osgeo import gdal

gdal.UseExceptions()
sa_dir, other, res = sys.argv[1], sys.argv[2], float(sys.argv[3])
rows = []
for p in sorted(glob.glob(f"{sa_dir}/*.tif")):
    gt = gdal.Open(p).GetGeoTransform()
    b = (gt[0], gt[3] - 1000, gt[0] + 1000, gt[3])
    s = gdal.Warp("", p, format="MEM", outputBounds=b, xRes=res, yRes=res, resampleAlg="average").ReadAsArray().astype(float)
    o = gdal.Warp("", other, format="MEM", dstSRS="EPSG:2056", outputBounds=b, xRes=res, yRes=res, resampleAlg="bilinear").ReadAsArray().astype(float)
    m = (s > -9000) & (o > -9000) & (o < 1e30)
    d = (o - s)[m]
    rows.append((p.split("/")[-1], np.median(d), np.sqrt(np.mean(d**2)), np.abs(d).max()))
a = np.array([r[1:] for r in rows])
print(f"tiles {len(rows)}  median(other-sa) {np.median(a[:,0]):.3f} m  median rms {np.median(a[:,1]):.2f} m  "
      f"p90 rms {np.percentile(a[:,1],90):.2f} m  worst rms {a[:,1].max():.2f} m")
for r in sorted(rows, key=lambda z: -z[2])[:5]:
    print(f"  {r[0]}: median {r[1]:.2f} rms {r[2]:.2f} max {r[3]:.1f}")
