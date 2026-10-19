import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

fig, ax = plt.subplots(figsize=(11, 8.2), dpi=200)
ax.set_xlim(0, 110); ax.set_ylim(0, 82); ax.axis("off")
INK, INK2 = "#0b0b0b", "#52514e"

def band(y, h, fill, edge, title, tcol, right=False):
    ax.add_patch(FancyBboxPatch((1, y), 108, h, boxstyle="round,pad=0,rounding_size=1.5",
                                fc=fill, ec=edge, lw=1.4))
    ax.text(107.5 if right else 2.5, y + h - 2.2, title, fontsize=10.5, fontweight="bold", color=tcol,
            va="center", ha="right" if right else "left")

def box(x, y, w, h, text, fc="white", ec=INK2, fs=8.3, bold=False):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.9", fc=fc, ec=ec, lw=1))
    ax.text(x + w/2, y + h/2, text, ha="center", va="center", fontsize=fs, color=INK,
            fontweight="bold" if bold else "normal", linespacing=1.3)
    return (x, y, w, h)

def arrow(p, q, col=INK2, ls="-", lw=1.2, label=None, lx=0, ly=0, rad=0.0, lc=None):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle="-|>", mutation_scale=10, color=col, lw=lw,
                                 linestyle=ls, connectionstyle=f"arc3,rad={rad}"))
    if label:
        ax.text((p[0]+q[0])/2 + lx, (p[1]+q[1])/2 + ly, label, fontsize=7.3, color=lc or col,
                ha="center", va="center", bbox=dict(fc="white", ec="none", pad=0.6, alpha=0.9))

# ---------------- Cloud layer
band(64, 16, "#e8f2fd", "#2a78d6", "CLOUD LAYER  —  elastic capacity, WAN latency 40–140 ms", "#184f95")
c1 = box(8, 66.5, 30, 9, "Cloud VM pool\n64 VMs × 10,000 MIPS\n(heavy ML analytics, imaging)")
c2 = box(42, 66.5, 26, 9, "Cloud task queue\n(FCFS, auto-scaling)")
c3 = box(72, 66.5, 32, 9, "EHR storage, model training,\nhospital / clinician dashboards")
arrow((42, 71), (38, 71)); arrow((38, 73.5), (72, 73.5), rad=-0.12)

# ---------------- Fog layer
band(18.3, 42.7, "#fdeee6", "#eb6834", "FOG LAYER  —  hospital-edge / ward gateways, LAN latency 4–15 ms", "#a8401a")
ax.add_patch(FancyBboxPatch((3, 39), 104, 18, boxstyle="round,pad=0,rounding_size=1.2", fc="white", ec="#eb6834", lw=1, ls="--"))
ax.text(87, 54.6, "Fog Orchestrator — LAPS-LB controller", fontsize=9, fontweight="bold", color="#a8401a", ha="right")
m1 = box(5, 41, 18, 11, "① Task Classifier\npriority p, deadline D,\nlength MI, data size", fc="#fff7f2")
m2 = box(26, 41, 18, 11, "② Resource Monitor\nCPU util U_i, backlog,\nbandwidth, power", fc="#fff7f2")
m3 = box(47, 41, 18, 11, "③ Latency-aware\nScheduler\nECT_i + deadline filter", fc="#fff7f2")
m4 = box(68, 41, 18, 11, "④ Load Balancer\nthreshold θ = 0.8\nweighted cost J_i", fc="#fff7f2")
m5 = box(89, 41, 16, 11, "⑤ Offload Manager\nblocking bound\nB_max = 60 ms", fc="#fff7f2")
for a, b in [(m1, m3), (m3, m4), (m4, m5)]:
    pass
arrow((23, 46.5), (26, 46.5)); arrow((44, 46.5), (47, 46.5)); arrow((65, 46.5), (68, 46.5)); arrow((86, 46.5), (89, 46.5))
arrow((14, 52), (56, 52), rad=-0.18)   # classifier -> scheduler (over monitor)

# priority queue + fog nodes
qx = [31, 50.5, 70, 89.5]; caps = [6000, 8000, 7000, 5000]
for i, (x, cap) in enumerate(zip(qx, caps)):
    # queue strip
    lv = [("P3", "#e34948"), ("P2", "#eda100"), ("P1", "#1baf7a"), ("P0", "#2a78d6")]
    for j, (t, c) in enumerate(lv):
        ax.add_patch(FancyBboxPatch((x + j*4.3, 31.5), 4.0, 4, boxstyle="round,pad=0,rounding_size=0.4", fc=c, ec="white", lw=1, alpha=0.85))
        ax.text(x + j*4.3 + 2.0, 33.5, t, ha="center", va="center", fontsize=7, color="white", fontweight="bold")
    box(x, 22, 17, 7.5, f"Fog node {i+1}\n{cap} MIPS", fs=8)
    arrow((x + 8.5, 31.5), (x + 8.5, 29.5))
    arrow((77, 41), (x + 8.5, 35.5), lw=0.9, col="#a8401a")
ax.text(78, 19.9, "per-node multi-level priority queue (P3 Critical → P0 Heavy), EDF ordering inside each level",
        fontsize=7.6, color="#a8401a", ha="center", style="italic")
arrow((31, 27), (30, 41), ls=(0, (3, 2)), lw=0.9, col="#888780", rad=-0.35)
ax.text(23.8, 33.5, "telemetry\n(U_i, queue)", fontsize=7, color="#888780", ha="center")

# offload arrow to cloud
arrow((103, 52), (63, 66.5), col="#184f95", lw=1.6, rad=0.0,
      label="offload heavy / overflow tasks (25 Mbps WAN)", lx=8, ly=2)
ax.text(23, 63.2, "results & model updates flow back down the same path", fontsize=7, color="#184f95", ha="center", style="italic")

# ---------------- IoT layer
band(1, 16, "#e6f6f0", "#1baf7a", "IoT / DEVICE LAYER  —  wearables & bedside sensors (≈200 devices)", "#0f6b4b", right=True)
devs = ["ECG patch\n(arrhythmia)", "SpO₂ / pulse\noximeter", "BP cuff /\nthermometer", "Accelerometer\n(fall detect)", "Insulin / glucose\nmonitor"]
for k, d in enumerate(devs):
    box(30 + k*15.2, 3, 13.5, 8, d, fs=7.6)
gw = box(4, 3, 20, 8, "Smartphone / BLE\nedge gateway", fc="#f3fbf8", bold=True, fs=8)
for k in range(5):
    pass
ax.annotate("", xy=(24, 7), xytext=(30, 7), arrowprops=dict(arrowstyle="-|>", color=INK2, lw=1.2))
ax.text(27, 12.3, "BLE / Wi-Fi", fontsize=7, color=INK2, ha="center")
arrow((14, 11), (14, 41), col="#0f6b4b", lw=1.8)
ax.text(15, 26, "task stream\n(data + metadata,\n50 Mbps WLAN)", fontsize=7.3, color="#0f6b4b", ha="left")
arrow((42, 22), (40, 11), col="#e34948", ls=(0, (4, 2)), lw=1.1)
ax.text(43.5, 19.9, "alerts / actuation", fontsize=7.3, color="#e34948", ha="left")

fig.tight_layout(pad=0.3)
fig.savefig("../charts/fig_arch.png")
