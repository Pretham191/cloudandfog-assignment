const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, ImageRun, PageBreak, Header, Footer, PageNumber,
  TableOfContents, PageOrientation, LevelFormat, VerticalAlign, SectionType, TabStopType
} = require("docx");

const R = JSON.parse(fs.readFileSync(path.join(__dirname, "../results/results.json")));
const FONT = "Calibri";
const ACC = "1F4E79";
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "A6A6A6" };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

// ---------- inline markup: **bold**, *italic*, [n] kept as-is
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const t = m[0];
    if (t.startsWith("**")) out.push(new TextRun({ text: t.slice(2, -2), bold: true, ...base }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}
const P = (text, o = {}) => new Paragraph({
  children: runs(text, o.run || {}), alignment: o.align || AlignmentType.JUSTIFIED,
  spacing: { after: o.after ?? 120, line: 276, before: o.before || 0 }, indent: o.indent, keepNext: o.keepNext
});
const H1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)], pageBreakBefore: false });
const H2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = t => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const B = (text, lvl = 0) => new Paragraph({ numbering: { reference: "bul", level: lvl }, children: runs(text),
  spacing: { after: 60, line: 264 }, alignment: AlignmentType.LEFT });
const N = (text, ref = "num") => new Paragraph({ numbering: { reference: ref, level: 0 }, children: runs(text),
  spacing: { after: 60, line: 264 } });
function eqRuns(text) {
  const out = []; const re = /([_^])\{([^}]*)\}/g; let last = 0, m;
  const base = { italics: true, font: "Cambria", size: 22 };
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    out.push(new TextRun({ text: m[2], ...base, subScript: m[1] === "_", superScript: m[1] === "^" }));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}
const EQ = (text, label) => new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 80, after: 120 },
  tabStops: [{ type: TabStopType.RIGHT, position: 9026 }],
  children: [...eqRuns(text), ...(label ? [new TextRun({ text: "\t(" + label + ")" })] : [])]
});
const CAP = t => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 200 },
  children: runs(t, { size: 19, italics: true, color: "404040" }) });
const TCAP = t => new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: 160, after: 80 }, keepNext: true,
  children: runs(t, { size: 20, bold: true, color: ACC }) });
function IMG(file, wIn) {
  const buf = fs.readFileSync(path.join(__dirname, "../charts", file));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const W = wIn * 96, H = W * h / w;
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 }, keepNext: true,
    children: [new ImageRun({ type: "png", data: buf, transformation: { width: W, height: H },
      altText: { title: file, description: file, name: file } })] });
}

function table(headers, rows, widths, opts = {}) {
  const fs_ = opts.size || 18;
  const total = widths.reduce((a, b) => a + b, 0);
  const mk = (txt, i, head, shade) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders: BORDERS, verticalAlign: VerticalAlign.TOP,
    shading: head ? { fill: ACC, type: ShadingType.CLEAR, color: "auto" } : (shade ? { fill: shade, type: ShadingType.CLEAR, color: "auto" } : undefined),
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: String(txt).split("\n").map(line => new Paragraph({
      alignment: (opts.center && opts.center.includes(i)) ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { after: 0, line: 240 },
      children: runs(line, { size: fs_, color: head ? "FFFFFF" : "000000", bold: head ? true : undefined })
    }))
  });
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => mk(h, i, true)) }),
      ...rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((c, i) =>
        mk(c, i, false, (opts.highlight && opts.highlight(r)) ? "E8F2FD" : (ri % 2 ? "F5F5F5" : null))) }))
    ]
  });
}
const CODE = lines => new Table({
  width: { size: 9026, type: WidthType.DXA }, columnWidths: [9026],
  rows: [new TableRow({ children: [new TableCell({
    width: { size: 9026, type: WidthType.DXA }, borders: BORDERS,
    shading: { fill: "F4F6F9", type: ShadingType.CLEAR, color: "auto" },
    margins: { top: 100, bottom: 100, left: 160, right: 120 },
    children: lines.map(l => new Paragraph({ spacing: { after: 0, line: 252 },
      children: [new TextRun({ text: l, font: "Consolas", size: 17 })] }))
  })] })]
});

const get = (s, rate, k, bursty = false) => R.find(r => r.scheduler === s && r.rate === rate && r.bursty === bursty)[k];
const f1 = x => x >= 10000 ? (x / 1000).toFixed(0) + " s" : x.toFixed(1);
const S_ORDER = ["LAPS-LB (proposed)", "Min-Completion-Time", "Cloud-only", "Round Robin", "FCFS (gateway-local)"];

// ===================================================================== CONTENT
const C = [];

// ---------- Title page
C.push(new Paragraph({ spacing: { before: 1600, after: 200 }, alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: "Question 2", size: 26, color: "595959", font: FONT })] }));
C.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
  children: [new TextRun({ text: "Latency-Aware Task Scheduling and Load Balancing in Fog Computing", bold: true, size: 44, color: ACC, font: FONT })] }));
C.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 },
  children: [new TextRun({ text: "Design and Evaluation of LAPS-LB for a Healthcare IoT Monitoring System, with a Literature Survey of 23 Verified Papers", size: 26, italics: true, color: "404040", font: FONT })] }));
C.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACC, space: 1 } }, spacing: { after: 400 }, children: [] }));
for (const [k, v] of [["Name", "R Ananyaa Sri"], ["Class", "B.Tech CSE IoT-B"], ["Register No.", "23011102069"], ["Roll No.", "23110244"], ["Date", "19 October 2026"]])
  C.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 },
    children: [new TextRun({ text: k + ":  ", bold: true, size: 24 }), new TextRun({ text: v, size: 24 })] }));
C.push(new Paragraph({ children: [new PageBreak()] }));

// ---------- TOC
C.push(new Paragraph({ children: [new TextRun({ text: "Contents", bold: true, size: 32, color: ACC })], spacing: { after: 200 } }));
C.push(new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }));
C.push(new Paragraph({ children: [new PageBreak()] }));

// ---------- Abstract
C.push(H1("Abstract"));
C.push(P("Continuous healthcare monitoring produces a mixed stream of computational tasks: a small fraction are life-critical (arrhythmia or fall alerts that must be answered within roughly 100 ms), many are routine vital-sign processing, and a few are compute-intensive analytics that tolerate seconds of delay. Conventional schedulers such as First-Come-First-Served (FCFS), Round Robin (RR) and greedy Minimum-Completion-Time (MCT) treat these tasks alike, so a burst of heavy work at the fog layer delays emergencies, while cloud-only execution adds a wide-area round trip that by itself exceeds critical deadlines."));
C.push(P("This report (i) surveys 23 research papers on fog task scheduling, load balancing, latency-aware computing and resource allocation, each verified against a publisher or indexing record, and compares their algorithms, simulation environments, metrics, results and limitations; (ii) identifies a research gap: existing priority-aware schedulers do not bound the *non-preemptive blocking* that long tasks impose on critical ones, and rarely combine deadline feasibility, utilisation-threshold load balancing and energy in a single lightweight online rule; and (iii) proposes **LAPS-LB** (Latency-Aware Priority Scheduling with Load Balancing), a five-module fog orchestrator that estimates per-node completion time including a blocking bound, filters nodes by deadline feasibility and an 80 % utilisation threshold, chooses the node with the lowest weighted latency–utilisation–energy cost, and offloads tasks whose fog execution would exceed a 60 ms blocking budget to the cloud."));
C.push(P(`A discrete-event simulation with 4 heterogeneous fog nodes, a 64-VM cloud and four healthcare task classes was run at 7 arrival rates (20–500 tasks/s, 5 seeds each) plus a bursty emergency workload. LAPS-LB kept the critical-task deadline-miss rate at **0 %** up to 400 tasks/s (${get(S_ORDER[0],500,"miss_Critical").toFixed(1)} % at 500 tasks/s, where the cloud itself saturates), against ${get(S_ORDER[1],50,"miss_Critical").toFixed(1)} % for MCT already at 50 tasks/s and 100 % for cloud-only at every load. Mean critical-task latency stayed between ${get(S_ORDER[0],20,"lat_Critical").toFixed(0)} and ${get(S_ORDER[0],500,"lat_Critical").toFixed(0)} ms. The trade-off is up to 42 % more energy per task than MCT at light load, because heavy analytics are moved to the cloud; above 200 tasks/s energy is equal.`));
C.push(P("**Keywords:** fog computing, healthcare IoT, task scheduling, load balancing, latency-aware offloading, priority queues, deadline-aware scheduling, energy efficiency.", { run: {} }));

// ---------- 1 Introduction
C.push(H1("1. Introduction"));
C.push(P("Wearable and bedside Internet-of-Things (IoT) devices, such as ECG patches, pulse oximeters, blood-pressure cuffs, accelerometers and glucose monitors, generate data continuously. Sending all of it to a remote cloud is simple but slow: wide-area round-trip times of 80–280 ms, plus queueing, exceed the response budget of emergency alerts. Fog computing places compute nodes (ward gateways, hospital micro-servers, edge routers) one network hop from the devices, so latency-sensitive work can be processed locally while heavy work still goes to the cloud [1], [9], [23]."));
C.push(P("Fog nodes, however, are small, heterogeneous and shared. Without careful scheduling, three failure modes appear: (a) **head-of-line blocking**, where a long analytics job occupies a fog CPU while an arrhythmia alert waits behind it; (b) **load imbalance**, where some gateways saturate while neighbours idle; and (c) **blind offloading**, where tasks are pushed to the cloud even when the WAN round trip alone breaks their deadline. The scheduler therefore has to decide, for every task, *where* it runs (which fog node or the cloud) and *when* it runs (its position in that node's queue), using latency, priority, CPU utilisation, bandwidth, deadline and energy together."));
C.push(P("**Contributions.** This report:"));
C.push(N("Surveys and compares 23 verified papers on fog task scheduling, load balancing, latency-aware computing and resource allocation (Section 2), and derives a concrete research gap (Section 3)."));
C.push(N("Designs a three-tier IoT–fog–cloud architecture with a five-module fog orchestrator, per-node multi-level priority queues and a cloud offload path (Section 4)."));
C.push(N("Formalises the scheduling parameters (latency, priority, CPU utilisation, bandwidth, deadline, energy) and proposes the LAPS-LB algorithm with a non-preemptive blocking bound (Section 4)."));
C.push(N("Evaluates LAPS-LB against FCFS, Round Robin, MCT and cloud-only under seven workload levels and a bursty emergency workload, and explains why it outperforms them (Sections 5–6)."));

// ---------- 2 Literature survey
C.push(H1("2. Literature Survey"));
C.push(H2("2.1 Survey method"));
C.push(P("Papers were selected on four themes named in the brief: fog task scheduling, load balancing, latency-aware computing and resource allocation, with additional weight on healthcare use cases and on the simulators used to evaluate them. Candidates were drawn from IEEE Xplore, ACM, Elsevier, Springer, Wiley and MDPI venues and from survey reference lists [15]. **Every paper was verified by web search** against at least one authoritative record (publisher page, DOI/Crossref, DBLP, or the authors' institutional repository) for its title, authors, venue and year; Appendix A lists where each was confirmed. Where a detail (for example, a DOI) could not be confirmed, it is omitted rather than guessed."));
C.push(H2("2.2 Overview by theme"));
C.push(H3("Latency-aware workload allocation and offloading"));
C.push(P("Deng et al. [1] formulated fog–cloud workload allocation as a trade-off between power consumption and delay and showed that giving up a modest amount of fog computation saves bandwidth and cuts transmission latency substantially. Yousefpour et al. [8] proposed a delay-minimising policy in which a fog node either serves a request or offloads it to a neighbour fog node or the cloud based on its queueing delay, evaluated with an analytical model. Pham and Huh [2] scheduled large offloaded applications across owned fog nodes and rented cloud nodes with a heuristic that balances makespan against monetary cost."));
C.push(H3("Application/module placement in the fog"));
C.push(P("Gupta et al.'s iFogSim [4] introduced the module-placement abstraction most later work builds on and showed that edge-ward placement beats cloud-only placement on latency and network usage. Taneja and Davy [5] proposed a resource-aware Module Mapping Algorithm. Skarlat et al. [6] modelled the Fog Service Placement Problem as an optimisation problem, solving it exactly and with a genetic algorithm (GA): the GA lowered network delays, while the exact method used fog resources better. Mahmud et al. placed modules according to latency sensitivity [10] and, in a QoE-aware variant [11], used fuzzy logic to rank placement requests by user expectation, improving processing time, network congestion and service quality."));
C.push(H3("Task scheduling heuristics and metaheuristics"));
C.push(P("Bittencourt et al. [3] compared concurrent, FCFS and delay-priority scheduling under user mobility and showed that the best policy depends on application characteristics. Kabirzadeh, Rahbari and Nickray [7] built a test-and-select hyper-heuristic scheduler and reported 69.99 % lower energy and 59.62 % lower cost than PSO, ACO and SA. Rahbari and Nickray [12] proposed greedy-knapsack scheduling (GKS), which improved energy, execution cost and sensor lifetime over FCFS, concurrent and delay-priority policies in iFogSim. Guevara and da Fonseca [18] used integer linear programming with classes of service and outperformed Random and Round Robin without QoS violations."));
C.push(H3("Load balancing and learning-based scheduling"));
C.push(P("Talaat et al. [16] combined reinforcement learning and a genetic algorithm in LBOS for dynamic load balancing and resource allocation in fog-based patient monitoring. Tuli et al. [19] used asynchronous-advantage-actor-critic (A3C) deep reinforcement learning with a residual recurrent network to schedule tasks in stochastic edge–cloud environments, learning temporal workload patterns in a decentralised way."));
C.push(H3("Healthcare-specific fog systems"));
C.push(P("Gia et al. [23] processed ECG features at smart gateways and achieved more than 90 % bandwidth efficiency with low-latency local response. Rahmani et al. [9] generalised this into Smart e-Health Gateways (UT-GATE) forming a geo-distributed fog layer. Aladwani [13] classified healthcare tasks into high, medium and low importance by patient state (TCVC) to improve static schedulers. Abdelmoneem et al. [17] proposed MobMBAR, a mobility-aware heuristic that ranks tasks by criticality and maximum response time to minimise makespan across cloud and fog. AlZailaa et al. [21] classified e-Health tasks with an SVM and mapped them by priority, reporting 0.23/0.50 ms average execution for critical/non-critical tasks, 73.88 %/52.01 % better than their benchmark. Tuli et al.'s FogBus [14] demonstrated a real Raspberry-Pi fog deployment for sleep-apnoea analysis."));
C.push(H3("Simulators and surveys"));
C.push(P("iFogSim [4], its successor iFogSim2 [20] (mobility, clustering, microservices) and EdgeCloudSim [22] (WLAN/WAN, mobility, load generation, orchestration) are the dominant evaluation environments. Hong and Varghese [15] surveyed resource-management architectures, infrastructure and algorithms across fog/edge computing."));

// ---------- landscape comparison table section break
const LIT = [
  ["1", "Deng et al. [1], 2016, IEEE IoT J.", "Workload allocation as power–delay trade-off; primal problem decomposed into three sub-problems solved separately", "Numerical simulation; synthetic workloads", "System power, end-to-end delay", "Modest fog computation saves WAN bandwidth and sharply reduces transmission latency vs cloud", "Steady-state, aggregate model; no per-task priority, deadlines or queue ordering"],
  ["2", "Pham & Huh [2], 2016, APNOMS", "Heuristic cloud–fog scheduling of offloaded task graphs", "Numerical simulation; synthetic task graphs", "Makespan, cloud monetary cost, trade-off value", "Better makespan–cost trade-off than compared algorithms", "Batch/offline; no latency classes, no energy, no online load balancing"],
  ["3", "Bittencourt et al. [3], 2017, IEEE Cloud Comput.", "Concurrent, FCFS and delay-priority policies under user mobility", "iFogSim; mobile application scenarios", "Application delay, network usage", "Best policy depends on application type and mobility; delay-priority helps latency-sensitive apps", "Simple fixed policies; no cross-node balancing or energy model"],
  ["4", "Gupta et al. [4], 2017, Softw. Pract. Exp. (iFogSim)", "Simulator; cloud-only vs edge-ward module placement", "iFogSim (CloudSim-based); EEG game & surveillance case studies", "Latency, network usage, energy, cost; simulator RAM & run time", "Edge-ward placement reduces latency and network usage; toolkit scales", "Static placement; no dynamic per-task scheduling (later added in iFogSim2)"],
  ["5", "Taneja & Davy [5], 2017, IFIP/IEEE IM", "Resource-aware Module Mapping Algorithm (sorts nodes and modules by capacity/requirement)", "iFogSim", "Latency, network usage, energy", "Better resource utilisation and latency than cloud-only placement", "One-time placement; ignores queueing, deadlines and priorities"],
  ["6", "Skarlat et al. [6], 2017, SOCA", "Fog Service Placement Problem as optimisation; exact solver + genetic algorithm", "Simulated fog landscape (fog colonies)", "Deadline satisfaction, network delay, fog utilisation, cost", "GA lowers communication delay; exact method better uses fog resources", "Exact method does not scale; periodic, not per-task; no energy"],
  ["7", "Kabirzadeh, Rahbari & Nickray [7], 2017, FRUCT", "Hyper-heuristic (test-and-select over metaheuristics)", "Simulation", "Energy, cost", "69.99 % less energy, 59.62 % less cost than PSO, ACO, SA", "No deadlines or task priority; metaheuristic overhead at run time"],
  ["8", "Yousefpour et al. [8], 2018, IEEE IoT J.", "Delay-minimising fog-to-fog collaboration and offloading policy (queue-delay threshold)", "Analytical model + simulation", "Service delay", "Lower IoT service delay than no-collaboration and cloud-centric baselines", "Single request class; static threshold; no energy or utilisation cap"],
  ["9", "Rahmani et al. [9], 2018, FGCS", "Smart e-Health gateways (UT-GATE) forming a fog layer", "Prototype testbed; health-monitoring case study", "Latency, bandwidth, energy, reliability", "Local processing at gateways enables low-latency, scalable monitoring", "Architecture-centric; no formal scheduler or inter-gateway balancing"],
  ["10", "Mahmud et al. [10], 2019, ACM TOIT", "Latency-aware application-module placement and relocation", "iFogSim", "Deadline satisfaction, latency, resource use", "Meets diverse latency requirements while improving fog utilisation", "Module-level, needs app DAG; energy not explicit"],
  ["11", "Mahmud et al. [11], 2019, JPDC", "QoE-aware placement: fuzzy ranking of requests and fog instances", "iFogSim", "Processing time, network congestion, resource affordability, service quality", "Outperforms MeFoRE, QoS-aware and CloudFog placements", "Hand-tuned fuzzy rules; placement, not continuous scheduling"],
  ["12", "Rahbari & Nickray [12], 2019, Turk. J. EECS", "Greedy knapsack-based scheduling (GKS)", "iFogSim; two case studies", "Energy, execution cost, sensor lifetime", "Better than FCFS, concurrent and delay-priority", "No deadline or priority classes; no cloud offload decision"],
  ["13", "Aladwani [13], 2019, Procedia CS", "TCVC: task importance classes (high/med/low by patient state) + VM categorisation", "Simulation of healthcare tasks", "Time-based scheduling performance", "Improves static schedulers (e.g. Max-Min) for urgent tasks", "Static; no load balancing, cloud offload or energy"],
  ["14", "Tuli et al. [14], 2019, JSS (FogBus)", "Lightweight IoT–fog–cloud framework with blockchain integrity", "Real testbed: Raspberry Pi fog, smartphone gateway, pulse oximeter (sleep apnoea)", "Latency, energy, network, CPU usage", "Fog-only without blockchain gives best performance; settings expose trade-offs", "Simple master–worker dispatch; blockchain overhead"],
  ["15", "Hong & Varghese [15], 2019, ACM CSUR", "Survey and taxonomy of fog/edge resource management", "Literature (85 % of papers from 2013–2018)", "Architectures, infrastructure, algorithms", "Classifies dataflow, control and tenancy architectures and algorithms", "Survey; points to open problems in dynamic scheduling"],
  ["16", "Talaat et al. [16], 2020, J. Ambient Intell. Humaniz. Comput.", "LBOS: reinforcement learning + genetic algorithm for load balancing", "Simulation of fog-based healthcare monitoring", "Load-balancing level, response/turnaround time", "Better balancing than compared strategies", "Training/convergence time; GA overhead; no explicit deadline guarantee"],
  ["17", "Abdelmoneem et al. [17], 2020, Comput. Netw.", "MobMBAR: mobility-aware heuristic ranking by criticality and max response time; RSS handoff", "Simulation of cloud–fog healthcare architecture", "Total schedule time (makespan), balance", "Minimises makespan; balances tasks between fog and cloud", "Makespan objective, not per-task deadline miss; no energy"],
  ["18", "Guevara & da Fonseca [18], 2021, Peer-to-Peer Netw. Appl.", "Two ILP schedulers using classes of service", "Numerical evaluation", "QoS violations, makespan, cost", "Outperform Random and Round Robin without QoS violations", "ILP solve time limits online use"],
  ["19", "Tuli et al. [19], 2022, IEEE TMC", "A3C deep RL + residual recurrent network (R2N2), decentralised", "Simulated edge–cloud with real workload traces", "Energy, response time, SLA violations, cost", "Outperforms heuristic and RL baselines", "Heavy model on constrained fog nodes; no hard bound for critical tasks"],
  ["20", "Mahmud et al. [20], 2022, JSS (iFogSim2)", "Simulator: mobility, clustering, microservice orchestration", "iFogSim2 with real datasets; three use cases", "Simulator features, policy latency/usage", "Extends iFogSim; compares with contemporary simulators", "Tool, not an algorithm"],
  ["21", "AlZailaa et al. [21], 2024, JSAN", "SVM task classification (custom kernel) + priority assignment + resource mapping", "Simulation, diverse network setups", "Execution time of critical / non-critical tasks, utilisation", "0.23 / 0.50 ms average; 73.88 % / 52.01 % better than benchmark", "Requires trained classifier; energy and WAN offload cost not modelled"],
  ["22", "Sonmez et al. [22], 2018, Trans. Emerg. Telecom. Tech. (EdgeCloudSim)", "Simulator: WLAN/WAN, mobility, load generator, edge orchestrator", "EdgeCloudSim (CloudSim-based)", "Task failure, service time, utilisation", "Shows effect of edge capacity and mobility on performance", "Tool, not an algorithm"],
  ["23", "Gia et al. [23], 2015, IEEE CIT", "Fog at smart gateways: ECG feature extraction (wavelet)", "Real health-monitoring prototype", "Bandwidth efficiency, latency", ">90 % bandwidth efficiency, low-latency local response", "Single gateway; no scheduling or load balancing"],
];

const portraitProps = { page: { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1300, left: 1440, right: 1440 } } };
const landProps = { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 1000, bottom: 1000, left: 1134, right: 1134 } } };

const C2 = []; // landscape section
C2.push(H2("2.3 Comparative analysis of the surveyed papers"));
C2.push(TCAP("Table 1. Comparison of algorithms, simulation environments/datasets, metrics, results and limitations"));
C2.push(table(["#", "Paper", "Algorithm / approach", "Simulation env. / dataset", "Evaluation metrics", "Key results", "Limitations"],
  LIT, [420, 1900, 2600, 2000, 2000, 2850, 2800], { size: 16, center: [0] }));
C2.push(P("Note: quantitative results are quoted only where the figure was confirmed from the paper's abstract or record; otherwise the result is stated qualitatively.", { run: { size: 17, italics: true, color: "595959" }, before: 80 }));

// ---------- section 2.4 & 3 (portrait again)
const C3 = [];
C3.push(H2("2.4 Synthesis"));
C3.push(TCAP("Table 2. Which scheduling parameters each algorithmic paper considers (✓ = explicitly modelled)"));
const pm = [
  ["Deng [1]", "✓", "", "", "✓", "", "✓", ""],
  ["Pham & Huh [2]", "✓", "", "", "", "", "", ""],
  ["Bittencourt [3]", "✓", "✓", "", "", "", "", ""],
  ["Taneja & Davy [5]", "✓", "", "✓", "✓", "", "✓", ""],
  ["Skarlat [6]", "✓", "", "✓", "", "✓", "", ""],
  ["Kabirzadeh [7]", "", "", "", "", "", "✓", ""],
  ["Yousefpour [8]", "✓", "", "", "", "", "", "✓"],
  ["Mahmud TOIT [10]", "✓", "", "✓", "", "✓", "", ""],
  ["Mahmud QoE [11]", "✓", "✓", "✓", "✓", "", "", ""],
  ["Rahbari GKS [12]", "", "", "", "", "", "✓", ""],
  ["Aladwani TCVC [13]", "", "✓", "", "", "", "", ""],
  ["Talaat LBOS [16]", "✓", "", "✓", "", "", "", "✓"],
  ["Abdelmoneem [17]", "✓", "✓", "", "", "✓", "", "✓"],
  ["Tuli A3C [19]", "✓", "", "✓", "", "✓", "✓", ""],
  ["AlZailaa [21]", "✓", "✓", "✓", "✓", "", "", ""],
  ["**LAPS-LB (this work)**", "✓", "✓", "✓", "✓", "✓", "✓", "✓"],
];
C3.push(table(["Work", "Latency", "Priority", "CPU util.", "Bandwidth", "Deadline", "Energy", "Fog↔Cloud LB"],
  pm, [2226, 900, 900, 900, 1000, 900, 900, 1300], { center: [1, 2, 3, 4, 5, 6, 7], highlight: r => r[0].includes("LAPS") }));
C3.push(P("The comparison shows four patterns. First, placement-oriented work [4]–[6], [10], [11] decides where application *modules* live, usually once, and leaves per-task queue ordering to FCFS. Second, priority-aware healthcare schedulers [13], [17], [21] order tasks by criticality but do not model that a long, already-running task on a non-preemptive fog CPU can still block a critical one. Third, metaheuristic and learning approaches [7], [16], [19] optimise energy or balance well but need iterations or training and give no hard bound for emergency tasks. Fourth, evaluations typically report averages at a few load points; per-class deadline-miss rates under bursty emergency surges are rarely shown.", { before: 120 }));

C3.push(H1("3. Research Gap"));
C3.push(P("From Tables 1 and 2, no surveyed scheduler simultaneously:"));
C3.push(B("**G1 – bounds non-preemptive blocking.** Priority queues [3], [13], [17] reorder waiting tasks, but a 1 s analytics job that has already started still delays a 100 ms alert. None of the surveyed works estimate this blocking term or use it to keep long tasks off nodes that serve emergencies."));
C3.push(B("**G2 – combines deadline feasibility with utilisation-threshold load balancing.** Balancing schemes [8], [16] equalise load or queue delay but do not check whether the chosen node can still meet each task's deadline; deadline-aware placement [6], [10] does not reserve headroom for sudden surges."));
C3.push(B("**G3 – jointly weighs latency, CPU utilisation, bandwidth and energy in one cheap online rule.** Multi-objective treatments are either offline optimisation [1], [6], [18] or training-heavy learning [16], [19], which is costly on gateway-class fog nodes."));
C3.push(B("**G4 – is evaluated per task class under steady and bursty healthcare load.** Critical-class miss rate, which matters most clinically, is seldom reported against conventional baselines across a wide load range."));
C3.push(P("**Proposed direction.** A lightweight, online, O(N)-per-task scheduler that (i) classifies tasks into clinical priority levels, (ii) estimates each node's completion time including transfer, priority-aware backlog and a blocking bound, (iii) filters nodes by deadline feasibility and an 80 % utilisation cap, (iv) picks the lowest weighted latency–utilisation–energy cost, and (v) offloads long, delay-tolerant tasks to the cloud whenever running them on fog would exceed a blocking budget. Section 4 develops this as LAPS-LB."));

// ---------- 4 Proposed framework
C3.push(H1("4. Proposed Framework: LAPS-LB"));
C3.push(H2("4.1 System architecture"));
C3.push(P("Figure 1 shows the three-tier architecture. The **IoT layer** holds about 200 wearables and bedside sensors that report through a smartphone or BLE gateway. The **fog layer** holds heterogeneous fog nodes (6000, 8000, 7000 and 5000 MIPS) and a fog orchestrator that runs LAPS-LB; each fog node owns a four-level priority queue. The **cloud layer** provides an elastic VM pool for compute-intensive analytics, EHR storage and model training. Results and alerts return along the same path; critical alerts can trigger actuation directly from the fog node."));
C3.push(IMG("fig_arch.png", 6.25));
C3.push(CAP("Figure 1. Proposed IoT–fog–cloud architecture with the LAPS-LB fog orchestrator, per-node priority queues and cloud offload path."));
C3.push(H3("Orchestrator modules"));
C3.push(N("**Task Classifier** tags each incoming task with priority p ∈ {3 Critical, 2 High, 1 Normal, 0 Heavy}, relative deadline D, length (million instructions, MI) and input size.", "mods"));
C3.push(N("**Resource Monitor** keeps, per node, the sliding-window CPU utilisation U_i (2 s window), the backlog of queued, running and in-transit work, link bandwidth and power figures, refreshed by node telemetry.", "mods"));
C3.push(N("**Latency-aware Scheduler** estimates the expected completion time ECT_i of the task on every fog node and on the cloud, and keeps only nodes that meet the deadline.", "mods"));
C3.push(N("**Load Balancer** removes nodes above the utilisation threshold θ = 0.8 (except for critical tasks) and picks the node with the lowest weighted cost J_i.", "mods"));
C3.push(N("**Offload Manager** sends tasks whose fog execution time exceeds the blocking budget B_max = 60 ms to the cloud when the cloud can still meet their deadline.", "mods"));
C3.push(H3("Task queues"));
C3.push(P("Each fog node keeps a non-preemptive, multi-level priority queue: a waiting Critical task is always started before any High, Normal or Heavy task, and within each level tasks are ordered Earliest-Deadline-First (EDF). The cloud uses a FCFS queue over its VM pool, which is appropriate because only delay-tolerant or overflow tasks reach it."));

C3.push(H2("4.2 Task classes in the healthcare scenario"));
C3.push(TCAP("Table 3. Healthcare task classes used in design and evaluation"));
C3.push(table(["Class (p)", "Examples", "Share", "Length (MI)", "Input", "Deadline D"], [
  ["Critical (3)", "ECG arrhythmia alert, fall detection", "15 %", "30–80", "≈40 KB", "100 ms"],
  ["High (2)", "SpO₂ / BP fusion, early-warning score", "25 %", "80–200", "≈80 KB", "300 ms"],
  ["Normal (1)", "Periodic filtering, logging, compression", "40 %", "150–400", "≈150 KB", "1 s"],
  ["Heavy (0)", "ML risk models, imaging, long-term trends", "20 %", "3000–9000", "≈1 MB", "6 s"],
], [1500, 3026, 800, 1200, 1100, 1400], { center: [2, 3, 4, 5] }));

C3.push(H2("4.3 Scheduling parameters"));
C3.push(P("The brief requires latency, task priority, CPU utilisation, network bandwidth, deadline and energy. Table 4 defines how each enters LAPS-LB."));
C3.push(TCAP("Table 4. Scheduling parameters and their role"));
C3.push(table(["Parameter", "Symbol", "Definition / how obtained", "Role in LAPS-LB"], [
  ["Latency", "L_i, ECT_i", "Transfer + waiting + execution + return time on node i", "Primary cost term (w₁ = 0.6) and feasibility test"],
  ["Task priority", "p", "Clinical class 0–3 from the classifier", "Queue level; only higher-or-equal priority work counts as backlog; critical tasks bypass the utilisation cap"],
  ["CPU utilisation", "U_i", "Busy fraction of node i over a 2 s sliding window", "Load-balancing term (w₂ = 0.25) and threshold θ = 0.8"],
  ["Network bandwidth", "BW_LAN, BW_WAN", "50 Mbps device→fog; 25 Mbps fog→cloud; 100 Mbps fog↔fog", "Transfer time Tx_i = prop + size / BW; drives fog vs cloud choice for large inputs"],
  ["Deadline", "D", "Relative deadline per class (Table 3)", "Hard filter ECT_i ≤ D; EDF order inside each queue level"],
  ["Energy", "E_i", "Dynamic CPU energy + per-MB network energy", "Cost term (w₃ = 0.15)"],
  ["Task length / size", "MI, S", "Instructions and input bytes", "Execution time MI/MIPS_i; blocking test vs B_max"],
  ["Blocking budget", "B_max", "60 ms: longest fog job allowed to delay a critical task", "Offload trigger for long, delay-tolerant tasks"],
], [1700, 1300, 3026, 3000]));

C3.push(H2("4.4 Mathematical model"));
C3.push(P("For task T with length MI, input size S, priority p and relative deadline D, and node i (fog node or cloud) with speed MIPS_i and c_i servers:"));
C3.push(P("**Transfer time.** Every task first reaches its gateway over the LAN; cloud tasks additionally cross the WAN; neighbouring fog nodes add a short metro hop:", { keepNext: true }));
C3.push(EQ("Tx_{i} = d_{LAN} + S/BW_{LAN} + 1[i = cloud]·(d_{WAN} + S/BW_{WAN}) + 1[i ≠ gw]·(d_{ff} + S/BW_{ff})", "1"));
C3.push(P("**Priority-aware waiting time with blocking bound.** Only work of equal or higher priority delays T, plus at most one lower-priority job that may start before T arrives (non-preemptive blocking):", { keepNext: true }));
C3.push(EQ("W_{i}(p) = ( R_{i} + Σ_{k ∈ Q_i , p_k ≥ p} MI_{k} ) / ( c_{i} · MIPS_{i} )", "2a"));
C3.push(EQ("B_{i}(p) = max_{k ∈ Q_i , p_k < p} MI_{k} / MIPS_{i}", "2b"));
C3.push(P("where R_i is the remaining work of running tasks and Q_i includes queued and in-transit tasks. The expected completion time and latency are:", { keepNext: true }));
C3.push(EQ("ECT_{i} = max( Tx_{i} ,  W_{i}(p) + B_{i}(p) ) + MI / MIPS_{i} ,     L_{i} = ECT_{i} + d_{return}", "3"));
C3.push(P("**Energy** of executing T on node i:", { keepNext: true }));
C3.push(EQ("E_{i} = ( P_{i}^{busy} − P_{i}^{idle} ) · MI / MIPS_{i} + e_{LAN}·S + 1[i = cloud]·e_{WAN}·S", "4"));
C3.push(P("**Objective.** Among the feasible set F = { i : ECT_i ≤ D } ∩ { i : U_i < θ or p = 3 }, choose:", { keepNext: true }));
C3.push(EQ("J_{i} = w_{1}·ECT_{i} / max_{F}ECT + w_{2}·U_{i} + w_{3}·E_{i} / max_{F}E ,    w_{1} + w_{2} + w_{3} = 1", "5a"));
C3.push(EQ("i* = argmin_{i ∈ F} J_{i}", "5b"));
C3.push(P("subject to the offload rule: if p < 3 and min_fog MI/MIPS_i > B_max and ECT_cloud ≤ D, then i* = cloud. The weights (0.6, 0.25, 0.15) put latency first, as required for patient safety, while still steering load away from busy nodes and towards cheaper execution when both are feasible."));

C3.push(H2("4.5 LAPS-LB algorithm"));
C3.push(TCAP("Algorithm 1. LAPS-LB (run by the fog orchestrator for every arriving task)"));
C3.push(CODE([
  "Input : task T = (MI, S, D, p); nodes N = Fog ∪ {Cloud}; monitor state U_i, Q_i, R_i",
  "Output: target node i*  (T joins i*'s queue at level p, EDF order)",
  " 1  for each node i in N do",
  " 2      Tx_i  ← transfer time (Eq. 1)",
  " 3      ECT_i ← max(Tx_i, W_i(p)+B_i(p)) + MI/MIPS_i     // Eq. 2-3",
  " 4      E_i   ← execution + transmission energy          // Eq. 4",
  " 5  if p < 3 and min_fog MI/MIPS_i > B_max then          // blocking rule",
  " 6      if ECT_cloud ≤ D then return Cloud",
  " 7  F ← { i : ECT_i ≤ D }                               // deadline filter",
  " 8  if p < 3 then",
  " 9      F' ← { i ∈ F : i = Cloud or U_i < θ }           // load balancing",
  "        if F' ≠ ∅ then F ← F'",
  "10  if F = ∅ then return argmin_i ECT_i                 // best effort",
  "11  return argmin_{i∈F} J_i                              // Eq. 5",
]));
C3.push(P("**Complexity.** Each decision evaluates N = |Fog| + 1 nodes; with incrementally maintained per-priority backlog sums the cost is O(N), so the orchestrator adds microseconds per task, which is negligible next to the 100 ms critical deadline and suitable for gateway-class hardware. No training phase is required.", { before: 120 }));
C3.push(IMG("fig_flow.png", 4.3));
C3.push(CAP("Figure 2. Decision flow of LAPS-LB for one task."));

C3.push(H2("4.6 Load-balancing strategy"));
C3.push(B("**Threshold-based admission (θ = 0.8):** non-critical tasks are not placed on fog nodes above 80 % utilisation, which keeps 20 % headroom on every node for emergency surges."));
C3.push(B("**Cost-weighted dispatch:** among feasible nodes the utilisation term in J_i spreads tasks towards cooler nodes, including fog-to-fog transfer to a neighbour when the extra 2–3 ms still meets the deadline."));
C3.push(B("**Vertical (fog → cloud) balancing:** the Offload Manager moves long, delay-tolerant work to the cloud, and the deadline filter sends Normal/High overflow there once all fog nodes are above θ."));
C3.push(B("**Critical bypass:** Critical tasks ignore θ and may use any node, because a hot but fast node is still better than a deadline miss."));

// ---------- 5 Evaluation
C3.push(H1("5. Performance Evaluation"));
C3.push(H2("5.1 Experimental setup"));
C3.push(P("A discrete-event simulator was written in Python following the iFogSim sense–process–actuate model [4], so every scheduler sees identical task streams. Each configuration ran 200 simulated seconds, was repeated with 5 random seeds, and the averages are reported. Task arrivals are Poisson; the bursty workload alternates 10 s at 2× the mean rate with 30 s at ⅔ of it (mean 120 tasks/s), modelling emergency surges such as a ward-wide alarm. WAN propagation varies uniformly from 40 to 140 ms per task, while schedulers only know its mean, so estimates are imperfect."));
C3.push(TCAP("Table 5. Simulation parameters"));
C3.push(table(["Component", "Setting"], [
  ["Fog nodes", "4 nodes, 1 core each: 6000 / 8000 / 7000 / 5000 MIPS; busy 12 / 15 / 13.5 / 10 W; idle 5 / 6 / 5.5 / 4 W"],
  ["Cloud", "64 VMs × 10,000 MIPS; 35 W per busy VM (including data-centre overhead)"],
  ["Network", "Device→fog 4 ms + 50 Mbps; fog→fog 2 ms + 100 Mbps; fog→cloud 40–140 ms + 25 Mbps; network energy 0.10 J/MB (LAN), +0.60 J/MB (WAN)"],
  ["Devices", "200 devices, each attached to one gateway fog node"],
  ["Workloads", "Steady: 20, 50, 100, 200, 300, 400, 500 tasks/s; bursty: mean 120 tasks/s with 2× surges"],
  ["LAPS-LB", "w₁ = 0.6, w₂ = 0.25, w₃ = 0.15; θ = 0.8; B_max = 60 ms; 2 s utilisation window"],
  ["Repetitions", "5 seeds × 200 s per point (≈4,000–100,000 tasks per run)"],
], [1800, 7226]));
C3.push(H3("Baselines (conventional techniques)"));
C3.push(B("**FCFS (gateway-local):** each task runs on its own gateway fog node in arrival order; no offloading (the FCFS policy studied in [3])."));
C3.push(B("**Round Robin:** tasks are spread cyclically over fog nodes, FCFS queues; no offloading."));
C3.push(B("**Min-Completion-Time (MCT):** greedy online Min-Min style rule; each task goes to the fog or cloud node with the lowest estimated completion time, FCFS queues. This is a strong latency-aware baseline."));
C3.push(B("**Cloud-only:** every task is executed in the cloud."));
C3.push(H3("Metrics"));
C3.push(P("Mean end-to-end response time (overall and per class), 95th-percentile critical latency, deadline-miss rate (overall and per class), mean fog CPU utilisation, energy per completed task (dynamic, network and fog idle energy) and the share of tasks executed in the cloud."));

C3.push(H2("5.2 Results under varying workloads"));
C3.push(IMG("fig_miss.png", 6.0));
C3.push(CAP("Figure 3. Overall deadline-miss rate versus arrival rate (mean of 5 seeds)."));
C3.push(P(`**Deadline misses (Fig. 3).** FCFS and Round Robin keep heavy analytics on the fog. The heavy class alone needs about 24,000 MI/s at 20 tasks/s, close to the fog layer's 26,000 MIPS, so their queues grow without bound and ${get("FCFS (gateway-local)",20,"miss_rate").toFixed(0)}–${get("Round Robin",20,"miss_rate").toFixed(0)} % of tasks miss deadlines even at 20 tasks/s and almost all miss from 50 tasks/s. Cloud-only meets the 1 s and 6 s deadlines but misses every critical task, giving a flat ≈15 % miss rate until the cloud saturates at 500 tasks/s (${get("Cloud-only",500,"miss_rate").toFixed(1)} %). MCT degrades from ${get("Min-Completion-Time",20,"miss_rate").toFixed(1)} % to ${get("Min-Completion-Time",500,"miss_rate").toFixed(1)} %. LAPS-LB misses no deadlines up to 200 tasks/s and only ${get(S_ORDER[0],400,"miss_rate").toFixed(1)} % and ${get(S_ORDER[0],500,"miss_rate").toFixed(1)} % at 400 and 500 tasks/s.`));
C3.push(IMG("fig_crit.png", 6.0));
C3.push(CAP("Figure 4. Deadline-miss rate of Critical (emergency) tasks."));
C3.push(P(`**Critical tasks (Fig. 4).** This is the clinically decisive metric. MCT already misses ${get("Min-Completion-Time",50,"miss_Critical").toFixed(1)} % of critical tasks at 50 tasks/s and ${get("Min-Completion-Time",100,"miss_Critical").toFixed(1)} % at 100 tasks/s, because its FCFS queues make an alert wait behind long jobs. Cloud-only misses 100 % at every load: its mean critical latency is ≈${get("Cloud-only",50,"lat_Critical").toFixed(0)} ms against a 100 ms deadline. LAPS-LB keeps critical misses at 0 % through 400 tasks/s and ${get(S_ORDER[0],500,"miss_Critical").toFixed(1)} % at 500 tasks/s, with mean critical latency of ${get(S_ORDER[0],20,"lat_Critical").toFixed(1)}–${get(S_ORDER[0],500,"lat_Critical").toFixed(1)} ms.`));
C3.push(IMG("fig_lat.png", 6.0));
C3.push(CAP("Figure 5. Mean end-to-end response time (log scale)."));
C3.push(P(`**Response time (Fig. 5).** LAPS-LB has the lowest mean response time from 50 tasks/s upward (e.g. ${get(S_ORDER[0],200,"avg_latency_ms").toFixed(0)} ms vs ${get("Min-Completion-Time",200,"avg_latency_ms").toFixed(0)} ms for MCT and ${get("Cloud-only",200,"avg_latency_ms").toFixed(0)} ms for cloud-only at 200 tasks/s). At 20 tasks/s MCT is slightly faster on average (${get("Min-Completion-Time",20,"avg_latency_ms").toFixed(0)} vs ${get(S_ORDER[0],20,"avg_latency_ms").toFixed(0)} ms) because it runs some heavy jobs on idle fog nodes, whereas LAPS-LB deliberately sends them to the cloud to protect critical traffic, which is a design choice rather than a loss of feasibility, since heavy deadlines are 6 s.`));
C3.push(IMG("fig_util.png", 6.0));
C3.push(CAP("Figure 6. Mean fog CPU utilisation; LAPS-LB holds about 80 % (θ) and keeps headroom."));
C3.push(P(`**Load balancing and utilisation (Fig. 6).** Baselines that keep work on the fog drive every node to 97–100 % utilisation, at which point queueing delay dominates. LAPS-LB raises fog utilisation with demand up to the 80 % threshold and then shifts overflow vertically to the cloud (cloud share rises from ${get(S_ORDER[0],100,"cloud_share").toFixed(0)} % at 100 tasks/s to ${get(S_ORDER[0],500,"cloud_share").toFixed(0)} % at 500 tasks/s). Across fog nodes, the standard deviation of utilisation stays ≤ ${Math.max(...[20,50,100,200,300,400,500].map(x=>get(S_ORDER[0],x,"fog_util_std"))).toFixed(1)} percentage points at every load, compared with ${get("Min-Completion-Time",20,"fog_util_std").toFixed(1)} points for MCT at 20 tasks/s, where MCT piles work on the fastest node.`));
C3.push(IMG("fig_energy.png", 6.0));
C3.push(CAP("Figure 7. Energy per completed task (dynamic + network + fog idle energy)."));
C3.push(P(`**Energy (Fig. 7).** FCFS and Round Robin appear cheapest (≈3 J/task) only because they never pay WAN or cloud costs; they miss almost every deadline, so this is not a useful operating point. At light load LAPS-LB spends ${get(S_ORDER[0],20,"energy_per_task_J").toFixed(2)} J/task against ${get("Min-Completion-Time",20,"energy_per_task_J").toFixed(2)} J for MCT (+${(100*(get(S_ORDER[0],20,"energy_per_task_J")/get("Min-Completion-Time",20,"energy_per_task_J")-1)).toFixed(0)} %), the price of moving heavy analytics to higher-power cloud VMs over the WAN. From 200 tasks/s the two are within 2 %, and LAPS-LB is 4–8 % cheaper than cloud-only at every load.`));
C3.push(TCAP("Table 6. Detailed results at medium (200 tasks/s) and very high (500 tasks/s) load"));
const rowsT = [];
for (const rate of [200, 500]) for (const s of S_ORDER) rowsT.push([String(rate), s,
  f1(get(s, rate, "avg_latency_ms")), f1(get(s, rate, "lat_Critical")), f1(get(s, rate, "p95_Critical")),
  get(s, rate, "miss_rate").toFixed(1), get(s, rate, "miss_Critical").toFixed(1), get(s, rate, "fog_util_mean").toFixed(1),
  get(s, rate, "energy_per_task_J").toFixed(2), get(s, rate, "cloud_share").toFixed(1)]);
C3.push(table(["λ", "Scheduler", "Mean RT (ms)", "Crit. mean (ms)", "Crit. p95 (ms)", "Miss %", "Crit. miss %", "Fog util %", "J/task", "Cloud %"],
  rowsT, [450, 1900, 900, 900, 900, 700, 800, 800, 700, 976], { size: 16, center: [0, 2, 3, 4, 5, 6, 7, 8, 9], highlight: r => r[1].includes("LAPS") }));
C3.push(P("Times above 10,000 ms are shown in seconds; for FCFS and Round Robin they reflect unbounded queue growth over the 200 s run.", { run: { size: 17, italics: true, color: "595959" }, before: 60 }));

C3.push(H2("5.3 Bursty emergency workload"));
C3.push(IMG("fig_bursty.png", 6.0));
C3.push(CAP("Figure 8. Deadline-miss rate under bursty load (mean 120 tasks/s, 2× surges for 10 s every 40 s)."));
C3.push(P(`Surges are where healthcare schedulers are tested in practice. During 240 tasks/s bursts MCT's fog queues fill and ${get("Min-Completion-Time",120,"miss_Critical",true).toFixed(1)} % of critical tasks miss their deadlines (${get("Min-Completion-Time",120,"miss_rate",true).toFixed(1)} % overall). LAPS-LB absorbs the bursts with the 20 % headroom reserved by θ and by moving Normal/High overflow to the cloud, finishing with **${get(S_ORDER[0],120,"miss_rate",true).toFixed(1)} %** misses overall and for critical tasks, and a critical p95 latency of ${get(S_ORDER[0],120,"p95_Critical",true).toFixed(0)} ms.`));

// ---------- 6 Discussion
C3.push(H1("6. Why LAPS-LB Outperforms Conventional Scheduling"));
C3.push(TCAP("Table 7. Mechanism-level comparison"));
C3.push(table(["Weakness of conventional technique", "Observed effect", "LAPS-LB mechanism that removes it"], [
  ["FCFS / RR keep all work, including 1 s analytics, on the fog", "Queues grow without bound once heavy demand ≈ fog capacity (≈20 tasks/s)", "Offload rule: tasks whose fog execution exceeds B_max go to the cloud"],
  ["FCFS queue order (FCFS, RR, MCT)", "Critical alerts wait behind long jobs; MCT misses 57 % of critical tasks at 50 tasks/s", "Four-level priority queues, EDF inside each level"],
  ["Completion-time estimates ignore non-preemptive blocking", "A node looks free, then starts a long job just before the alert arrives", "Blocking term B_i(p) in ECT_i (Eq. 2)"],
  ["Greedy MCT drives fog nodes to ~100 %", "No headroom for surges; miss rate climbs with load", "Utilisation cap θ = 0.8 for non-critical tasks; vertical overflow to cloud"],
  ["Cloud-only ignores WAN latency", "≈200 ms critical latency, 100 % critical misses", "Deadline-feasibility filter keeps critical tasks at the fog"],
  ["Latency-only objectives", "Ties broken arbitrarily; energy and balance ignored", "Weighted cost J_i over latency, utilisation and energy"],
], [3000, 3000, 3026]));
C3.push(P("**Trade-offs and limitations.** (i) LAPS-LB uses up to 42 % more energy per task than MCT at light load because heavy jobs run in the cloud; an operator can relax B_max or add a low-load exception that lets heavy jobs use idle fog nodes, at some risk to critical latency. (ii) Heavy tasks see ≈1.26 s mean latency instead of the ≈1.2 s MCT achieves by using idle fog nodes, which is well inside their 6 s deadline. (iii) At 500 tasks/s the cloud pool itself saturates, and LAPS-LB begins to miss deadlines (6 % critical); elastic cloud scaling or admission control would be needed beyond that point. (iv) The results come from a purpose-built simulator with synthetic workloads and assumed power and network figures; validating on iFogSim2 [20] or EdgeCloudSim [22], and on a Raspberry-Pi testbed in the style of FogBus [14] with real ECG traces, is the next step. (v) Weights and thresholds were set by design reasoning, not tuned; a sensitivity study is future work.", { before: 120 }));

// ---------- 7 Conclusion
C3.push(H1("7. Conclusion and Future Work"));
C3.push(P("This report surveyed 23 verified papers and found that existing fog schedulers rarely combine clinical priority, deadline feasibility, utilisation-threshold load balancing and energy in one online rule, and none bound the blocking that long, non-preemptive tasks impose on emergency traffic. LAPS-LB fills that gap with a five-module orchestrator, per-node multi-level priority queues, a blocking-aware completion-time estimate, an 80 % utilisation cap and a weighted latency–utilisation–energy cost, all at O(N) cost per task. In simulation it kept emergency-task deadline misses at 0 % up to 400 tasks/s and under bursty surges, where FCFS, Round Robin, MCT and cloud-only schedulers missed between 57 % and 100 % of critical deadlines, at the price of higher energy at light load."));
C3.push(P("Future work: (1) preemptive or reserved-core execution for critical tasks; (2) adaptive tuning of θ, B_max and the weights, for example with a lightweight bandit or reinforcement-learning layer on top of the rule-based core; (3) mobility-aware handoff between gateways, following [3], [17], [20]; (4) security and privacy for patient data in transit [14]; and (5) implementation on real fog hardware with clinical datasets."));

// ---------- References
C3.push(H1("References"));
const REFS = [
  "R. Deng, R. Lu, C. Lai, T. H. Luan and H. Liang, \"Optimal workload allocation in fog-cloud computing toward balanced delay and power consumption,\" *IEEE Internet of Things Journal*, vol. 3, no. 6, pp. 1171–1181, 2016, doi: 10.1109/JIOT.2016.2565516.",
  "X.-Q. Pham and E.-N. Huh, \"Towards task scheduling in a cloud-fog computing system,\" in *Proc. 18th Asia-Pacific Network Operations and Management Symposium (APNOMS)*, Kanazawa, Japan, Oct. 2016, doi: 10.1109/APNOMS.2016.7737240.",
  "L. F. Bittencourt, J. Diaz-Montes, R. Buyya, O. F. Rana and M. Parashar, \"Mobility-aware application scheduling in fog computing,\" *IEEE Cloud Computing*, vol. 4, no. 2, pp. 26–35, 2017, doi: 10.1109/MCC.2017.27.",
  "H. Gupta, A. Vahid Dastjerdi, S. K. Ghosh and R. Buyya, \"iFogSim: A toolkit for modeling and simulation of resource management techniques in the Internet of Things, edge and fog computing environments,\" *Software: Practice and Experience*, vol. 47, no. 9, pp. 1275–1296, 2017, doi: 10.1002/spe.2509.",
  "M. Taneja and A. Davy, \"Resource aware placement of IoT application modules in fog-cloud computing paradigm,\" in *Proc. IFIP/IEEE Symposium on Integrated Network and Service Management (IM)*, Lisbon, Portugal, May 2017.",
  "O. Skarlat, M. Nardelli, S. Schulte, M. Borkowski and P. Leitner, \"Optimized IoT service placement in the fog,\" *Service Oriented Computing and Applications*, vol. 11, no. 4, pp. 427–443, 2017, doi: 10.1007/s11761-017-0219-8.",
  "S. Kabirzadeh, D. Rahbari and M. Nickray, \"A hyper heuristic algorithm for scheduling of fog networks,\" in *Proc. 21st Conf. of Open Innovations Association (FRUCT)*, 2017, pp. 148–155, doi: 10.23919/FRUCT.2017.8250177.",
  "A. Yousefpour, G. Ishigaki, R. Gour and J. P. Jue, \"On reducing IoT service delay via fog offloading,\" *IEEE Internet of Things Journal*, vol. 5, no. 2, pp. 998–1010, 2018, doi: 10.1109/JIOT.2017.2788802.",
  "A. M. Rahmani, T. N. Gia, B. Negash, A. Anzanpour, I. Azimi, M. Jiang and P. Liljeberg, \"Exploiting smart e-Health gateways at the edge of healthcare Internet-of-Things: A fog computing approach,\" *Future Generation Computer Systems*, vol. 78, pp. 641–658, 2018, doi: 10.1016/j.future.2017.02.014.",
  "R. Mahmud, K. Ramamohanarao and R. Buyya, \"Latency-aware application module management for fog computing environments,\" *ACM Transactions on Internet Technology*, vol. 19, no. 1, Art. 9, 2019, doi: 10.1145/3186592.",
  "R. Mahmud, S. N. Srirama, K. Ramamohanarao and R. Buyya, \"Quality of Experience (QoE)-aware placement of applications in fog computing environments,\" *Journal of Parallel and Distributed Computing*, vol. 132, pp. 190–203, 2019, doi: 10.1016/j.jpdc.2018.03.004.",
  "D. Rahbari and M. Nickray, \"Low-latency and energy-efficient scheduling in fog-based IoT applications,\" *Turkish Journal of Electrical Engineering & Computer Sciences*, vol. 27, no. 2, 2019.",
  "T. Aladwani, \"Scheduling IoT healthcare tasks in fog computing based on their importance,\" *Procedia Computer Science*, vol. 163, pp. 560–569, 2019, doi: 10.1016/j.procs.2019.12.138.",
  "S. Tuli, R. Mahmud, S. Tuli and R. Buyya, \"FogBus: A blockchain-based lightweight framework for edge and fog computing,\" *Journal of Systems and Software*, vol. 154, pp. 22–36, 2019.",
  "C.-H. Hong and B. Varghese, \"Resource management in fog/edge computing: A survey on architectures, infrastructure, and algorithms,\" *ACM Computing Surveys*, vol. 52, no. 5, 2019, doi: 10.1145/3326066.",
  "F. M. Talaat, M. S. Saraya, A. I. Saleh, H. A. Ali and S. H. Ali, \"A load balancing and optimization strategy (LBOS) using reinforcement learning in fog computing environment,\" *Journal of Ambient Intelligence and Humanized Computing*, vol. 11, no. 11, pp. 4951–4966, 2020.",
  "R. M. Abdelmoneem, A. Benslimane and E. Shaaban, \"Mobility-aware task scheduling in cloud-fog IoT-based healthcare architectures,\" *Computer Networks*, vol. 179, Art. 107348, 2020, doi: 10.1016/j.comnet.2020.107348.",
  "J. C. Guevara and N. L. S. da Fonseca, \"Task scheduling in cloud-fog computing systems,\" *Peer-to-Peer Networking and Applications*, vol. 14, no. 2, pp. 962–977, 2021.",
  "S. Tuli, S. Ilager, K. Ramamohanarao and R. Buyya, \"Dynamic scheduling for stochastic edge-cloud computing environments using A3C learning and residual recurrent neural networks,\" *IEEE Transactions on Mobile Computing*, vol. 21, no. 3, Mar. 2022.",
  "R. Mahmud, S. Pallewatta, M. Goudarzi and R. Buyya, \"iFogSim2: An extended iFogSim simulator for mobility, clustering, and microservice management in edge and fog computing environments,\" *Journal of Systems and Software*, vol. 190, Art. 111351, 2022, doi: 10.1016/j.jss.2022.111351.",
  "A. AlZailaa, H. R. Chi, A. Radwan and R. L. Aguiar, \"Service-aware hierarchical fog–cloud resource mapping for e-Health with enhanced-kernel SVM,\" *Journal of Sensor and Actuator Networks*, vol. 13, no. 1, Art. 10, 2024, doi: 10.3390/jsan13010010.",
  "C. Sonmez, A. Ozgovde and C. Ersoy, \"EdgeCloudSim: An environment for performance evaluation of edge computing systems,\" *Transactions on Emerging Telecommunications Technologies*, vol. 29, no. 11, e3493, 2018, doi: 10.1002/ett.3493.",
  "T. N. Gia, M. Jiang, A.-M. Rahmani, T. Westerlund, P. Liljeberg and H. Tenhunen, \"Fog computing in healthcare Internet of Things: A case study on ECG feature extraction,\" in *Proc. IEEE Int. Conf. Computer and Information Technology (CIT/IUCC/DASC/PICOM)*, 2015, doi: 10.1109/CIT/IUCC/DASC/PICOM.2015.51.",
];
REFS.forEach((r, i) => C3.push(new Paragraph({ spacing: { after: 80, line: 252 }, indent: { left: 560, hanging: 560 },
  children: [new TextRun({ text: `[${i + 1}]\t`, size: 20 }), ...runs(r, { size: 20 })],
  tabStops: [{ type: TabStopType.LEFT, position: 560 }] })));

// ---------- Appendix A: verification
C3.push(H1("Appendix A. Source Verification Log"));
C3.push(P("Each reference was checked by web search on 19 October 2026. The table lists the authoritative record that confirmed its title, authors, venue and year (and DOI where given)."));
const VER = [
  ["[1]", "UC Davis networks-group reading notes citing the IEEE IoT J. paper; companion ICC 2015 version on IEEE Xplore / Xi'an Jiaotong Univ. repository"],
  ["[2]", "IEEE Xplore document 7737240 (APNOMS 2016, Kanazawa); Crossref citation with DOI"],
  ["[3]", "Cardiff University ORCA repository; Univ. of Melbourne Find-an-Expert; FAPESP record (vol. 4, no. 2, pp. 26–35)"],
  ["[4]", "arXiv:1606.02007; CLOUDS Lab GitHub README (SPE 47(9):1275–1296, 2017)"],
  ["[5]", "Waterford Institute of Technology repository (IM 2017, Lisbon, 8–12 May 2017)"],
  ["[6]", "TU Wien reposiTUm (SOCA 11, 427–443, DOI); Chalmers research portal; TUHH Open Research"],
  ["[7]", "DOAJ / FRUCT proceedings record with DOI and pages 148–155"],
  ["[8]", "S-Logix paper record with DOI and vol./pages; arXiv:1804.07376"],
  ["[9]", "University of Turku research portal (FGCS 78(2):641–658, DOI); TU Wien reposiTUm"],
  ["[10]", "Univ. of Melbourne Find-an-Expert; DBLP (TOIT 19(1):9:1–9:21, 2019); DOI in iFogSim book chapter references"],
  ["[11]", "University of Hyderabad DSpace record; DOI and JPDC 132:190–203 from arXiv:2305.01974 reference list"],
  ["[12]", "TÜBİTAK journal page (Turk J Elec Eng & Comp Sci, vol. 27, iss. 2)"],
  ["[13]", "Crossref reference metadata (Procedia Comput. Sci. 163:560, DOI 10.1016/j.procs.2019.12.138)"],
  ["[14]", "arXiv:1811.11978; Univ. of Melbourne Find-an-Expert; CLOUDS Lab README (JSS 154:22–36)"],
  ["[15]", "Chung-Ang University ScholarWorks (ACM CSUR 52(5), DOI 10.1145/3326066); arXiv:1810.00305"],
  ["[16]", "DBLP (J. Ambient Intell. Humaniz. Comput. 11(11):4951–4966, 2020)"],
  ["[17]", "HAL hal-03667887 (Computer Networks 179:107348, DOI); DBLP; Ain Shams Scholar"],
  ["[18]", "FAPESP bibliographic record (Peer-to-Peer Netw. Appl. 14(2):962–977, 2021)"],
  ["[19]", "IEEE Xplore document 9169832 (IEEE TMC vol. 21, no. 3, Mar. 2022); arXiv:2009.02186"],
  ["[20]", "RMIT research repository (DOI 10.1016/j.jss.2022.111351); arXiv:2109.05636; DBLP"],
  ["[21]", "DOAJ / MDPI record (JSAN 13(1):10, DOI 10.3390/jsan13010010)"],
  ["[22]", "Wiley Online Library record (ETT 29(11) e3493, first published 6 Aug 2018); DBLP"],
  ["[23]", "University of Turku research portal and UTUPub (DOI 10.1109/CIT/IUCC/DASC/PICOM.2015.51)"],
];
C3.push(table(["Ref.", "Verified against"], VER, [900, 8126], { size: 17 }));
C3.push(P("Simulation code (simulation/fog_scheduling_sim.py), diagram scripts and raw results (results/results.json) used for Section 5 are provided in the accompanying source archive.", { before: 160, run: { italics: true, size: 19, color: "595959" } }));

// ===================================================================== DOCUMENT
const header = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
  children: [new TextRun({ text: "Latency-Aware Task Scheduling & Load Balancing in Fog Computing", size: 16, color: "808080" })] })] });
const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
  children: [new TextRun({ children: ["Page ", PageNumber.CURRENT], size: 18, color: "808080" })] })] });

const doc = new Document({
  features: { updateFields: true },
  creator: "R Ananyaa Sri", title: "Latency-Aware Task Scheduling and Load Balancing in Fog Computing",
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, color: ACC, font: FONT }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0, keepNext: true } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, color: "2E75B6", font: FONT }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1, keepNext: true } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 23, bold: true, color: "404040", font: FONT }, paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2, keepNext: true } },
    ]
  },
  numbering: { config: [
    { reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
    { reference: "num", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
    { reference: "mods", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
  ] },
  sections: [
    { properties: portraitProps, headers: { default: header }, footers: { default: footer }, children: C },
    { properties: { ...landProps, type: SectionType.NEXT_PAGE }, headers: { default: header }, footers: { default: footer }, children: C2 },
    { properties: { ...portraitProps, type: SectionType.NEXT_PAGE }, headers: { default: header }, footers: { default: footer }, children: C3 },
  ]
});
Packer.toBuffer(doc).then(b => { fs.writeFileSync(path.join(__dirname, "Fog_Scheduling_LAPS-LB_Report.docx"), b); console.log("written"); });
