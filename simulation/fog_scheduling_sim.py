"""
fog_scheduling_sim.py
=====================
Discrete-event simulation of a healthcare IoT -> Fog -> Cloud system (Q2).

Compares the proposed LAPS-LB scheduler (Latency-Aware Priority Scheduling with
Load Balancing) against conventional techniques:
    FCFS (gateway-local), Round Robin, Min-Completion-Time (greedy Min-Min style),
    Cloud-only.

Model
-----
* 4 heterogeneous single-core fog nodes + a 64-VM cloud.
* 4 healthcare task classes (Critical / High / Normal / Heavy) with deadlines.
* Poisson arrivals (steady) or 2x surge bursts (bursty); WAN delay jitter.
* Metrics: mean / per-class / p95 latency, deadline-miss rate, fog CPU
  utilisation, energy per task, share of tasks executed in the cloud.

Usage
-----
    pip install numpy matplotlib
    python fog_scheduling_sim.py                 # full experiment (~4-5 min), writes results.json
    python fog_scheduling_sim.py --quick         # 1 seed, 60 s runs (~20 s) for a fast check
    python fog_scheduling_sim.py --plots         # also draw the result charts (PNG)
    python fog_scheduling_sim.py --out res.json --seeds 10

All numeric parameters below are modelling assumptions (see report, Table 5).
"""
import argparse
import heapq
import json
import random

import numpy as np

# ---------------------------------------------------------------- parameters
FOG_MIPS   = [6000, 8000, 7000, 5000]        # 4 heterogeneous fog nodes (single core each)
FOG_PBUSY  = [12.0, 15.0, 13.5, 10.0]        # W when busy
FOG_PIDLE  = [5.0, 6.0, 5.5, 4.0]            # W when idle
CLOUD_VMS, CLOUD_MIPS, CLOUD_PVM = 64, 10000, 35.0   # W per busy VM (incl. PUE share)

LAN_PROP, LAN_BW = 0.004, 50e6               # s, bit/s  (device -> fog, via WLAN/BLE gateway)
WAN_PROP, WAN_BW = 0.080, 25e6               # s, bit/s  (fog -> cloud, one way)
TX_J_PER_MB_LAN, TX_J_PER_MB_WAN = 0.10, 0.60    # network energy

# task classes: name, share, MI range, data KB, deadline s, priority (3 = highest)
CLASSES = [
    ("Critical", 0.15, (30, 80),     40,   0.100, 3),   # ECG arrhythmia / fall alert
    ("High",     0.25, (80, 200),    80,   0.300, 2),   # SpO2/BP vital-sign fusion
    ("Normal",   0.40, (150, 400),   150,  1.000, 1),   # periodic pre-processing/logging
    ("Heavy",    0.20, (3000, 9000), 1000, 6.000, 0),   # ML analytics, imaging, trend models
]
N_FOG = len(FOG_MIPS)
CLOUD = N_FOG                                   # node index for cloud

# LAPS-LB weights / thresholds
W_LAT, W_UTIL, W_EN = 0.6, 0.25, 0.15
UTIL_THRESHOLD = 0.80
UTIL_WINDOW = 2.0                               # s, sliding window for CPU utilisation
B_MAX = 0.060                                   # s, max tolerated blocking of critical tasks


class Task:
    __slots__ = ("id", "cls", "mi", "kb", "deadline", "prio", "t_gen", "gateway",
                 "node", "t_arrive_node", "t_start", "t_end", "energy")
    def __init__(self, i, c, mi, kb, dl, pr, t, gw):
        self.id, self.cls, self.mi, self.kb = i, c, mi, kb
        self.deadline, self.prio, self.t_gen, self.gateway = dl, pr, t, gw
        self.node = None; self.t_arrive_node = self.t_start = self.t_end = None
        self.energy = 0.0


def transfer_time(task, node, rng=None):
    bits = task.kb * 8e3
    t = LAN_PROP + bits / LAN_BW                       # always reaches a fog gateway first
    if node == CLOUD:
        prop = WAN_PROP if rng is None else rng.uniform(0.5 * WAN_PROP, 1.75 * WAN_PROP)
        t += prop + bits / WAN_BW
    elif node != task.gateway:
        t += 0.002 + bits / 100e6                      # fog-to-fog over metro LAN
    return t


def tx_energy(task, node):
    mb = task.kb / 1000.0
    e = TX_J_PER_MB_LAN * mb
    if node == CLOUD: e += TX_J_PER_MB_WAN * mb
    return e


class Node:
    def __init__(self, idx, mips, servers, pbusy, pidle, priority_queue):
        self.idx, self.mips, self.servers = idx, mips, servers
        self.pbusy, self.pidle = pbusy, pidle
        self.pq = priority_queue
        self.queue = []            # heap
        self.running = []          # list of (t_end, task)
        self.incoming = []         # tasks in transit to this node
        self.busy_time = 0.0
        self.busy_log = []         # (start, end) for utilisation window

    def key(self, task):
        if self.pq:   # priority class first, then earliest absolute deadline (EDF within class)
            return (-task.prio, task.t_gen + task.deadline, task.id)
        return (task.t_arrive_node, task.id)

    def push(self, task):
        heapq.heappush(self.queue, (self.key(task), task))

    def exec_time(self, task):
        return task.mi / self.mips

    # --- estimates used by schedulers (no future knowledge beyond current state)
    def backlog_work(self, now, prio=None):
        w = 0.0
        for t_end, _ in self.running:
            w += max(0.0, t_end - now) * self.mips
        for _, t in self.queue:
            if prio is None or not self.pq or t.prio >= prio: w += t.mi
        for t in self.incoming:
            if prio is None or not self.pq or t.prio >= prio: w += t.mi
        return w

    def est_completion(self, now, task, transfer):
        wait = self.backlog_work(now, task.prio if self.pq else None) / (self.mips * self.servers)
        if self.pq:   # non-preemptive blocking bound: a lower-priority job may start before we arrive
            low = [t.mi for _, t in self.queue if t.prio < task.prio] + \
                  [t.mi for t in self.incoming if t.prio < task.prio]
            if low: wait += max(low) / self.mips / self.servers
        return max(transfer, wait) + self.exec_time(task)

    def utilisation(self, now):
        lo = now - UTIL_WINDOW
        b = 0.0
        for s, e in self.busy_log[-200:]:
            if e > lo: b += e - max(s, lo)
        for t_end, t in self.running:
            b += now - max(t.t_start, lo)
        return min(1.0, b / (UTIL_WINDOW * self.servers))


# ---------------------------------------------------------------- schedulers
class Scheduler:
    name = "base"; priority_queue = False
    def __init__(self, nodes): self.nodes = nodes; self.rr = 0
    def select(self, now, task): raise NotImplementedError

class FCFS(Scheduler):
    name = "FCFS (gateway-local)"
    def select(self, now, task): return task.gateway

class RoundRobin(Scheduler):
    name = "Round Robin"
    def select(self, now, task):
        n = self.rr % N_FOG; self.rr += 1; return n

class MCT(Scheduler):
    name = "Min-Completion-Time"
    def select(self, now, task):
        best, bv = None, 1e18
        for n in self.nodes:
            v = n.est_completion(now, task, transfer_time(task, n.idx))
            if v < bv: best, bv = n.idx, v
        return best

class CloudOnly(Scheduler):
    name = "Cloud-only"
    def select(self, now, task): return CLOUD

class LAPSLB(Scheduler):
    """Latency-Aware Priority Scheduling with Load Balancing (proposed)."""
    name = "LAPS-LB (proposed)"; priority_queue = True
    def select(self, now, task):
        cands = []
        fog_util = [self.nodes[i].utilisation(now) for i in range(N_FOG)]
        for n in self.nodes:
            tr = transfer_time(task, n.idx)
            ect = n.est_completion(now, task, tr)
            util = fog_util[n.idx] if n.idx < N_FOG else 0.0
            exec_e = n.exec_time(task) * (n.pbusy - (n.pidle if n.idx < N_FOG else 0))
            energy = exec_e + tx_energy(task, n.idx)
            cands.append((n.idx, ect, util, energy))

        # Rule 1: compute-intensive, delay-tolerant tasks whose fog execution would block
        # critical traffic for longer than B_MAX (non-preemptive queues) are sent to the cloud.
        if task.prio < 3 and min(task.mi / FOG_MIPS[i] for i in range(N_FOG)) > B_MAX:
            if cands[CLOUD][1] <= task.deadline:
                return CLOUD

        # Rule 2: deadline feasibility filter + utilisation threshold (load balancing)
        feas = [c for c in cands if c[1] <= task.deadline]
        if task.prio < 3:   # critical tasks may use any node; others avoid hot nodes
            cool = [c for c in feas if c[0] == CLOUD or c[2] < UTIL_THRESHOLD]
            feas = cool or feas
        if not feas:
            return min(cands, key=lambda c: c[1])[0]   # best effort: least completion time
        # Rule 3: weighted multi-objective cost among feasible nodes
        lmax = max(c[1] for c in feas) or 1.0
        emax = max(c[3] for c in feas) or 1.0
        def cost(c):
            return W_LAT * c[1] / lmax + W_UTIL * c[2] + W_EN * c[3] / emax
        return min(feas, key=cost)[0]


# ---------------------------------------------------------------- simulation
def arrivals(rate, horizon, rng, bursty=False):
    t = 0.0
    while True:
        r = rate
        if bursty:   # emergency surges: 2x rate for 10 s, 2/3x for 30 s (mean = rate)
            phase = t % 40.0
            r = rate * (2.0 if phase < 10 else 2.0 / 3.0)
        t += rng.expovariate(r)
        if t > horizon: return
        yield t


def run(sched_cls, rate, horizon=200.0, seed=1, bursty=False, n_devices=200):
    rng = random.Random(seed)
    pq = sched_cls.priority_queue
    nodes = [Node(i, FOG_MIPS[i], 1, FOG_PBUSY[i], FOG_PIDLE[i], pq) for i in range(N_FOG)]
    nodes.append(Node(CLOUD, CLOUD_MIPS, CLOUD_VMS, CLOUD_PVM, 0.0, pq))
    sched = sched_cls(nodes)
    ev = []; seq = 0
    tasks = []
    for t in arrivals(rate, horizon, rng, bursty):
        u = rng.random(); acc = 0
        for ci, c in enumerate(CLASSES):
            acc += c[1]
            if u <= acc: break
        name, share, (lo, hi), kb, dl, pr = CLASSES[ci]
        dev = rng.randrange(n_devices)
        task = Task(len(tasks), ci, rng.uniform(lo, hi), kb * rng.uniform(0.8, 1.2), dl, pr, t, dev % N_FOG)
        tasks.append(task)
        heapq.heappush(ev, (t, 0, seq, task)); seq += 1

    def try_start(node, now):
        nonlocal seq
        while len(node.running) < node.servers and node.queue:
            _, task = heapq.heappop(node.queue)
            task.t_start = now
            te = now + node.exec_time(task)
            node.running.append((te, task))
            heapq.heappush(ev, (te, 2, seq, task)); seq += 1

    while ev:
        now, kind, _, task = heapq.heappop(ev)
        if kind == 0:   # generated -> schedule
            n = sched.select(now, task)
            task.node = n
            nodes[n].incoming.append(task)
            heapq.heappush(ev, (now + transfer_time(task, n, rng), 1, seq, task)); seq += 1
        elif kind == 1: # arrives at node
            node = nodes[task.node]
            node.incoming.remove(task)
            task.t_arrive_node = now
            node.push(task); try_start(node, now)
        else:           # finished
            node = nodes[task.node]
            node.running = [(te, t) for te, t in node.running if t is not task]
            task.t_end = now
            ex = node.exec_time(task)
            node.busy_time += ex
            node.busy_log.append((task.t_start, now))
            task.energy = ex * (node.pbusy - (node.pidle if node.idx < N_FOG else 0)) + tx_energy(task, node.idx)
            try_start(node, now)

    # ------------------------------------------------------------ metrics
    done = [t for t in tasks if t.t_end is not None]
    end_time = max(t.t_end for t in done)
    def latency(t):   # end-to-end: generation -> result back at device (small ack)
        back = LAN_PROP + (WAN_PROP if t.node == CLOUD else 0)
        return t.t_end - t.t_gen + back
    lat = np.array([latency(t) for t in done])
    miss = np.array([latency(t) > t.deadline for t in done])
    res = {"scheduler": sched.name, "rate": rate, "bursty": bursty, "seed": seed, "n": len(done)}
    res["avg_latency_ms"] = float(lat.mean() * 1000)
    res["miss_rate"] = float(miss.mean() * 100)
    for ci, c in enumerate(CLASSES):
        sel = np.array([t.cls == ci for t in done])
        res[f"lat_{c[0]}"] = float(lat[sel].mean() * 1000)
        res[f"p95_{c[0]}"] = float(np.percentile(lat[sel], 95) * 1000)
        res[f"miss_{c[0]}"] = float(miss[sel].mean() * 100)
    def busy_in(node):
        return sum(max(0.0, min(e, horizon) - s) for s, e in node.busy_log if s < horizon)
    utils = [busy_in(nodes[i]) / horizon for i in range(N_FOG)]
    res["fog_util_mean"] = float(np.mean(utils) * 100)
    res["fog_util_std"] = float(np.std(utils) * 100)   # load-imbalance degree
    idle_e = sum(FOG_PIDLE) * end_time
    res["energy_per_task_J"] = float((sum(t.energy for t in done) + idle_e) / len(done))
    res["cloud_share"] = float(np.mean([t.node == CLOUD for t in done]) * 100)
    return res


SCHEDULERS = [FCFS, RoundRobin, MCT, CloudOnly, LAPSLB]

def aggregate(runs):
    agg = {k: (float(np.mean([x[k] for x in runs])) if isinstance(runs[0][k], float) else runs[0][k])
           for k in runs[0]}
    agg["miss_rate_sd"] = float(np.std([x["miss_rate"] for x in runs]))
    return agg


def experiment(rates, seeds, horizon, bursty_rate=120):
    out = []
    for r in rates:
        for S in SCHEDULERS:
            agg = aggregate([run(S, r, horizon=horizon, seed=s) for s in seeds])
            out.append(agg)
            print(f"{S.name:24s} rate={r:4d}  lat={agg['avg_latency_ms']:10.1f} ms  miss={agg['miss_rate']:6.2f}%  "
                  f"critMiss={agg['miss_Critical']:6.2f}%  util={agg['fog_util_mean']:5.1f}%  "
                  f"E={agg['energy_per_task_J']:.2f} J  cloud={agg['cloud_share']:5.1f}%", flush=True)
    for S in SCHEDULERS:
        agg = aggregate([run(S, bursty_rate, horizon=horizon, seed=s, bursty=True) for s in seeds])
        out.append(agg)
        print(f"BURSTY {S.name:24s} lat={agg['avg_latency_ms']:10.1f} ms  miss={agg['miss_rate']:6.2f}%  "
              f"critMiss={agg['miss_Critical']:6.2f}%", flush=True)
    return out


# ---------------------------------------------------------------- charts
def plot(results, prefix="fig_"):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    order = ["LAPS-LB (proposed)", "Min-Completion-Time", "Cloud-only", "Round Robin", "FCFS (gateway-local)"]
    col = dict(zip(order, ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"]))
    mk = dict(zip(order, ["o", "s", "^", "D", "v"]))
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
    steady = [r for r in results if not r["bursty"]]
    rates = sorted({r["rate"] for r in steady})

    def val(s, x, k):
        return next(r[k] for r in steady if r["scheduler"] == s and r["rate"] == x)

    def line(key, ylabel, title, fname, log=False, schedulers=order, hline=None):
        fig, ax = plt.subplots(figsize=(6.4, 3.6), dpi=200)
        for s in schedulers:
            ax.plot(rates, [val(s, x, key) for x in rates], color=col[s], marker=mk[s],
                    lw=2, ms=6, mec="white", mew=1, label=s)
        if hline is not None:
            ax.axhline(hline, color="#52514e", ls="--", lw=1)
        ax.set_xlabel("Task arrival rate (tasks/s)"); ax.set_ylabel(ylabel)
        ax.set_title(title, loc="left", fontweight="bold")
        if log: ax.set_yscale("log")
        ax.grid(axis="y", color="#e4e3df"); ax.set_axisbelow(True)
        ax.legend(frameon=False, fontsize=8, ncol=2)
        fig.tight_layout(); fig.savefig(prefix + fname); plt.close(fig)
        print("saved", prefix + fname)

    line("miss_rate", "Deadline-miss rate (%)", "Overall deadline-miss rate", "miss.png")
    line("miss_Critical", "Critical-task miss rate (%)", "Critical task deadline misses", "crit.png")
    line("avg_latency_ms", "Mean response time (ms, log)", "Mean end-to-end response time", "lat.png", log=True)
    line("energy_per_task_J", "Energy per task (J)", "Energy per completed task", "energy.png")
    line("fog_util_mean", "Mean fog CPU utilisation (%)", "Fog-layer CPU utilisation", "util.png",
         schedulers=[s for s in order if s != "Cloud-only"], hline=UTIL_THRESHOLD * 100)

    b = {r["scheduler"]: r for r in results if r["bursty"]}
    if b:
        x = np.arange(len(order)); w = 0.38
        fig, ax = plt.subplots(figsize=(6.4, 3.4), dpi=200)
        ax.bar(x - w / 2, [b[s]["miss_rate"] for s in order], w, color="#2a78d6", label="All tasks")
        ax.bar(x + w / 2, [b[s]["miss_Critical"] for s in order], w, color="#eb6834", hatch="//",
               edgecolor="white", label="Critical tasks")
        ax.set_xticks(x); ax.set_xticklabels([s.replace(" (", "\n(") for s in order], fontsize=8)
        ax.set_ylabel("Deadline-miss rate (%)"); ax.set_ylim(0, 125)
        ax.set_title("Bursty emergency workload", loc="left", fontweight="bold")
        ax.legend(frameon=False, fontsize=8, loc="upper left", ncol=2)
        fig.tight_layout(); fig.savefig(prefix + "bursty.png"); plt.close(fig)
        print("saved", prefix + "bursty.png")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="LAPS-LB fog scheduling simulation")
    ap.add_argument("--out", default="results.json", help="output JSON file")
    ap.add_argument("--seeds", type=int, default=5, help="number of random seeds per point")
    ap.add_argument("--horizon", type=float, default=200.0, help="simulated seconds per run")
    ap.add_argument("--rates", type=int, nargs="+", default=[20, 50, 100, 200, 300, 400, 500])
    ap.add_argument("--quick", action="store_true", help="fast check: 1 seed, 60 s runs")
    ap.add_argument("--plots", action="store_true", help="save PNG charts after the run")
    a = ap.parse_args()
    if a.quick:
        a.seeds, a.horizon = 1, 60.0
    results = experiment(a.rates, list(range(1, a.seeds + 1)), a.horizon)
    with open(a.out, "w") as f:
        json.dump(results, f, indent=1)
    print("results written to", a.out)
    if a.plots:
        plot(results)
