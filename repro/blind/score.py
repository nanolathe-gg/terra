import json, sys
key = json.load(open(sys.argv[1]))
for path in sys.argv[2:]:
    rev = json.load(open(path))['images']
    gen = [rev[n]['p_generated'] for n in key if key[n]['kind'] == 'generated']
    ret = [rev[n]['p_generated'] for n in key if key[n]['kind'] == 'retail']
    # Rank-based: chance an arbitrary generated crop is rated above an arbitrary retail crop.
    auc = sum((g > r) + .5 * (g == r) for g in gen for r in ret) / (len(gen) * len(ret))
    print(f"{path.split('/')[-1]}: generated caught {sum(p >= 60 for p in gen)}/{len(gen)}, retail called generated {sum(p >= 60 for p in ret)}/{len(ret)}, "
          f"mean P gen {sum(gen)/len(gen):.0f} vs retail {sum(ret)/len(ret):.0f}, AUC {auc:.2f} (0.5 = chance)")
    for n in sorted(key):
        if rev[n]['p_generated'] >= 60 or (key[n]['kind'] == 'generated' and rev[n]['p_generated'] <= 30):
            print(f"   {n} {key[n]['kind']:9s} p={rev[n]['p_generated']}  {key[n]['source']}")
