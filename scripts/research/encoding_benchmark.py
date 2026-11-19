from osgeo import gdal; gdal.UseExceptions()
import numpy as np, zlib, io, lzma, sys
from PIL import Image
a=gdal.Open(sys.argv[1]).ReadAsArray().astype(np.float64)
t=a[0:256,0:256]; assert (t>-9000).all()
print(sys.argv[1], 'tile range %.1f..%.1f'%(t.min(), t.max()), 'max slope deg %.0f'%np.degrees(np.arctan(np.hypot(*np.gradient(t,2.0)).max())))
def png(arr, mode):
    b=io.BytesIO(); Image.fromarray(arr, mode).save(b,'PNG',optimize=True); return len(b.getvalue())
def webpll(arr):
    b=io.BytesIO(); Image.fromarray(arr,'RGB').save(b,'WEBP',lossless=True,quality=100,method=6); return len(b.getvalue())
res=[]
v=t+32768; r=np.floor(v/256); g=np.floor(v%256); bb=np.floor((v-np.floor(v))*256)
rgb=np.stack([r,g,bb],-1).astype(np.uint8); dec=r*256+g+bb/256-32768
res.append(('terrarium png (1/256 m)', png(rgb,'RGB'), np.abs(dec-t).max()))
res.append(('terrarium webp-lossless', webpll(rgb), np.abs(dec-t).max()))
for step in (0.01, 0.02, 0.05, 0.1):
    q=np.round((t-t.min())/step)
    if q.max()>65535: res.append((f'u16 step {step}', 0, 'overflow')); continue
    q=q.astype(np.uint16); err=np.abs(q*step+t.min()-t).max(); raw=q.tobytes()
    qi=q.astype(np.int32); p=np.zeros_like(qi); p[1:,1:]=qi[1:,:-1]+qi[:-1,1:]-qi[:-1,:-1]; p[0,1:]=qi[0,:-1]; p[1:,0]=qi[:-1,0]
    r2=qi-p; zz=((r2<<1)^(r2>>31)).astype(np.uint32)
    bz=zz.astype(np.uint16).tobytes(); planes=np.frombuffer(bz,np.uint8).reshape(-1,2).T.copy().tobytes()
    res.append((f'u16 {step} m: gzip raw', len(zlib.compress(raw,9)), err))
    res.append((f'u16 {step} m: pred+zigzag+planes gzip', len(zlib.compress(planes,9)), err))
    res.append((f'u16 {step} m: pred+zigzag+planes xz', len(lzma.compress(planes,preset=9)), err))
    res.append((f'u16 {step} m: png16', png(q,'I;16'), err))
for n,s,e in res: print(f'  {n:42s} {s/1024:7.1f} KiB  maxerr {e if isinstance(e,str) else round(e,4)}')
print('  float32 raw', t.size*4/1024, 'KiB')
