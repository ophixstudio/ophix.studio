/* Crucible Forge Floor: engine, floor renderer and UI.
 * The floor never shows a state the engine didn't reach: every room status,
 * ingot position, token count and dollar figure comes from the job record.
 */
(function () {
  "use strict";
  const { HOUSE_RULES, MODELS, ROOMS, ROOM_BY_ID, SIM } = window.CRUCIBLE;
  const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm";
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  // ---------- storage (per-browser conveniences only) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("crucible.floor." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("crucible.floor." + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem("crucible.floor." + k); } catch (e) {} },
  };

  // ---------- state ----------
  const state = {
    mode: "sim",
    enabled: Object.assign(Object.fromEntries(ROOMS.map((r) => [r.id, true])), store.get("enabled", {})),
    selected: null,
    job: null,
    running: false,
    halt: false,
    abort: null,
    pickResolve: null,
    history: store.get("history", []),
  };
  ROOMS.forEach((r) => { if (r.required) state.enabled[r.id] = true; });

  // ---------- floor geometry (canvas px, 384 x 256) ----------
  const W = 384, H = 256, RW = 76, RH = 58;
  const COLX = [16, 106, 196, 286], ROWY = [18, 100, 182];
  const SPOT = {
    recon: [0, 0], direction: [1, 0], writers: [2, 0], art: [3, 0],
    motion: [3, 1], sound: [2, 1], edit: [1, 1], gate: [0, 1],
    outbound: [0, 2], ship: [1, 2],
  };
  const EXTRA = {
    outbound: { id: "outbound", name: "Outbound", color: "#16F2A4" },
    ship: { id: "ship", name: "Ship Dock", color: "#FF9D3D" },
    ledger: { id: "ledger", name: "Ledger", color: "#3DE8FF" },
  };
  function rect(id) {
    if (id === "ledger") return { x: COLX[2], y: ROWY[2], w: RW * 2 + 14, h: RH };
    const [c, r] = SPOT[id];
    return { x: COLX[c], y: ROWY[r], w: RW, h: RH };
  }
  const center = (id) => { const r = rect(id); return { x: r.x + r.w / 2, y: r.y + r.h - 12 }; };
  const PATH = ["recon", "direction", "writers", "art", "motion", "sound", "edit", "gate", "outbound"];

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + (n || 0).toFixed(n >= 1 ? 2 : 3);
  const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jobId = () => "OPX-" + Math.random().toString(36).slice(2, 6).toUpperCase();

  function log(who, msg, cls) {
    const li = document.createElement("li");
    const color = (ROOM_BY_ID[who] || EXTRA[who] || {}).color || "#8A9AB2";
    const name = (ROOM_BY_ID[who] && ROOM_BY_ID[who].crew) || (EXTRA[who] && EXTRA[who].name) || who;
    li.innerHTML = `<time>${now()}</time><span class="who" style="color:${color}">${esc(name)}</span><span class="${cls || ""}">${esc(msg)}</span>`;
    const feed = $("#feed");
    feed.appendChild(li);
    feed.scrollTop = feed.scrollHeight;
    if (state.job) state.job.events.push({ t: Date.now(), who, msg, cls: cls || "" });
  }

  function parseJSON(text) {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const src = fence ? fence[1] : text;
    const a = src.indexOf("{"), b = src.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("No JSON object in the reply.");
    return JSON.parse(src.slice(a, b + 1));
  }

  // Tiny, safe markdown: escape first, then format lines.
  function md(text) {
    const lines = esc(text || "").split("\n");
    let html = "", list = false, table = false;
    const close = () => { if (list) { html += "</ul>"; list = false; } if (table) { html += "</table>"; table = false; } };
    const inline = (s) => s
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[(VISUAL|REAL|GENERATED)([^\]]*)\]/g, '<span class="cue">[$1$2]</span>')
      .replace(/NEEDS CLAIM APPROVAL/g, '<span class="flag">NEEDS CLAIM APPROVAL</span>');
    for (const raw of lines) {
      const l = raw.trim();
      if (/^#{1,4}\s/.test(l)) { close(); html += `<h3>${inline(l.replace(/^#+\s*/, ""))}</h3>`; continue; }
      if (/^\|.*\|$/.test(l)) {
        if (/^\|[\s:|-]+\|$/.test(l)) continue;
        if (list) { html += "</ul>"; list = false; }
        if (!table) { html += "<table>"; table = true; }
        html += "<tr>" + l.slice(1, -1).split("|").map((c) => `<td>${inline(c.trim())}</td>`).join("") + "</tr>";
        continue;
      }
      if (/^[-*•]\s+/.test(l)) {
        if (table) { html += "</table>"; table = false; }
        if (!list) { html += "<ul>"; list = true; }
        html += `<li>${inline(l.replace(/^[-*•]\s+/, ""))}</li>`;
        continue;
      }
      close();
      if (l) html += `<p>${inline(l)}</p>`;
    }
    close();
    return html;
  }

  // ---------- backends ----------
  let sdkModule = null;
  async function liveClient() {
    const key = $("#apiKey").value.trim();
    if (!key) throw new Error("Add an Anthropic API key under Power, or switch to Simulated.");
    if (!sdkModule) sdkModule = await import(SDK_URL);
    const Anthropic = sdkModule.default || sdkModule.Anthropic;
    return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
  }

  function priceUsage(modelId, u) {
    const p = MODELS[modelId];
    const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1;
    const searches = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
    return (inTok * p.in + (u.output_tokens || 0) * p.out) / 1e6 + searches * 0.01;
  }

  async function callLive(def, prompt, onText) {
    const job = state.job;
    const modelId = job.model;
    const m = MODELS[modelId];
    const client = await liveClient();
    const params = {
      model: modelId,
      max_tokens: 32000,
      system: HOUSE_RULES,
      messages: [{ role: "user", content: prompt }],
    };
    if (m.effort) params.output_config = { effort: def.effort || "medium" };
    if (m.fallbacks) { params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }
    if (def.web && m.web && $("#webTools").checked) {
      params.tools = [
        { type: "web_search_20260209", name: "web_search", max_uses: 5 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
      ];
    }
    const usage = { in: 0, out: 0, cost: 0 };
    let text = "", stop = "", continues = 0, triedWithoutTools = false;
    for (;;) {
      state.abort = new AbortController();
      let msg;
      try {
        const stream = client.beta.messages.stream(params, { signal: state.abort.signal });
        stream.on("text", (t) => { text += t; onText(text); });
        msg = await stream.finalMessage();
      } catch (err) {
        if (state.halt) throw new Error("Halted.");
        if (params.tools && !triedWithoutTools && err && err.status === 400) {
          triedWithoutTools = true;
          delete params.tools;
          log(def.id, "Web tools unavailable on this key; continuing without them.", "warn");
          continue;
        }
        throw err;
      }
      const u = msg.usage || {};
      usage.in += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      usage.out += u.output_tokens || 0;
      usage.cost += priceUsage(modelId, u);
      stop = msg.stop_reason;
      if (stop === "refusal") throw new Error("The model declined this request (safety classifier). Adjust the brief and re-forge.");
      if (stop === "pause_turn" && continues < 3) {
        continues++;
        params.messages = [...params.messages, { role: "assistant", content: msg.content }];
        continue;
      }
      break;
    }
    if (stop === "max_tokens") log(def.id, "Hit the output ceiling; the reply may be cut short.", "warn");
    return { text, usage };
  }

  async function callSim(def, prompt, onText) {
    const full = SIM[def.id](state.job);
    let i = 0;
    while (i < full.length) {
      if (state.halt) throw new Error("Halted.");
      i = Math.min(full.length, i + 6 + Math.floor(Math.random() * 14));
      onText(full.slice(0, i));
      await sleep(22);
    }
    return { text: full, usage: { in: Math.round((HOUSE_RULES.length + prompt.length) / 4), out: Math.round(full.length / 4), cost: 0 } };
  }

  // ---------- engine ----------
  function newJob() {
    const brief = Object.fromEntries(new FormData($("#brief")).entries());
    const job = {
      id: jobId(),
      created: new Date().toISOString(),
      brief,
      mode: state.mode,
      model: state.mode === "live" ? $("#model").value : "simulated",
      budget: Math.max(0.1, parseFloat($("#budget").value) || 2),
      rooms: {},
      concepts: null,
      concept: null,
      gate: null,
      gateRounds: 0,
      verdict: null,
      spend: 0,
      events: [],
      at: null,
      from: null,
      moveT: 1,
    };
    ROOMS.forEach((r) => {
      job.rooms[r.id] = { status: state.enabled[r.id] ? "queued" : "bypass", output: "", runs: 0, in: 0, out: 0, cost: 0, fix: "", error: "" };
    });
    return job;
  }

  function moveIngot(to) {
    const job = state.job;
    if (job.at === to) return;
    job.from = job.at || to;
    job.at = to;
    job.moveT = 0;
  }

  let paintQueued = false;
  function repaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => { paintQueued = false; renderOverlay(); renderInspector(); renderLedger(); renderMeter(); renderStatus(); });
  }

  async function runRoom(id) {
    const job = state.job, def = ROOM_BY_ID[id], room = job.rooms[id];
    if (job.spend >= job.budget) throw new Error(`Budget cap hit (${money(job.spend)} of ${money(job.budget)}).`);
    moveIngot(id);
    room.status = "working";
    room.runs++;
    room.error = "";
    room.output = "";
    if (!state.selected || state.selected === job.lastAuto) { state.selected = id; job.lastAuto = id; }
    log(id, room.fix ? "Reworking what the Gate sent back." : def.task);
    repaint();
    if (job.mode === "sim") await sleep(450); // let the ingot travel the belt
    const prompt = def.prompt(job);
    const backend = job.mode === "live" ? callLive : callSim;
    const res = await backend(def, prompt, (t) => { room.output = t; repaint(); });
    room.output = res.text;
    room.in += res.usage.in;
    room.out += res.usage.out;
    room.cost += res.usage.cost;
    job.spend += res.usage.cost;
    room.fix = "";
    room.status = "done";
    log(id, `Done · ${res.usage.out.toLocaleString()} tokens out${job.mode === "live" ? " · " + money(res.usage.cost) : " · simulated"}.`, "ok");
    repaint();
  }

  function waitForPick() {
    return new Promise((resolve) => { state.pickResolve = resolve; });
  }

  async function runDirection() {
    const job = state.job;
    await runRoom("direction");
    let parsed;
    try { parsed = parseJSON(job.rooms.direction.output); } catch (e) {
      job.rooms.direction.status = "error";
      throw new Error("Director's concepts didn't come back as JSON. Re-forge to try again.");
    }
    job.concepts = (parsed.concepts || []).slice(0, 8);
    if (!job.concepts.length) throw new Error("Director returned no concepts.");
    const rec = job.concepts.find((c) => c.id === parsed.recommended) || job.concepts[0];
    job.recommended = rec.id;
    if ($("#holdDirection").checked) {
      job.rooms.direction.status = "hold";
      state.selected = "direction";
      job.lastAuto = "direction";
      showTab("inspect");
      log("direction", `${job.concepts.length} concepts on the board. Holding for your pick.`, "warn");
      repaint();
      const pick = await waitForPick();
      if (state.halt || !pick) throw new Error("Halted.");
      job.concept = pick;
    } else {
      job.concept = rec;
    }
    job.rooms.direction.status = "done";
    log("direction", `Approved: ${job.concept.title} (${job.concept.lane}).`, "ok");
    repaint();
  }

  async function runGate(limit) {
    const job = state.job;
    for (;;) {
      await runRoom("gate");
      let g;
      try { g = parseJSON(job.rooms.gate.output); } catch (e) {
        job.rooms.gate.status = "error";
        throw new Error("The Gate's report didn't come back as JSON. Re-forge to try again.");
      }
      job.gate = g;
      const fails = (g.checks || []).filter((c) => c.status === "FAIL");
      const verdict = fails.length || String(g.verdict).toUpperCase() === "FAIL" ? "FAIL" : "PASS";
      if (verdict === "PASS") {
        job.rooms.gate.status = "done";
        log("gate", g.summary || "PASS. Plan is clean.", "ok");
        return "PASS";
      }
      job.rooms.gate.status = "fail";
      log("gate", g.summary || `${fails.length} FAIL(s).`, "bad");
      repaint();
      const fixes = {};
      (g.fixes || []).forEach((f) => {
        const r = String(f.room || "").toLowerCase();
        if (ROOM_BY_ID[r] && r !== "gate" && r !== "direction" && state.enabled[r]) fixes[r] = (fixes[r] ? fixes[r] + "\n" : "") + f.instruction;
      });
      fails.forEach((c) => {
        const r = String(c.room || "").toLowerCase();
        if (ROOM_BY_ID[r] && r !== "gate" && r !== "direction" && state.enabled[r] && !fixes[r]) fixes[r] = `${c.label}: ${c.note}`;
      });
      const targets = PATH.filter((r) => fixes[r]);
      if (job.gateRounds >= limit || !targets.length) return "HELD";
      job.gateRounds++;
      await sleep(job.mode === "sim" ? 500 : 0);
      for (const r of targets) {
        job.rooms[r].fix = fixes[r];
        log("gate", `Sent back to ${ROOM_BY_ID[r].name}: ${fixes[r].split("\n")[0]}`, "warn");
        await runRoom(r);
      }
    }
  }

  async function forge() {
    if (state.running) return;
    if (state.mode === "live" && !$("#apiKey").value.trim()) {
      log("ledger", "Add an API key under Power first, or switch to Simulated.", "bad");
      $("#apiKey").focus();
      return;
    }
    state.job = newJob();
    state.running = true;
    state.halt = false;
    state.selected = null;
    const job = state.job;
    $("#feed").innerHTML = "";
    setRunning(true);
    log("ledger", `Job ${job.id} on the floor · ${job.mode === "live" ? MODELS[job.model].label : "simulated run, no model calls"} · budget ${money(job.budget)}.`);
    try {
      for (const id of ["recon"]) if (state.enabled[id]) await runRoom(id);
      await runDirection();
      for (const id of ["writers", "art", "motion", "sound", "edit"]) if (state.enabled[id]) await runRoom(id);
      const limit = parseInt($("#reworkLimit").value, 10) || 0;
      job.verdict = await runGate(limit);
      moveIngot("outbound");
      if (job.verdict === "PASS") {
        log("outbound", "Packet landed in Outbound. Ship Dock stays sealed in this build.", "ok");
      } else {
        log("outbound", "Held at the Gate: FAILs remain after the rework limit. Fix and re-forge.", "bad");
      }
      finishJob();
    } catch (err) {
      const msg = (err && err.message) || String(err);
      Object.values(job.rooms).forEach((r) => { if (r.status === "working" || r.status === "hold") r.status = state.halt ? "halted" : "error"; });
      job.verdict = state.halt ? "HALTED" : "ERROR";
      log("ledger", msg, "bad");
      finishJob();
    }
  }

  function finishJob() {
    const job = state.job;
    state.running = false;
    state.pickResolve = null;
    job.finished = new Date().toISOString();
    if (job.verdict === "PASS" || job.verdict === "HELD") {
      state.history.unshift({ id: job.id, created: job.created, verdict: job.verdict, brand: job.brief.brand, product: job.brief.product, mode: job.mode, spend: job.spend, md: packetMarkdown(job) });
      state.history = state.history.slice(0, 8);
      store.set("history", state.history);
      showTab("outbound");
    }
    setRunning(false);
    repaint();
    renderOutbound();
  }

  function haltJob() {
    if (!state.running) return;
    state.halt = true;
    if (state.abort) try { state.abort.abort(); } catch (e) {}
    if (state.pickResolve) { const r = state.pickResolve; state.pickResolve = null; r(null); }
    log("ledger", "Halt requested.", "warn");
  }

  // ---------- packet ----------
  function packetMarkdown(job) {
    const b = job.brief;
    const L = [];
    L.push(`# ${b.brand || "Untitled brand"}: ${b.product || "product"} · ${job.id}`);
    L.push("");
    L.push(`- Forged: ${new Date(job.created).toLocaleString()}`);
    L.push(`- Mode: ${job.mode === "live" ? MODELS[job.model].label : "SIMULATED (template output, no model calls)"}`);
    L.push(`- Gate: ${job.verdict}${job.gateRounds ? ` after ${job.gateRounds} rework loop(s)` : ""}`);
    L.push(`- Model spend: ${money(job.spend)}`);
    L.push(`- Status: dry run. Not shipped. No media generated.`);
    if (job.concept) {
      L.push("", "## Approved concept", `**${job.concept.title}** · ${job.concept.lane} · ${job.concept.format}`, `Angle: ${job.concept.angle}`, `Sample hook: "${job.concept.hook}"`);
    }
    for (const id of ["recon", "writers", "art", "motion", "sound", "edit"]) {
      const r = job.rooms[id];
      if (r.status === "bypass" || !r.output) continue;
      L.push("", `## ${ROOM_BY_ID[id].name} (${ROOM_BY_ID[id].crew})`, "", r.output.trim());
    }
    if (job.gate) {
      L.push("", "## The Gate", "", `Verdict: **${job.verdict}**. ${job.gate.summary || ""}`, "", "| Check | Status | Room | Note |", "|---|---|---|---|");
      (job.gate.checks || []).forEach((c) => L.push(`| ${c.label || c.id} | ${c.status} | ${c.room || ""} | ${String(c.note || "").replace(/\|/g, "/")} |`));
      if ((job.gate.hookScores || []).length) {
        L.push("", "Hook scores: " + job.gate.hookScores.map((h) => `${h.hook} ${h.score}/10`).join(" · "));
      }
    }
    L.push("", "## Crucible handoff", "", "Paste into a Claude Code session with the Crucible plugin to build it for real:", "", "```", handoffPrompt(job), "```");
    return L.join("\n");
  }

  function handoffPrompt(job) {
    const b = job.brief;
    return [
      `/crucible:crucible`,
      `Build this Forge Floor plan (${job.id}) for ${b.brand || "the brand"}: ${b.product || "product"}.`,
      `Load the brand skill first. Start with new_ad.py and show me 2-3 direction frames before building.`,
      `Concept: ${job.concept ? `${job.concept.title} (${job.concept.lane}, ${job.concept.format})` : "see plan"}.`,
      `Use the hooks, body, shot list and edit brief in the plan below as the starting point; the brand skill's canon wins where they disagree.`,
      `Run the Gate on every final. Do NOT ship: I'll say "ship" when I'm ready.`,
    ].join("\n");
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const slug = (s) => String(s || "ad").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ad";

  // ---------- UI rendering ----------
  function statusOf(id) {
    if (id === "ship") return "sealed";
    if (id === "outbound") {
      const j = state.job;
      if (!j || !j.verdict) return "idle";
      return j.verdict === "PASS" ? "done" : j.verdict === "HELD" ? "fail" : "idle";
    }
    if (id === "ledger") return state.running ? "working" : "idle";
    if (!state.job) return state.enabled[id] ? "idle" : "bypass";
    return state.job.rooms[id].status;
  }
  const ST_LABEL = { idle: "idle", queued: "queued", working: "working", done: "done", fail: "FAIL", hold: "your pick", bypass: "bypassed", error: "error", halted: "halted", sealed: "sealed" };

  function renderOverlay() {
    const ov = $("#overlay");
    if (!ov.childElementCount) {
      [...ROOMS.map((r) => r.id), "outbound", "ship", "ledger"].forEach((id) => {
        const r = rect(id);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "room-hit";
        b.dataset.id = id;
        b.style.left = (r.x / W) * 100 + "%";
        b.style.top = (r.y / H) * 100 + "%";
        b.style.width = (r.w / W) * 100 + "%";
        b.style.height = (r.h / H) * 100 + "%";
        const def = ROOM_BY_ID[id] || EXTRA[id];
        b.innerHTML = `<span class="tag">${esc(def.name)}</span><span class="st"></span>`;
        b.setAttribute("aria-label", def.name);
        b.addEventListener("click", () => { state.selected = id; if (state.job) state.job.lastAuto = null; showTab(id === "outbound" ? "outbound" : id === "ledger" ? "ledger" : "inspect"); repaint(); });
        ov.appendChild(b);
      });
    }
    $$(".room-hit", ov).forEach((b) => {
      const s = statusOf(b.dataset.id);
      const st = $(".st", b);
      st.className = "st " + (s === "fail" || s === "error" ? "fail" : s === "halted" ? "hold" : s);
      st.textContent = ST_LABEL[s] || s;
      b.classList.toggle("sel", state.selected === b.dataset.id);
    });
  }

  function renderStatus() {
    const j = state.job;
    if (!j) { $("#jobLabel").textContent = "No job on the floor."; $("#stageLabel").textContent = ""; return; }
    $("#jobLabel").textContent = `${j.id} · ${j.brief.brand || "Untitled"} · ${j.brief.product || ""}`;
    const at = j.at && (ROOM_BY_ID[j.at] || EXTRA[j.at]);
    $("#stageLabel").textContent = j.verdict ? `Finished · ${j.verdict}` : at ? `${at.name} · ${ST_LABEL[statusOf(j.at)] || ""}` : "";
  }

  function renderMeter() {
    const j = state.job;
    const spend = j ? j.spend : 0;
    const budget = j ? j.budget : parseFloat($("#budget").value) || 2;
    $("#spendLabel").textContent = money(spend);
    $("#budgetLabel").textContent = money(budget);
    const pct = Math.min(100, (spend / budget) * 100);
    $("#spendBar").style.width = pct + "%";
    $("#spendBar").classList.toggle("hot", pct > 80);
  }

  function crewHead(def, status, extra) {
    return `<div class="crew-head"><canvas class="avatar" width="11" height="11" data-color="${def.color}"></canvas>
      <div><div class="nm">${esc(def.crew || def.name)} <span class="badge ${state.job && state.job.mode === "live" ? "live" : "sim"}">${state.job && state.job.mode === "live" ? "LIVE" : "SIM"}</span></div>
      <div class="cl">${esc(def.cls || "")} · ${esc(def.name)} · ${esc(ST_LABEL[status] || status)}</div></div></div>${extra || ""}`;
  }

  function renderInspector() {
    const el = $("#inspector");
    const id = state.selected;
    const def = ROOM_BY_ID[id];
    if (!def) {
      if (id === "ship") {
        el.innerHTML = `<div class="crew-head"><div><div class="nm" style="color:var(--molten)">Ship Dock · sealed</div><div class="cl">No crew assigned in this build</div></div></div>
          <div class="out"><p>In the real Crucible, <b>ship</b> uploads finals to Drive, logs the Script ID, opens the Jira ticket and marks the Registry. None of that exists on the Forge Floor: there's no code path for it, and there's no switch to turn it on.</p>
          <p>What leaves the floor is a packet in Outbound: a plan plus a handoff prompt you paste into Claude Code with the Crucible plugin, where the Gate, direction-first and the "ship" word still apply.</p></div>`;
        return;
      }
      el.innerHTML = `<h2>Floor overview</h2>
        <div class="out"><p>Each room is one Crucible stage run by one bounded crew member with its own brief, loadout and ledger line. The job is the glowing ingot; it moves only when a room actually finishes.</p>
        <p><b>Direction holds for your pick.</b> The Gate checks the whole plan; FAILs go back to the room that owns them and get fixed, never waived. A clean job lands in Outbound. The Ship Dock is sealed.</p>
        <p><b>Simulated</b> runs templated output with no model calls. <b>Live</b> runs every room on Claude with your key.</p></div>
        <h2 style="margin-top:16px">Crew</h2><div class="concepts">${ROOMS.map((r) => `<button type="button" class="ghost" data-pick-room="${r.id}" style="text-align:left"><span style="color:${r.color}">■</span> <b>${esc(r.crew)}</b> · ${esc(r.name)}<br><span style="color:var(--faint);font-size:11px">${esc(r.task)}</span></button>`).join("")}</div>`;
      $$("[data-pick-room]", el).forEach((b) => b.addEventListener("click", () => { state.selected = b.dataset.pickRoom; repaint(); }));
      return;
    }
    const room = state.job ? state.job.rooms[id] : null;
    const status = statusOf(id);
    const meta = `<div class="chips">${def.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>
      <div class="kv"><span>Task</span><b>${esc(def.task)}</b>${room ? `<span>Runs</span><b>${room.runs}</b><span>Tokens</span><b>${room.in.toLocaleString()} in · ${room.out.toLocaleString()} out</b><span>Cost</span><b>${state.job.mode === "live" ? money(room.cost) : "simulated"}</b>` : ""}</div>`;
    let body = "";
    if (!room || (!room.output && status !== "working")) {
      body = `<div class="empty">${status === "bypass" ? "Bypassed on this floor plan." : "Waiting for a job."}</div>`;
    } else if (id === "direction" && state.job.concepts && status !== "working") {
      body = renderConcepts(status === "hold");
    } else if (id === "gate" && state.job.gate && status !== "working") {
      body = renderGate(state.job.gate);
    } else if (def.json && status === "working") {
      body = `<div class="out"><pre class="caret">${esc(room.output)}</pre></div>`;
    } else {
      body = `<div class="out ${status === "working" ? "caret" : ""}">${md(room.output)}</div>`;
    }
    if (room && room.fix && status !== "working") body = `<div class="hold-banner">Sent back by the Gate: ${esc(room.fix)}</div>` + body;
    el.innerHTML = crewHead(def, status, meta) + body;
    drawAvatar($("canvas.avatar", el));
    $$("[data-concept]", el).forEach((b) => b.addEventListener("click", () => {
      const c = state.job.concepts.find((x) => x.id === b.dataset.concept);
      if (c && state.pickResolve) { const r = state.pickResolve; state.pickResolve = null; r(c); }
    }));
  }

  function renderConcepts(holding) {
    const j = state.job;
    return (holding ? `<div class="hold-banner">Show direction first. Pick the concept to build; the floor waits.</div>` : "") +
      `<div class="concepts">${j.concepts.map((c) => `<div class="concept ${c.id === j.recommended ? "rec" : ""}">
        <div class="t">${esc(c.title)} ${c.id === j.recommended ? "<small>DIRECTOR'S PICK</small>" : ""}${j.concept && j.concept.id === c.id ? "<small style='color:var(--green)'>APPROVED</small>" : ""}</div>
        <div class="m">${esc(c.lane)} · ${esc(c.format)}</div>
        <div class="m">${esc(c.angle)}</div>
        <div class="h">"${esc(c.hook)}"</div>
        <div class="r">Why: ${esc(c.why)}<br>Risk: ${esc(c.risk)}</div>
        ${holding ? `<button type="button" class="${c.id === j.recommended ? "primary" : "ghost"}" data-concept="${esc(c.id)}">Build this one</button>` : ""}
      </div>`).join("")}</div>`;
  }

  function renderGate(g) {
    const j = state.job;
    const v = j.rooms.gate.status === "fail" ? "FAIL" : "PASS";
    return `<p class="verdict ${v}">${v}${j.gateRounds ? ` <span style="font:400 11px var(--mono);color:var(--dim)">after ${j.gateRounds} rework loop(s)</span>` : ""}</p>
      <p style="color:var(--dim);margin:0 0 10px">${esc(g.summary || "")}</p>
      <ul class="checks">${(g.checks || []).map((c) => `<li><span class="s ${esc(c.status)}">${esc(c.status)}</span><span>${esc(c.label || c.id)}<br><span class="n">${esc(c.room || "")} · ${esc(c.note || "")}</span></span></li>`).join("")}</ul>
      ${(g.hookScores || []).length ? `<h2>Hook scores</h2><div class="hooks">${g.hookScores.map((h) => `<div class="hookbar" title="${esc(h.note || "")}"><span>${esc(h.hook)}</span><i><b style="width:${Math.max(0, Math.min(10, +h.score || 0)) * 10}%"></b></i><span>${esc(h.score)}</span></div>`).join("")}</div>` : ""}`;
  }

  function renderOutbound() {
    const el = $("#outbound");
    const j = state.job;
    let html = "";
    if (j && (j.verdict === "PASS" || j.verdict === "HELD")) {
      const pass = j.verdict === "PASS";
      html += `<div class="packet ${pass ? "" : "held"}"><div class="t">${pass ? "◆ " : "✕ "}${esc(j.brief.brand || "Untitled")} · ${esc(j.brief.product || "")}</div>
        <div class="m">${esc(j.id)} · ${pass ? "Gate PASS" : "Held at the Gate"} · ${j.mode === "live" ? money(j.spend) : "simulated"}${j.concept ? " · " + esc(j.concept.title) : ""}</div>
        <div class="btns"><button type="button" class="ghost small" data-dl="md">Download plan (.md)</button><button type="button" class="ghost small" data-dl="json">Job record (.json)</button><button type="button" class="ghost small" data-dl="copy">Copy Crucible handoff</button></div></div>`;
    } else {
      html += `<div class="empty">Nothing in Outbound yet. A job lands here once the Gate passes it.</div>`;
    }
    html += `<div class="dock">⛓ SHIP DOCK SEALED: this build cannot upload, open tickets or ship. Packets leave by hand, into Claude Code with the Crucible plugin.</div>`;
    const earlier = state.history.filter((h) => !j || h.id !== j.id);
    if (earlier.length) {
      html += `<h2 style="margin-top:16px">Earlier on this device</h2>` + earlier.map((h, i) => `<div class="packet ${h.verdict === "PASS" ? "" : "held"}" style="padding:8px 10px"><div class="m" style="margin:0 0 6px">${esc(h.id)} · ${esc(h.brand || "Untitled")} · ${esc(h.product || "")} · ${esc(h.verdict)} · ${h.mode === "live" ? money(h.spend) : "sim"}</div><button type="button" class="ghost small" data-hist="${i}">Download .md</button></div>`).join("");
    }
    el.innerHTML = html;
    $("#outCount").textContent = (j && j.verdict === "PASS" ? 1 : 0) + state.history.filter((h) => h.verdict === "PASS" && (!j || h.id !== j.id)).length;
    $$("[data-dl]", el).forEach((b) => b.addEventListener("click", async () => {
      const name = `${j.id}-${slug(j.brief.brand)}-${slug(j.brief.product)}`;
      if (b.dataset.dl === "md") download(name + ".md", packetMarkdown(j));
      if (b.dataset.dl === "json") download(name + ".json", JSON.stringify(j, null, 2), "application/json");
      if (b.dataset.dl === "copy") {
        try { await navigator.clipboard.writeText(handoffPrompt(j) + "\n\n" + packetMarkdown(j)); b.textContent = "Copied"; } catch (e) { b.textContent = "Copy failed: use the .md"; }
      }
    }));
    $$("[data-hist]", el).forEach((b) => b.addEventListener("click", () => {
      const h = earlier[+b.dataset.hist];
      download(`${h.id}-${slug(h.brand)}-${slug(h.product)}.md`, h.md);
    }));
  }

  function renderLedger() {
    const el = $("#ledger");
    const j = state.job;
    if (!j) { el.innerHTML = `<div class="empty">The ledger fills as rooms run. Live runs are priced from the API's own usage numbers.</div>`; return; }
    let tin = 0, tout = 0;
    const rows = ROOMS.map((r) => {
      const x = j.rooms[r.id];
      tin += x.in; tout += x.out;
      return `<tr><td><span style="color:${r.color}">■</span> ${esc(r.name)}</td><td>${x.status === "bypass" ? "-" : x.runs}</td><td>${x.in.toLocaleString()}</td><td>${x.out.toLocaleString()}</td><td>${j.mode === "live" ? money(x.cost) : "-"}</td></tr>`;
    }).join("");
    el.innerHTML = `<h2>${esc(j.id)} · ${j.mode === "live" ? esc(MODELS[j.model].label) : "Simulated"}</h2>
      <table class="led"><thead><tr><th>Room</th><th>Runs</th><th>In</th><th>Out</th><th>Cost</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td><td></td><td>${tin.toLocaleString()}</td><td>${tout.toLocaleString()}</td><td>${j.mode === "live" ? money(j.spend) : "$0"}</td></tr></tfoot></table>
      <p class="fine" style="margin-top:10px">Budget ${money(j.budget)}. ${j.mode === "live" ? "Costs use Anthropic list prices per million tokens, plus $0.01 per web search." : "Simulated token counts are estimates (chars ÷ 4); nothing was billed."} Media generation isn't on this floor, so no Higgsfield or ElevenLabs credits are touched.</p>`;
  }

  function showTab(t) {
    $$(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    $$(".tabpane").forEach((p) => (p.hidden = p.id !== "tab-" + t));
    if (t === "outbound") renderOutbound();
  }

  function renderPlan() {
    const ul = $("#floorPlan");
    ul.innerHTML = ROOMS.map((r) => `<li class="${state.enabled[r.id] ? "" : "off"}"><span class="dot" style="background:${r.color}"></span><span class="nm">${esc(r.name)}</span>${r.required ? '<span class="req">required</span>' : `<input type="checkbox" data-room="${r.id}" ${state.enabled[r.id] ? "checked" : ""} ${state.running ? "disabled" : ""} aria-label="Run ${esc(r.name)}" />`}</li>`).join("") +
      `<li><span class="dot" style="background:#16F2A4"></span><span class="nm">Outbound</span><span class="req">end of line</span></li>
       <li class="sealed"><span class="dot" style="background:#FF9D3D"></span><span class="nm">Ship Dock</span><span class="req" style="color:var(--molten)">sealed</span></li>`;
    $$("input[data-room]", ul).forEach((c) => c.addEventListener("change", () => {
      state.enabled[c.dataset.room] = c.checked;
      store.set("enabled", state.enabled);
      renderPlan();
      repaint();
    }));
  }

  function setRunning(on) {
    $("#runBtn").disabled = on;
    $("#stopBtn").disabled = !on;
    $$("#brief input, #brief textarea, #budget, #model, .seg button").forEach((x) => (x.disabled = on));
    renderPlan();
  }

  // ---------- pixel renderer ----------
  const cv = $("#floor");
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const BOT = [
    "..hhhhhhh..",
    ".hvvvvvvvh.",
    ".hvwvvvwvh.",
    "..hhhhhhh..",
    "....hhh....",
    ".abbbbbbba.",
    "a.bbbbbbb.a",
    "a.bbcccbb.a",
    "..bbbbbbb..",
    "...ll.ll...",
    "...ll.ll...",
  ];
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  function drawBot(g, x, y, color, frame, pose) {
    const pal = { h: "#C9D4E3", v: color, w: "#FFFFFF", b: shade(color, 0.55), c: color, a: "#8FA0B8", l: "#56647C" };
    BOT.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        let ch = row[i];
        if (ch === ".") continue;
        let yy = y + j;
        if (ch === "a" && pose === "work" && frame % 16 < 8) yy -= 1;
        if (ch === "a" && pose === "wave" && i > 5 && j === 6 && frame % 20 < 10) yy -= 3;
        if (ch === "l" && pose === "walk" && ((i < 5) === (frame % 12 < 6))) continue;
        if (ch === "w" && frame % 90 < 4) ch = "v";
        g.fillStyle = pal[ch];
        g.fillRect(x + i, yy, 1, 1);
      }
    });
  }
  function drawAvatar(c) {
    if (!c) return;
    const g = c.getContext("2d");
    g.clearRect(0, 0, 11, 11);
    drawBot(g, 0, 0, c.dataset.color, 1, "idle");
  }

  let frame = 0;
  const sparks = [];
  function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); }

  function drawBelt() {
    // Belt runs under the rooms; only the gaps between rooms show.
    for (let i = 0; i < PATH.length - 1; i++) {
      const a = center(PATH[i]), b = center(PATH[i + 1]);
      const horiz = a.y === b.y;
      const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
      const len = horiz ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
      if (horiz) {
        px(x0, a.y - 3, len, 6, "#121A2A");
        px(x0, a.y - 3, len, 1, "#26344C");
        px(x0, a.y + 2, len, 1, "#0A0F1A");
        const dir = b.x > a.x ? 1 : -1;
        for (let k = 0; k < len; k += 6) { const off = ((frame * 0.5 * dir) % 6 + 6) % 6; px(x0 + ((k + off) % len), a.y - 1, 2, 2, "#1E2B42"); }
      } else {
        px(a.x - 3, y0, 6, len, "#121A2A");
        px(a.x - 3, y0, 1, len, "#26344C");
        for (let k = 0; k < len; k += 6) { const off = (frame * 0.5) % 6; px(a.x - 1, y0 + ((k + off) % len), 2, 2, "#1E2B42"); }
      }
    }
  }

  function drawHazard(r, color) {
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.fillStyle = color;
    for (let k = -r.h; k < r.w; k += 8) { ctx.beginPath(); ctx.moveTo(r.x + k, r.y + r.h); ctx.lineTo(r.x + k + 3, r.y + r.h); ctx.lineTo(r.x + k + 3 + r.h, r.y); ctx.lineTo(r.x + k + r.h, r.y); ctx.fill(); }
    ctx.restore();
  }

  function drawRoom(id) {
    const r = rect(id);
    const def = ROOM_BY_ID[id] || EXTRA[id];
    const s = statusOf(id);
    const col = def.color;
    const working = s === "working";
    // floor
    px(r.x, r.y, r.w, r.h, "#0B111E");
    for (let yy = r.y + 12; yy < r.y + r.h; yy += 6) for (let xx = r.x + ((yy / 6) % 2 ? 0 : 3); xx < r.x + r.w; xx += 6) px(xx, yy, 1, 1, "#141D30");
    // wall
    px(r.x, r.y, r.w, 11, "#101829");
    px(r.x, r.y + 10, r.w, 1, shade(col, working ? 0.9 : 0.4));
    // border
    ctx.strokeStyle = working ? col : s === "fail" || s === "error" ? "#FF5C6C" : s === "hold" ? "#FFBF73" : "#1B2740";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    // status lamp
    const lamp = { working: col, done: "#16F2A4", fail: "#FF5C6C", error: "#FF5C6C", hold: "#FFBF73", halted: "#FFBF73", sealed: "#FF9D3D" }[s];
    if (lamp && (s !== "hold" && s !== "fail" || frame % 30 < 18)) { px(r.x + r.w - 7, r.y + 3, 3, 3, lamp); }

    if (id === "ship") { drawShip(r); return; }
    if (id === "outbound") { drawOutbound(r); return; }
    if (id === "ledger") { drawLedger(r); return; }
    if (id === "gate") drawGateArch(r, working, s);

    // desk + monitor
    const dx = r.x + 10, dy = r.y + 30;
    px(dx, dy + 8, 26, 3, "#27334A");
    px(dx + 2, dy + 11, 2, 6, "#1B2538");
    px(dx + 22, dy + 11, 2, 6, "#1B2538");
    px(dx + 4, dy - 4, 18, 12, "#1A2436");
    px(dx + 5, dy - 3, 16, 10, working ? "#08121E" : "#060A12");
    if (working) {
      for (let k = 0; k < 4; k++) {
        const w = 3 + ((frame / 5 + k * 7) % 11);
        px(dx + 6, dy - 2 + k * 2, Math.min(14, w), 1, shade(col, 0.6 + (k % 2) * 0.3));
      }
    } else if (s === "done") {
      px(dx + 10, dy + 1, 2, 2, "#16F2A4"); px(dx + 12, dy + 2, 2, 2, "#16F2A4"); px(dx + 14, dy, 2, 2, "#16F2A4"); px(dx + 16, dy - 2, 2, 2, "#16F2A4");
    }
    px(dx + 12, dy + 8, 2, 1, "#3A4760");

    // crew member
    let bx = r.x + 44, by = r.y + 30, pose = "idle";
    if (working) { bx = r.x + 38; pose = "work"; if (frame % 6 === 0) sparks.push({ x: dx + 13, y: dy - 5, vy: -0.3 - Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.4, life: 26, c: col }); }
    else if (s === "hold") pose = "wave";
    else if (s === "bypass") { by = r.y + 40; }
    else if (frame % 60 < 30) by -= 0; else by -= 1;
    if (s !== "bypass") drawBot(ctx, bx, by, col, frame, pose);
    // room props
    px(r.x + r.w - 14, r.y + 14, 8, 10, "#131C2E");
    px(r.x + r.w - 13, r.y + 15, 6, 2, shade(col, 0.5));
    px(r.x + r.w - 13, r.y + 19, 6, 1, "#1F2B42");

    if (s === "bypass") { ctx.globalAlpha = 0.55; px(r.x + 1, r.y + 1, r.w - 2, r.h - 2, "#05070D"); ctx.globalAlpha = 0.18; drawHazard(r, "#8A9AB2"); ctx.globalAlpha = 1; }
  }

  function drawGateArch(r, working, s) {
    const ax = r.x + 52, ay = r.y + 16;
    px(ax, ay, 2, 30, "#3A4760"); px(ax + 16, ay, 2, 30, "#3A4760"); px(ax, ay, 18, 2, "#3A4760");
    const beam = s === "fail" ? "#FF5C6C" : s === "done" ? "#16F2A4" : "#FF5C6C";
    if (working) { const yy = ay + 3 + (frame % 26); px(ax + 2, yy, 14, 1, beam); }
    else if (s === "done" || s === "fail") { px(ax + 2, ay + 3, 14, 1, beam); }
  }

  function drawOutbound(r) {
    const j = state.job;
    for (let k = 0; k < 3; k++) px(r.x + 8, r.y + 22 + k * 11, r.w - 16, 2, "#27334A");
    const n = Math.min(12, (j && j.verdict === "PASS" ? 1 : 0) + state.history.filter((h) => h.verdict === "PASS" && (!j || h.id !== j.id)).length);
    for (let i = 0; i < n; i++) {
      const sx = r.x + 10 + (i % 6) * 9, sy = r.y + 15 + Math.floor(i / 6) * 11;
      px(sx, sy, 7, 7, i === 0 && j && j.verdict === "PASS" ? "#16F2A4" : "#0F7A56");
      px(sx + 1, sy + 1, 5, 1, "#8FFFD6");
    }
    if (j && j.verdict === "HELD") { px(r.x + 10, r.y + 37, 7, 7, "#FF5C6C"); }
  }

  function drawShip(r) {
    ctx.globalAlpha = 0.22; drawHazard(r, "#FF9D3D"); ctx.globalAlpha = 1;
    // docked shuttle
    const sx = r.x + 12, sy = r.y + 24;
    px(sx, sy + 6, 36, 10, "#27334A"); px(sx + 36, sy + 8, 8, 6, "#27334A"); px(sx + 44, sy + 10, 3, 2, "#3A4760");
    px(sx + 6, sy + 9, 3, 3, "#0B111E"); px(sx + 14, sy + 9, 3, 3, "#0B111E"); px(sx + 22, sy + 9, 3, 3, "#0B111E");
    px(sx - 3, sy + 8, 3, 6, "#1B2538");
    // padlock
    const lx = r.x + r.w - 22, ly = r.y + 16;
    px(lx + 2, ly, 8, 2, "#FF9D3D"); px(lx + 2, ly, 2, 6, "#FF9D3D"); px(lx + 8, ly, 2, 6, "#FF9D3D");
    px(lx, ly + 6, 12, 9, "#FF9D3D"); px(lx + 5, ly + 9, 2, 3, "#3A1C00");
  }

  function drawLedger(r) {
    px(r.x + 8, r.y + 16, r.w - 16, 34, "#060A12");
    ctx.strokeStyle = "#1B2740"; ctx.strokeRect(r.x + 8.5, r.y + 16.5, r.w - 17, 33);
    const j = state.job;
    if (!j) { if (frame % 40 < 22) px(r.x + 12, r.y + 20, 3, 5, "#3DE8FF"); return; }
    const vals = ROOMS.map((x) => (j.mode === "live" ? j.rooms[x.id].cost : j.rooms[x.id].out));
    const max = Math.max(...vals, 1e-9);
    ROOMS.forEach((x, i) => {
      const h = Math.round((vals[i] / max) * 24);
      px(r.x + 14 + i * 16, r.y + 46 - h, 10, h, x.color);
      if (j.rooms[x.id].status === "working" && frame % 20 < 10) px(r.x + 14 + i * 16, r.y + 20, 10, 1, x.color);
    });
  }

  function drawIngot() {
    const j = state.job;
    if (!j || !j.at) return;
    j.moveT = Math.min(1, j.moveT + 0.025);
    const ia = PATH.indexOf(j.from), ib = PATH.indexOf(j.at);
    let p;
    if (ia < 0 || ib < 0 || ia === ib) p = center(j.at);
    else {
      // walk the belt through intermediate rooms
      const steps = [];
      const dir = ib > ia ? 1 : -1;
      for (let k = ia; k !== ib + dir; k += dir) steps.push(center(PATH[k]));
      const t = j.moveT * (steps.length - 1);
      const k = Math.min(steps.length - 2, Math.floor(t));
      const f = t - k;
      p = { x: steps[k].x + (steps[k + 1].x - steps[k].x) * f, y: steps[k].y + (steps[k + 1].y - steps[k].y) * f };
    }
    const glow = 0.5 + 0.5 * Math.sin(frame / 8);
    const s = statusOf(j.at);
    const hot = s === "fail" || s === "error" ? "#FF5C6C" : j.verdict === "PASS" ? "#16F2A4" : "#FF9D3D";
    ctx.globalAlpha = 0.25 + glow * 0.2; px(p.x - 7, p.y - 5, 14, 9, hot); ctx.globalAlpha = 1;
    px(p.x - 5, p.y - 3, 10, 5, hot);
    px(p.x - 4, p.y - 3, 8, 1, "#FFE2B8");
  }

  function drawSparks() {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx; s.y += s.vy; s.life--;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = s.life / 26; px(s.x, s.y, 1, 1, s.c); ctx.globalAlpha = 1;
    }
  }

  function tick() {
    frame++;
    px(0, 0, W, H, "#05070D");
    for (let i = 0; i < 40; i++) { const sx = (i * 97 + frame * 0.05 * (1 + (i % 3))) % W, sy = (i * 53) % H; px(sx, sy, 1, 1, i % 5 ? "#0E1626" : "#1A2740"); }
    drawBelt();
    [...ROOMS.map((r) => r.id), "outbound", "ship", "ledger"].forEach(drawRoom);
    drawSparks();
    drawIngot();
    requestAnimationFrame(tick);
  }

  // ---------- wiring ----------
  const DEMO = {
    brand: "Kestrel Goods",
    product: "Lumen self-cleaning water bottle",
    url: "",
    audience: "",
    angle: "",
    format: "",
    length: "30-40s",
    offer: "30-day money-back guarantee",
    canon: "- 24 oz, double-wall insulated stainless steel; keeps water cold for 24 hours.\n- UV-C LED cap runs a 60-second cleaning cycle at the press of a button (approved wording: \"cleans the water and the inside of the bottle in 60 seconds\").\n- Cap charges by USB-C; one charge lasts about a month of daily cycles.\n- No medical or health-outcome claims.",
    notes: "Lead wants something that doesn't look like every other bottle ad.",
  };

  function saveBrief() { store.set("brief", Object.fromEntries(new FormData($("#brief")).entries())); }
  function loadBrief(b) { Object.entries(b || {}).forEach(([k, v]) => { const el = $(`#brief [name="${k}"]`); if (el) el.value = v; }); }

  function setMode(m) {
    state.mode = m;
    $$(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    $("#liveBox").hidden = m !== "live";
    const pill = $("#modePill");
    pill.textContent = m === "live" ? "LIVE · " + MODELS[$("#model").value].label : "SIMULATED";
    pill.classList.toggle("live", m === "live");
    store.set("mode", m);
  }

  function init() {
    loadBrief(store.get("brief", null) || DEMO);
    $("#brief").addEventListener("input", saveBrief);
    $("#demoBrief").addEventListener("click", () => { loadBrief(DEMO); saveBrief(); });
    $$(".seg button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    $("#model").value = store.get("model", "claude-opus-5");
    $("#model").addEventListener("change", () => { store.set("model", $("#model").value); setMode(state.mode); });
    let key = "";
    try { key = localStorage.getItem("crucible.floor.key") || sessionStorage.getItem("crucible.floor.key") || ""; } catch (e) {}
    $("#apiKey").value = key;
    $("#rememberKey").checked = !!store.get("rememberKey", false);
    const saveKey = () => {
      const v = $("#apiKey").value.trim();
      store.set("rememberKey", $("#rememberKey").checked);
      try {
        localStorage.removeItem("crucible.floor.key");
        sessionStorage.setItem("crucible.floor.key", v);
        if ($("#rememberKey").checked && v) localStorage.setItem("crucible.floor.key", v);
      } catch (e) {}
    };
    $("#apiKey").addEventListener("change", saveKey);
    $("#rememberKey").addEventListener("change", saveKey);
    $("#budget").addEventListener("input", renderMeter);
    $("#runBtn").addEventListener("click", forge);
    $("#stopBtn").addEventListener("click", haltJob);
    $$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    setMode(store.get("mode", "sim"));
    renderPlan();
    repaint();
    renderOutbound();
    requestAnimationFrame(tick);
  }

  init();
})();
