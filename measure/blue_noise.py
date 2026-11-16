# The output stage's threshold (engine-output.wgsl RANKS): void-and-cluster blue noise (Ulichney 1993), 32 x 32, toroidal, from a fixed
# seed, so the same ranks every run. Writes the ranks (0..1023, row by row) as JSON: python3 measure/blue_noise.py out.json
import math, json, sys
N=32; SIG=1.5
K=[[math.exp(-(min(dx,N-dx)**2+min(dy,N-dy)**2)/(2*SIG*SIG)) for dx in range(N)] for dy in range(N)]
def add(E,x,y,s):
    for j in range(N):
        row=K[(j-y)%N]; Ej=E[j]
        for i in range(N): Ej[i]+=s*row[(i-x)%N]
def argext(E,mask,want,maximum):
    best=None;bv=None
    for j in range(N):
        for i in range(N):
            if mask[j][i]==want:
                v=E[j][i]
                if bv is None or (v>bv if maximum else v<bv): bv=v;best=(i,j)
    return best
# initial binary pattern: 10% points from a fixed LCG, then relax
seed=12345
def rnd():
    global seed; seed=(seed*1103515245+12345)&0x7fffffff; return seed
M=[[False]*N for _ in range(N)]
n0=N*N//10
while sum(map(sum,M))<n0:
    r=rnd(); M[(r>>8)%N][(r>>16)%N]=True
E=[[0.0]*N for _ in range(N)]
for j in range(N):
    for i in range(N):
        if M[j][i]: add(E,i,j,1)
while True:
    c=argext(E,M,True,True); M[c[1]][c[0]]=False; add(E,c[0],c[1],-1)
    v=argext(E,M,False,False)
    if v==c: M[c[1]][c[0]]=True; add(E,c[0],c[1],1); break
    M[v[1]][v[0]]=True; add(E,v[0],v[1],1)
rank=[[0]*N for _ in range(N)]
P=[r[:] for r in M]; EP=[r[:] for r in E]; ones=sum(map(sum,M))
for k in range(ones-1,-1,-1):
    c=argext(EP,P,True,True); P[c[1]][c[0]]=False; add(EP,c[0],c[1],-1); rank[c[1]][c[0]]=k
P=[r[:] for r in M]; EP=[r[:] for r in E]
for k in range(ones,N*N):
    v=argext(EP,P,False,False); P[v[1]][v[0]]=True; add(EP,v[0],v[1],1); rank[v[1]][v[0]]=k
json.dump(rank,open(sys.argv[1],'w'))
print('ranks', min(map(min,rank)), max(map(max,rank)), len(set(sum(rank,[]))))
