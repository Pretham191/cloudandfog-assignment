# LAPS-LB: Latency-Aware Task Scheduling and Load Balancing in Fog Computing

Source code for **Q2 – Latency-Aware Task Scheduling and Load Balancing in Fog Computing**
(healthcare IoT monitoring system).

Author: R Ananyaa Sri, B.Tech CSE IoT-B (Reg. No. 23011102069)

## Contents

```
LAPS-LB-fog-scheduling/
├── simulation/
│   └── fog_scheduling_sim.py   discrete-event simulator: LAPS-LB + 4 baseline schedulers, metrics, charts
├── diagrams/
│   ├── architecture.py          draws the 3-tier IoT-fog-cloud architecture (Figure 1)
│   └── flowchart.dot            Graphviz source of the LAPS-LB decision flow (Figure 2)
├── charts/                      all figures used in the report (PNG)
├── results/
│   └── results.json             raw results used in the report (7 rates x 5 schedulers x 5 seeds + bursty run)
├── report/
│   ├── build_report.js          generates the Word report from results/ and charts/
│   └── Fog_Scheduling_LAPS-LB_Report.docx
├── requirements.txt
└── README.md
```

## Requirements

* Python 3.9+ with `numpy` and `matplotlib` (`pip install -r requirements.txt`)
* Optional: Graphviz (`dot`) to redraw the flowchart; Node.js 18+ with the `docx` package
  (`npm install docx`) to rebuild the Word report.

## Running the simulation

```bash
cd simulation
python fog_scheduling_sim.py --quick            # fast check: 1 seed, 60 s per run (~20 s)
python fog_scheduling_sim.py --plots            # full experiment used in the report (~4-5 min)
python fog_scheduling_sim.py --rates 50 200 --seeds 10 --out my_results.json
```

Options: `--out` (JSON file), `--seeds` (runs per point), `--horizon` (simulated seconds per run),
`--rates` (arrival rates in tasks/s), `--quick`, `--plots` (writes `fig_*.png` charts).

The full run reproduces `results/results.json` exactly (fixed seeds 1-5).

## What is simulated

| Component | Setting |
|---|---|
| Fog layer | 4 single-core nodes: 6000 / 8000 / 7000 / 5000 MIPS |
| Cloud | 64 VMs x 10,000 MIPS |
| Network | device->fog 4 ms + 50 Mbps; fog->fog 2 ms + 100 Mbps; fog->cloud 40-140 ms + 25 Mbps |
| Task classes | Critical (100 ms deadline), High (300 ms), Normal (1 s), Heavy (6 s) |
| Workloads | steady 20-500 tasks/s; bursty mean 120 tasks/s with 2x surges |
| Schedulers | LAPS-LB (proposed), Min-Completion-Time, Cloud-only, Round Robin, FCFS (gateway-local) |
| Metrics | mean / per-class / p95 latency, deadline-miss rate, fog CPU utilisation, energy per task, cloud share |

### LAPS-LB in brief

For each arriving task the fog orchestrator:

1. estimates the completion time on every fog node and the cloud (transfer + priority-aware
   backlog + a non-preemptive **blocking bound** + execution);
2. sends long, delay-tolerant tasks (fog execution > `B_MAX` = 60 ms) to the cloud if the cloud
   meets their deadline;
3. keeps only nodes that meet the deadline and, for non-critical tasks, are below the
   utilisation threshold `θ` = 0.8;
4. picks the node with the lowest weighted cost `0.6·latency + 0.25·utilisation + 0.15·energy`;
5. queues the task at its priority level (Critical > High > Normal > Heavy, EDF within a level).

All parameters are constants at the top of `fog_scheduling_sim.py` and can be changed to run
sensitivity experiments.

## Regenerating figures and the report

```bash
cd diagrams && python architecture.py && dot -Tpng -Gdpi=200 flowchart.dot -o ../charts/fig_flow.png
cd ../simulation && python fog_scheduling_sim.py --plots     # writes fig_*.png in this folder
cd ../report && node build_report.js                          # rebuilds the .docx from results/ and charts/
```

Note: the simulation writes its chart PNGs into the current folder; copy them into `charts/`
if you want the rebuilt report to use them.
