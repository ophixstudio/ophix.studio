# Crucible Forge Floor (prototype)

A virtual Crucible: the agency's ad production line drawn as a pixel-art studio floor, where a crew of AI agents takes a brief from recon to a Gate-checked ad plan. Inspired by androoAGI's StarNet ("the layout you draw is the workflow the agents run"), rebuilt around Crucible's own pipeline and house rules.

**Dry run only.** The floor produces plans, scripts and prompts. It generates no media, uploads nothing, opens no tickets and never ships. The Ship Dock is sealed: there is no code path behind it.

## Run it

```sh
python3 -m http.server 8000   # from the repo root
# open http://localhost:8000/station/
```

Opening `station/index.html` straight from disk also works for Simulated mode.

- **Simulated** (default): templated crew output, no model calls, $0. Use it to see the flow: the Direction hold, the Gate failing two checks, the rework loop, then Outbound.
- **Live (Claude)**: paste an Anthropic API key under Power. Every room runs on Claude (Opus 5 by default; Sonnet 5 and Haiku 4.5 are cheaper options) through the official `@anthropic-ai/sdk` loaded from jsDelivr. The key stays in this browser (sessionStorage unless you tick "remember") and goes only to `api.anthropic.com`. A per-job budget halts the run when it's reached.

## The floor

| Room | Crew | Crucible skills it stands in for | What it does |
|---|---|---|---|
| Recon Lab | Scout | audience-recon, reference-analysis | Buyer, their words, pains, objections, mechanism, necessary beliefs. Can search and read the web in Live mode. |
| Direction Room | Director | ad-direction | 5 ranked angle × format concepts. **Holds for your pick** (house rule 1: show direction first). |
| Writers' Room | Scribe | scripts-and-hooks | Shared body plus 5 swappable hooks, each a different formula, with a claim check. |
| Art Dept | Framer | no-ai-look, image-generation, ai-spokesperson | Direction frames and a shot list: real footage first, generated shots prompted as a phone capture. |
| Motion Bay | Animator | video-generation, broll-sourcing | Motion prompts for generated keepers only, render order, credit estimate. |
| Sound Booth | Voice | voiceover, sound-and-music | VO casting and read notes, music bed, SFX cues, end-card timing. |
| Edit Bay | Cutter | edit-assembly, captions, onscreen-graphics, editor-brief | Timeline, captions, graphics positions inside the TEXT zone, end card, deliverables. |
| The Gate | Warden | qc-and-delivery | Checks compliance, claims, hooks, no-ai-look, safe zones, end card and captions. FAILs go back to the room that owns them (never waived), up to the rework limit. |
| Outbound | | | Clean jobs land here as a packet: plan (.md), job record (.json), and a **Crucible handoff** prompt to paste into Claude Code with the plugin. |
| Ship Dock | | ship | Sealed. |
| Ledger | | generation-budget | Tokens and dollars per room, from the API's own usage numbers. |

Art Dept, Motion Bay and Sound Booth can be bypassed in the floor plan; the rest are required. The floor never shows a state the engine didn't reach: the ingot moves only when a room finishes, and every number comes from the job record.

## Files

- `index.html`: the page.
- `crew.js`: house rules, model pricing, the room roster with each crew member's prompt, and the simulated output.
- `station.js`: engine (run, hold, Gate rework loop, budget, halt), Claude calls, pixel renderer, UI.
- `station.css`: the Crucible Neural look on Ophix brand fonts.

## Before this goes further

- This repo is public. The prompts in `crew.js` hold generic, distilled house rules only; brand canon and approved claims come in through the job ticket. Keep client names and private canon out of this folder.
- The page is `noindex` and not linked from the site. Hosting the repo on Pages publishes it at `/station/`; that's harmless (it holds no keys) but move it to the private `ad-studio-kit` repo if you'd rather it not be reachable.
- A browser page holding an API key is fine for one person's local use. For a team, move the Claude calls behind a small local sidecar so the key never touches the page.
