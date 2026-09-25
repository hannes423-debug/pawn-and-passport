"""Can a body of the scene's own size reach every node? (mirrors freeWalk.js erosion)"""
import os, numpy as np
from PIL import Image
from scipy import ndimage
ACTOR = {'ist-int': 0.07, 'lon-ext': 0.08, 'lon-int': 0.07, 'lon-venue': 0.117,
         'che-ext': 0.09, 'che-int': 0.07, 'che-venue': 0.13,
         'ist-up': 0.07, 'ist-venue': 0.17, 'ist-ext': 0.08,
         'vie-int': 0.07, 'vie-up': 0.07, 'vie-ext': 0.09, 'vie-venue': 0.27,
         'wen-ext': 0.08, 'wen-int': 0.07, 'wen-up': 0.07, 'wen-venue': 0.166,
         'mad-ext': 0.088, 'mad-int': 0.06,
         'nyc-ext': 0.095, 'nyc-int': 0.07, 'nyc-up': 0.07, 'nyc-venue': 0.113}
NODES = {
 'ist-int': dict(entrance=(50,91), lobby=(50,78), mid=(50,38), stairs=(50,12), director=(27,34), practice=(17.5,63.5), hall=(80.5,50)),
 'lon-ext': dict(gate=(50,90), path=(50,66), porch=(50,42), door=(50,36)),
 'lon-int': dict(entrance=(50,92), lobby=(50,70), stairs=(50,50), hall=(50,30), dirDoor=(34,70), director=(28,62), studyDoor=(66,70), study=(78,76.5)),
 'lon-venue': dict(arrive=(50,86), aisle=(50,74), west=(21,74), host=(21,57), exit=(50,93)),
 'che-ext': dict(gate=(50,89), path=(50,70), porch=(50,52), door=(50,44)),
 'che-int': dict(entrance=(50,92), lobby=(50,74), stairs=(50,50), hall=(50,28), dirDoor=(31,66.5), director=(26,73), studyDoor=(69,66.5), study=(83.2,67)),
 'che-venue': dict(arrive=(77,87), walk=(77,62), host=(62,55), exit=(60,93)),
 'ist-up': dict(stairs=(50,37), hub=(50,48), lounge=(21,48.5), trophies=(82.5,50)),
 'ist-venue': dict(arrive=(62,61), steps=(50,63), west=(30,61), host=(38,58)),
 'ist-ext': dict(gate=(50,89), path=(50,66), porch=(50,48), door=(50,42)),
 'vie-int': dict(entrance=(50,91), lobby=(50,78), mid=(50,33), stairs=(50,12), dirDoor=(34,35), director=(27.5,34), pracDoor=(34,60), practice=(29.2,60), hallDoor=(65,36), hall=(81.3,47)),
 'vie-up': dict(stairs=(50,37), hub=(50,33), lounge=(21,48), trophies=(81,57)),
 'vie-ext': dict(gate=(50,92), path=(50,65), porch=(50,45), door=(50,39)),
 'vie-venue': dict(arrive=(50,87), floor=(50,72), host=(47,62), exit=(50,95)),
 'wen-ext': dict(gate=(50,91), path=(50,66), porch=(50,52), door=(50,46)),
 'wen-int': dict(entrance=(50,91), lobby=(50,78), mid=(50,50), stairs=(50,8), dirDoor=(33,30.5), director=(26,31), pracDoor=(33,62.5), practice=(17,66), hallDoor=(67,50.5), hall=(82.5,56)),
 'wen-up': dict(stairs=(50,40), hub=(50,52), lounge=(20,47.5), trophies=(79,60)),
 'wen-venue': dict(arrive=(80,42), quay=(70,63), host=(52,64), exit=(86,30)),
 'mad-ext': dict(gate=(50,95.5), path=(50,72), left=(38,52), porch=(50,40), door=(50,34)),
 'mad-int': dict(entrance=(50,92), lobby=(50,68), leftStair=(40,50), stage=(50,26), lounge=(22,56.5)),
 'nyc-ext': dict(gate=(50,89), left=(39.5,62), right=(60.5,62), porch=(50,48), door=(50,44.5)),
 'nyc-int': dict(entrance=(50,91), lobby=(50,78), mid=(50,40), stairs=(50,14), dirDoor=(34,38.5), director=(27,32), pracDoor=(34,60), practice=(18.2,66), hallDoor=(64,40), hall=(80.5,46)),
 'nyc-up': dict(stairs=(50,40), hub=(50,32), lounge=(22,39.5), trophies=(80,59.5)),
 'nyc-venue': dict(arrive=(50,92), plaza=(27,86), stairFoot=(12,69), stairTop=(9,45), terrace=(15,37), host=(21,37), exit=(50,96)),
}
import sys
from build_walkmask import SCENES
SEED = {s: SCENES[s]['seed'] for s in SCENES}
for s, act in ACTOR.items():
    if len(sys.argv) > 1 and s not in sys.argv[1:]: continue
    m = np.asarray(Image.open(os.path.join(os.environ.get('PAP_OUT', '/mnt/user-data/outputs'), f'{s}-walkmask.png'))) > 0
    H, W = m.shape; h = act * 100
    hw = round(max(1.0, h * 0.11) / 100 * H); hd = round(max(0.6, h * 0.04) / 100 * H)
    er = ndimage.binary_erosion(m, structure=np.ones((2 * hd + 1, 2 * hw + 1)))
    lab, n = ndimage.label(er)
    main = lab == (np.argmax(ndimage.sum(er, lab, range(1, n + 1))) + 1)   # the biggest standable region
    reach = main.sum() / er.sum()
    dist, (iy, ix) = ndimage.distance_transform_edt(~main, return_indices=True)
    out = []
    for k, (x, y) in NODES[s].items():
        px, py = min(W - 1, int(x / 100 * W)), min(H - 1, int(y / 100 * H))
        d = dist[py, px]
        out.append(f'{k} ok' if d == 0 else f'{k} {d:.0f}px off')
    print(f'{s:9s} feet {2*hw}x{2*hd}px  body-reachable {reach:.0%} of standable | ' + ', '.join(out))
