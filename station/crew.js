/* Crucible Forge Floor: the crew.
 * Each room is one Crucible stage run by one bounded agent. Room order on the
 * floor IS the pipeline order; bypassing a room removes it from the run.
 * Classic script (no modules) so the page also works from file://.
 */
(function () {
  "use strict";

  // Distilled house rules every agent works under. Generic by design: brand
  // canon and approved claims come in through the job ticket, never hard-coded.
  const HOUSE_RULES = `You are one crew member on the Crucible Forge Floor, an AI video-ad production line for paid social (Meta Reels, TikTok; 9:16, 1080x1920).
House rules (always on):
1. Build modular: one shared body plus 5 swappable hooks (the first ~3 seconds). Each hook uses a different hook formula.
2. Show direction first: concepts and direction frames get the lead's approval before a full build.
3. Compliance hard limits: no fabricated credentials (an AI or actor never claims to be a real, named licensed doctor, vet, dentist or other professional); no fabricated customer results (no invented testimonials, "verified buyer" quotes or before/afters presented as real). Where a presenter could read as a real expert, add an "actor portrayal" / "AI-generated" note. Use only claims the job ticket's canon approves; anything else is flagged NEEDS CLAIM APPROVAL.
4. Mechanisms are mundane physical truths. Never invent pseudo-science nouns.
5. The product is canon: its shape, colour and packaging come from real product photos. Never generate logos, seals or packaging text; composite the real assets.
6. Nothing may look AI: real footage first (library, own shoots, stock), generate last. Generated "real" shots are prompted as an ordinary phone capture, real but polished. Never mix generated photoreal b-roll with real talent. Photoreal AI emotion reads fake: if a feeling must carry the shot, animate instead.
7. Voice: plain, first-person, honest copy. A new angle is not a gimmick. VO accents American or British.
8. Captions: 3 words or fewer per chunk, about 62 px. All text inside the TEXT zone x 135-945, y 420-1500. Faces and product inside the SAFE zone x 35-1045, y 240-1680.
9. End card on screen at least 5 s, CTA voiced over it, holding at least 1.5 s after the last VO word; music fades over the last 1.5 s.
10. Credits cost money: stills first, animate only the keepers.
Write for a busy creative lead: concrete, skimmable, no filler, no preamble.`;

  // Pricing per million tokens (input, output), Anthropic first-party rates.
  const MODELS = {
    "claude-opus-5": { label: "Claude Opus 5", in: 5, out: 25, effort: true, web: true, fallbacks: true },
    "claude-sonnet-5": { label: "Claude Sonnet 5", in: 2, out: 10, effort: true, web: true, fallbacks: false },
    "claude-haiku-4-5": { label: "Claude Haiku 4.5", in: 1, out: 5, effort: false, web: false, fallbacks: false },
  };

  function briefBlock(job) {
    const b = job.brief;
    return [
      `JOB TICKET ${job.id}`,
      `Brand: ${b.brand || "(unnamed)"}`,
      `Product: ${b.product || "(unnamed)"}`,
      b.url ? `Product URL: ${b.url}` : "",
      `Audience / buyer: ${b.audience || "(find the single highest-value buyer)"}`,
      `Angle steer: ${b.angle || "(open: pick the highest-value angle)"}`,
      `Format / lane: ${b.format || "(open)"}`,
      `Length: ${b.length || "30-45s"}`,
      `Offer / CTA: ${b.offer || "(none given)"}`,
      `Canon: approved claims and product facts:\n${b.canon || "(none given: keep claims to plain, verifiable product facts and flag anything else NEEDS CLAIM APPROVAL)"}`,
      b.notes ? `Lead's notes: ${b.notes}` : "",
    ].filter(Boolean).join("\n");
  }

  function prior(job, ids) {
    return ids
      .map((id) => {
        const r = job.rooms[id];
        if (!r || !r.output) return "";
        return `\n=== ${ROOM_BY_ID[id].name.toUpperCase()} OUTPUT ===\n${r.output}`;
      })
      .join("\n");
  }

  function chosenConcept(job) {
    const c = job.concept;
    if (!c) return "";
    return `\n=== APPROVED CONCEPT (the lead picked this) ===\n${c.title}\nAngle: ${c.angle}\nFormat: ${c.format}\nLane: ${c.lane}\nSample hook: ${c.hook}\nWhy: ${c.why}`;
  }

  function fixNote(job, id) {
    const f = job.rooms[id] && job.rooms[id].fix;
    return f ? `\n\nTHE GATE SENT THIS BACK. Fix exactly this, keep everything else that passed:\n${f}\n\nYour previous output:\n${job.rooms[id].output}` : "";
  }

  const ROOMS = [
    {
      id: "recon", name: "Recon Lab", crew: "Scout", cls: "Researcher", color: "#3DE8FF",
      skills: ["audience-recon", "reference-analysis"], required: true, web: true, effort: "medium",
      task: "Find the buyer, their words, the pain and the objections.",
      prompt: (job) => `${briefBlock(job)}${fixNote(job, "recon")}

You are SCOUT, the Recon Lab. ${job.brief.url ? "If you have web tools, read the product page and look for real reviews and competitor ads first. " : ""}Produce:
## Buyer
The single highest-value buyer in one line, then 3 bullets on their situation.
## Their words
6-10 phrases in the buyer's own voice (quote real reviews if you found them and say where; otherwise mark them "paraphrase").
## Pains and desires
Top 3 pains, top 3 desires.
## Objections
Top 4 objections and the plain, true answer to each.
## Mechanism
Why the product works, as a mundane physical truth in one or two sentences.
## Necessary beliefs
The 4-6 beliefs the buyer must hold, in order, before they buy.
## Claim flags
Anything you'd want to say that the canon doesn't approve: mark each NEEDS CLAIM APPROVAL.`,
    },
    {
      id: "direction", name: "Direction Room", crew: "Director", cls: "Creative Director", color: "#A77BFF",
      skills: ["ad-direction", "concept-picker"], required: true, effort: "high", json: true,
      task: "Pitch 4-6 ranked concepts. The run holds here for your pick.",
      prompt: (job) => `${briefBlock(job)}${prior(job, ["recon"])}${fixNote(job, "direction")}

You are DIRECTOR, the Direction Room. Pitch 5 concepts, each an ANGLE x FORMAT. A new concept must change the argument, not just the camera. Lanes: "UGC presenter", "real footage", "object-only", "animated", "CGI", "founder". Rank them best first.
Return ONLY a JSON object, no prose, in this shape:
{"concepts":[{"id":"C1","title":"short name","angle":"the argument","format":"the delivery format","lane":"one lane","hook":"one sample spoken opening line","why":"why this wins, one sentence","risk":"the one thing that could sink it"}],"recommended":"C1"}`,
    },
    {
      id: "writers", name: "Writers' Room", crew: "Scribe", cls: "Copywriter", color: "#16F2A4",
      skills: ["scripts-and-hooks"], required: true, effort: "medium",
      task: "Write the shared body and 5 swappable hooks.",
      prompt: (job) => `${briefBlock(job)}${chosenConcept(job)}${prior(job, ["recon"])}${fixNote(job, "writers")}

You are SCRIBE, the Writers' Room. Words only. Write for a flat read-aloud: it must still sound like a person, not an AI pitching.
## Hooks
Exactly 5 hooks, numbered H1-H5, each 1-2 spoken lines (about 3 s), each a different formula. After each, the formula name in brackets, e.g. [call-out], [mistake], [myth-bust], [confession], [demo-first].
## Body
The shared body as a VO script (fits ${job.brief.length || "30-45s"} with any hook), with [VISUAL: ...] cues on their own lines.
## CTA
The end-card line (voiced over the end card).
## Word count and read time
One line.
## Claim check
List every claim you used and where the canon approves it; anything else, rewrite or mark NEEDS CLAIM APPROVAL.`,
    },
    {
      id: "art", name: "Art Dept", crew: "Framer", cls: "Visual Director", color: "#FF83B4",
      skills: ["no-ai-look", "image-generation", "ai-spokesperson"], required: false, effort: "medium",
      task: "Direction frames and still prompts, stills before clips.",
      prompt: (job) => `${briefBlock(job)}${chosenConcept(job)}${prior(job, ["writers"])}${fixNote(job, "art")}

You are FRAMER, the Art Dept. Plan the pictures. No media is generated here; you write prompts a human runs.
## Direction frames
3 frames that sell the concept to the lead (hook frame, mechanism frame, end-card frame). For each: what is in frame, where it sits in the 1080x1920 safe zone, and whether it is REAL (library/stock/shoot) or GENERATED.
## Shot list
Every body shot: number, what we see, source (REAL first; GENERATED only if nothing real fits), and for GENERATED shots an image prompt written as an ordinary phone capture (lens, light, setting, what is slightly imperfect). Product shots always say "from real product photo reference; composite real packaging".
## Presenter
If the lane uses a presenter: an ordinary-looking person (never model-pretty), wardrobe, setting, and the on-screen disclosure line if they could read as an expert.
## AI-tell check
5 things to check on every still before it moves on.`,
    },
    {
      id: "motion", name: "Motion Bay", crew: "Animator", cls: "Video Director", color: "#FF9D3D",
      skills: ["video-generation", "broll-sourcing"], required: false, effort: "low",
      task: "Motion prompts for the keeper stills only.",
      prompt: (job) => `${briefBlock(job)}${chosenConcept(job)}${prior(job, ["art"])}${fixNote(job, "motion")}

You are ANIMATOR, the Motion Bay. For each GENERATED shot in the Art Dept's shot list (skip REAL shots), write one video prompt: subject, one camera move, one action, duration (3-6 s), what must NOT move (product geometry, text), and the continuity lock (same wardrobe, light, set). Then:
## Render order
Which clips to render first and which to skip until the stills are approved.
## Credit estimate
Rough count of clip generations, assuming stills first and 1-2 takes per keeper.`,
    },
    {
      id: "sound", name: "Sound Booth", crew: "Voice", cls: "Audio Director", color: "#4F8CFF",
      skills: ["voiceover", "sound-and-music"], required: false, effort: "low",
      task: "VO direction, music bed and SFX cues.",
      prompt: (job) => `${briefBlock(job)}${chosenConcept(job)}${prior(job, ["writers"])}${fixNote(job, "sound")}

You are VOICE, the Sound Booth.
## VO casting
Voice (American or British), age range, energy, pace in words per second, and 2 lines of read direction.
## Read notes
Per hook H1-H5 and the body: emphasis words and pauses.
## Music bed
Tone, tempo, and where its hit lands (on the turn). No-credit instrumental. About 12 LU under the VO. Fades over the last 1.5 s.
## SFX cues
Timestamped list against the body. Library SFX only.
## End-card timing
The CTA is voiced over the end card; the card holds at least 1.5 s after the last word and stays up at least 5 s.`,
    },
    {
      id: "edit", name: "Edit Bay", crew: "Cutter", cls: "Editor", color: "#C4B5FD",
      skills: ["edit-assembly", "captions", "onscreen-graphics", "editor-brief"], required: true, effort: "medium",
      task: "The editor brief: timeline, captions, graphics, end card.",
      prompt: (job) => `${briefBlock(job)}${chosenConcept(job)}${prior(job, ["writers", "art", "sound"])}${fixNote(job, "edit")}

You are CUTTER, the Edit Bay. Write the editor brief a human editor can build from without asking a question.
## Timeline
A table: time range | VO line | picture (shot number and source) | on-screen text | SFX. Hooks occupy 0-3 s and are swappable; mark the hook-swap point.
## Captions
Style choice in one line (3 words or fewer per chunk, about 62 px, brand colours) and one line on why it fits this ad.
## On-screen graphics
Every card and callout with its copy and position inside the TEXT zone (x 135-945, y 420-1500).
## End card
Copy, duration (at least 5 s), CTA voiced over it, hold at least 1.5 s after the last VO word, music fade over the last 1.5 s.
## Deliverables
One final per hook: file names like [TAG] Ad Name - H1.mp4 ... H5.mp4, 1080x1920.
## Disclosures
Any "actor portrayal" / "AI-generated" note and where it sits.`,
    },
    {
      id: "gate", name: "The Gate", crew: "Warden", cls: "QC Inspector", color: "#FF5C6C",
      skills: ["qc-and-delivery"], required: true, effort: "high", json: true,
      task: "Checks everything. FAILs go back to the room that owns them.",
      prompt: (job) => `${briefBlock(job)}${chosenConcept(job)}${prior(job, ["writers", "art", "motion", "sound", "edit"])}

You are WARDEN, The Gate. You check the plan the way a strict QC lead would. FAILs are fixed, never waived. Check at least:
- compliance: fabricated credentials, fabricated results/testimonials, missing disclosure
- claims: every claim approved by canon, or clearly marked NEEDS CLAIM APPROVAL
- mechanism: mundane and true, no pseudo-science
- hooks: exactly 5, genuinely different formulas, each works with the shared body
- voice: plain and first-person, not an AI pitching
- no-ai-look: real footage first; generated shots prompted as a phone capture; no generated photoreal b-roll mixed with real talent
- product canon: product from real photo reference, no generated packaging text or logos
- safe zones: text inside x 135-945 / y 420-1500
- end card: at least 5 s, CTA voiced over it, holds at least 1.5 s after the last word
- captions: 3 words or fewer per chunk
Only check rooms that produced output. "room" is the room that owns a fix: one of recon, writers, art, motion, sound, edit.
Return ONLY a JSON object, no prose:
{"verdict":"PASS or FAIL","checks":[{"id":"compliance","label":"short label","status":"PASS|WARN|FAIL","room":"writers","note":"one line"}],"hookScores":[{"hook":"H1","score":7,"note":"why, one line"}],"fixes":[{"room":"edit","instruction":"exactly what to change"}],"summary":"one line for the lead"}
Verdict is FAIL if any check is FAIL. Scores are 1-10 for scroll-stop power and clarity.`,
    },
  ];

  const ROOM_BY_ID = {};
  ROOMS.forEach((r) => (ROOM_BY_ID[r.id] = r));

  // ---------- Simulation (no key): templated from the brief, always labelled ----------
  function S(job) {
    const b = job.brief;
    return {
      brand: b.brand || "Your Brand",
      product: b.product || "the product",
      buyer: b.audience || "busy adults who already tried the obvious fixes",
      angle: b.angle || "the habit that's quietly making it worse",
      offer: b.offer || "Try it risk-free",
    };
  }

  const SIM = {
    recon(job) {
      const s = S(job);
      return `## Buyer
${s.buyer}.
- Has tried two or three alternatives and is quietly sceptical.
- Buys on proof they can see in the first week, not on promises.
- Scrolls fast; stops for a relatable moment, not a product shot.

## Their words (paraphrase: simulated, no live research ran)
- "I've tried everything and nothing sticks."
- "I don't have time for another routine."
- "Just tell me what actually changes."
- "I felt dumb for not noticing sooner."
- "It's not expensive, it's just annoying."
- "Show me it working, not a model smiling."

## Pains and desires
Pains: wasted money on fixes that didn't last · the problem comes back · feeling judged for it.
Desires: something that just works in the background · a visible change fast · no new chore.

## Objections
1. "It's a gimmick." Show the mechanism plainly, in one shot.
2. "Too expensive." Compare to what they already spend replacing the old fix.
3. "Won't work for me." Name the common situation directly.
4. "Another subscription." State the offer terms up front.

## Mechanism
${s.product} works because of a simple physical fact about how it's used (replace with the real mechanism from canon).

## Necessary beliefs
1. The problem isn't my fault. 2. The usual fixes miss the real cause. 3. ${s.product} addresses that cause. 4. It fits my day with no new chore. 5. Trying it is low-risk.

## Claim flags
- Any time-to-result number: NEEDS CLAIM APPROVAL.`;
    },
    direction(job) {
      const s = S(job);
      return JSON.stringify({
        concepts: [
          { id: "C1", title: "The Quiet Culprit", angle: s.angle, format: "UGC confession, phone selfie", lane: "UGC presenter", hook: "I didn't realise I was the reason this kept happening.", why: "Takes blame off the buyer and hands it to a habit they can fix today.", risk: "Needs a genuinely ordinary presenter or it reads staged." },
          { id: "C2", title: "Myth vs. Mechanism", angle: "The fix everyone recommends doesn't touch the cause", format: "Split-screen explainer", lane: "real footage", hook: "Everyone tells you to do this. Here's why it never lasts.", why: "Contrarian hooks stop the scroll with a sceptical buyer.", risk: "Can drift into lecturing: keep it under 35s." },
          { id: "C3", title: "Object Only", angle: "Let the product prove it with no person", format: "Macro demo, ASMR sound", lane: "object-only", hook: "Watch what happens in the first ten seconds.", why: "No talent cost; the demo is the argument.", risk: "Only works if the demo is visibly different." },
          { id: "C4", title: "Day 1 / Day 30", angle: "The slow cost of doing nothing", format: "Animated progression", lane: "animated", hook: "What happens if you ignore this for a month?", why: "Escalation format holds attention to the end card.", risk: "Animation style must fit the brand tone." },
          { id: "C5", title: "Founder Straight Talk", angle: "Why we built it after the alternatives failed us", format: "Founder to camera, one take", lane: "founder", hook: `I made ${s.product} because I was sick of wasting money.`, why: "Real person, real credentials: the most trustworthy lane.", risk: "Needs the real founder on camera." },
        ],
        recommended: "C1",
      });
    },
    writers(job) {
      const s = S(job);
      const fixed = job.rooms.writers && job.rooms.writers.fix;
      return `## Hooks
H1. "I didn't realise I was the reason this kept happening." [confession]
H2. "If you've tried everything, watch this before you buy anything else." [call-out]
H3. "The fix everyone recommends? It's why it keeps coming back." [myth-bust]
H4. "Nobody told me this one habit made it worse." [mistake]
H5. "Ten seconds. Watch." [demo-first]

## Body
Here's what I figured out. The usual fix only treats what you can see.
[VISUAL: REAL: presenter at the counter, phone propped, morning light]
The real cause is simpler than that, and it's something you do every day.
[VISUAL: REAL: close-up of the everyday habit]
${s.product} fixes that one thing. No new routine. It just sits there and works.
[VISUAL: product from real photo reference, composited packaging]
I noticed the difference in my first week. Honestly, I felt a bit silly I hadn't tried it sooner.
[VISUAL: presenter, relaxed, back to their day]

## CTA
"${s.offer}. Link's right here."

## Word count and read time
About 95 words, about 34 s at 2.8 words per second with the longest hook.

## Claim check
- "fixes that one thing": the mechanism from canon. OK.
- "difference in my first week": ${fixed ? "rewritten as a personal impression, no result claim. OK." : "NEEDS CLAIM APPROVAL (time-to-result)."}`;
    },
    art(job) {
      return `## Direction frames
1. HOOK: presenter mid-sentence at a kitchen counter, phone-height, face at y about 700 (safe zone). REAL (own shoot) or GENERATED phone capture.
2. MECHANISM: macro of the everyday habit, product entering frame right. REAL (stock or library).
3. END CARD: real packshot composited on a soft brand-colour background, CTA inside the TEXT zone. REAL asset.

## Shot list
S1 · presenter at the counter · GENERATED · "iPhone 15 front camera, propped against a mug, 7am window light from the left, slightly blown highlights, ordinary adult in a worn grey tee, unstyled hair, mid-word, small smudge on the lens"
S2 · close-up of the habit · REAL (stock first)
S3 · product in hand · from real product photo reference; composite real packaging
S4 · presenter relaxed · GENERATED · same capture lock as S1, 3/4 angle
S5 · end-card packshot · REAL asset

## Presenter
Ordinary 30s adult, no make-up look, grey tee, lived-in kitchen. Not presented as any professional, so no disclosure needed; if the script ever implies expertise, add "Actor portrayal. AI-generated."

## AI-tell check
Hands and fingers · text or labels in frame (none generated) · skin too smooth · background too tidy · light direction consistent between shots.`;
    },
    motion() {
      return `S1 · presenter speaks to camera, slight handheld drift, blinks naturally, 4 s. Locked: face, wardrobe, window light. Nothing else moves.
S4 · presenter exhales and smiles small, glances off-camera, static camera, 3 s. Same lock as S1.
(S2, S3 and S5 are REAL: no generation.)

## Render order
Render S1 first (it carries 3 of the 5 hooks). Hold S4 until the S1 still is approved.

## Credit estimate
About 2 keeper stills, then 2-4 clip generations total.`;
    },
    sound() {
      return `## VO casting
American, 30s, warm and slightly wry, 2.8 words per second. "Talk like you're telling a friend what finally worked. Don't sell."

## Read notes
H1: lean on "I". Beat after "happening". H3: stress "why". Body: lift on "simpler", drop on "works".

## Music bed
Warm lo-fi pluck, 92 BPM, hit on "fixes that one thing". About 12 LU under the VO; fades over the last 1.5 s.

## SFX cues
0:03 soft whoosh into the body · 0:14 product tap · 0:22 tiny chime on the result line.

## End-card timing
CTA voiced over the card; the card holds 1.5 s after the last word; at least 5 s on screen.`;
    },
    edit(job) {
      const fixed = job.rooms.edit && job.rooms.edit.fix;
      const endcard = fixed ? "6.0 s (CTA voiced over it, holds 1.8 s after the last VO word)" : "3.0 s";
      return `## Timeline
| Time | VO | Picture | On-screen text | SFX |
|---|---|---|---|---|
| 0:00-0:03 | HOOK (H1-H5, swappable) | S1 | hook caption | - |
| 0:03-0:10 | "Here's what I figured out..." | S1 → S2 | "the real cause" | whoosh |
| 0:10-0:18 | "${S(job).product} fixes that one thing..." | S3 | product callout | tap |
| 0:18-0:26 | "I noticed the difference..." | S4 | - | chime |
| 0:26-end | CTA | S5 end card | CTA copy | music fade |
Hook-swap point: 0:03.

## Captions
Bold white with a brand-colour active word, 3 words or fewer per chunk, 62 px. Fits the casual confession tone.

## On-screen graphics
"the real cause": x 540, y 1350 (TEXT zone). Product callout: x 540, y 480.

## End card
Packshot plus CTA copy, ${endcard}.

## Deliverables
[TAG] Ad Name - H1.mp4 … H5.mp4, 1080x1920.

## Disclosures
None needed: the presenter makes no professional claim.`;
    },
    gate(job) {
      const round = job.gateRounds || 0;
      const pass = round > 0;
      return JSON.stringify({
        verdict: pass ? "PASS" : "FAIL",
        checks: [
          { id: "compliance", label: "No fabricated credentials or results", status: "PASS", room: "writers", note: "Presenter is an ordinary person, no expert claim." },
          { id: "claims", label: "Claims approved by canon", status: pass ? "PASS" : "FAIL", room: "writers", note: pass ? "Time-to-result rewritten as a personal impression." : "\"difference in my first week\" is a time-to-result claim with no canon approval." },
          { id: "hooks", label: "5 hooks, 5 formulas", status: "PASS", room: "writers", note: "confession, call-out, myth-bust, mistake, demo-first." },
          { id: "no-ai-look", label: "Real first, phone-capture prompts", status: "PASS", room: "art", note: "3 of 5 shots real; generated shots prompted as a phone capture." },
          { id: "safe-zones", label: "Text in TEXT zone", status: "PASS", room: "edit", note: "All graphics inside x 135-945, y 420-1500." },
          { id: "end-card", label: "End card ≥5 s, CTA hold ≥1.5 s", status: pass ? "PASS" : "FAIL", room: "edit", note: pass ? "6.0 s card, 1.8 s hold." : "End card is 3.0 s: ends too soon after the CTA." },
          { id: "captions", label: "≤3-word caption chunks", status: "PASS", room: "edit", note: "3-word chunks at 62 px." },
        ],
        hookScores: [
          { hook: "H1", score: 8, note: "Relatable blame-flip, strong thumb-stop." },
          { hook: "H2", score: 6, note: "Clear but generic call-out." },
          { hook: "H3", score: 8, note: "Contrarian and specific." },
          { hook: "H4", score: 7, note: "Good curiosity gap." },
          { hook: "H5", score: 5, note: "Only works if S1 opens on motion." },
        ],
        fixes: pass ? [] : [
          { room: "writers", instruction: "Rewrite the first-week line as a personal impression with no time-to-result claim." },
          { room: "edit", instruction: "End card to at least 5 s with the CTA voiced over it, holding at least 1.5 s after the last VO word." },
        ],
        summary: pass ? "Clean. Plan is ready for Outbound." : "Two FAILs: one unapproved claim, and the end card is too short. Sent back to Writers' Room and Edit Bay.",
      });
    },
  };

  window.CRUCIBLE = { HOUSE_RULES, MODELS, ROOMS, ROOM_BY_ID, SIM, briefBlock };
})();
