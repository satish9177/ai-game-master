# Research Report — Meaningful Objects, Affordances, Clues, and Causal Interaction

**Status:** Research deliverable (docs-only, no code). Input to future ADRs/implementation plans.
**Date:** 2026-07-15
**Scope:** Answers the research brief "Meaningful Objects, Affordances, Clues, and Causal Interaction for AI Game Master."

Labeling convention used throughout:

- **[VERIFIED]** — primary source located and checked (title/authors/venue confirmed).
- **[PREPRINT]** — arXiv-only or unconfirmed peer review; treat claims cautiously.
- **[INDUSTRY]** — design practice, talks, postmortems; not empirical research.
- **[INFERENCE]** — my own reasoning, clearly separated from source claims.

---

## 1. Executive summary

The literature converges on one central answer to the research question: **objects become
meaningful when they are nodes in a causal dependency structure, not when they carry richer
descriptions.** Every system studied that produces reliably solvable, comprehensible
interactive worlds — TextWorld, ScienceWorld, ALFWorld, Dormans' cyclic generation, Ron
Gilbert's puzzle dependency charts, Doran & Parberry's quest structures — represents objects
as *(preconditions → action → effects)* triples inside a graph that is generated or checked
for reachability *before* play. Prose is a projection over that structure, never the
structure itself. This is exactly compatible with the project's existing architecture: the
mechanical-gate contract (ADR-0061..0064) is already a two-node dependency graph with a
satisfiability check; the recommendation is to generalize that pattern, not to invent a new
system.

**Five highest-value ideas** (all supported by multiple sources):

1. **A closed precondition/effect affordance contract per object** ("STRIPS-lite"). The
   TextWorld/ALFWorld/robotics-affordance consensus: an affordance is a validated triple
   *(object state + agent state) → action → effects*. This is a small extension of the
   existing `Interaction.effect` and `evaluateCondition` machinery.
2. **Generation-time purpose/dependency validation with deterministic repair.** TextWorld
   proves solvability by construction (forward/backward chaining); Smith & Mateas prove it
   by constraint checking; Gilbert and Dormans prove it by authored graph shape. A ~100-line
   fixpoint reachability validator over pure TypeScript data catches unreachable clues,
   missing items, cycles, and softlocks before a room becomes playable.
3. **Informative blocked-action feedback derived from unmet preconditions.** TextWorld and
   ScienceWorld show that actionable feedback ("the stove is not turned on") is what makes
   environments learnable; adventure-game practice treats a failed action that names the
   missing dependency as a *new objective*. Because preconditions are structured data, the
   failure message can be assembled from closed templates — no LLM in the loop.
4. **Fragmented clue clusters bound to existing facts.** Environmental storytelling practice
   (Smith & Worch), the archaeology study (Smith Nicholls & Cook), ClueCart, and Outer
   Wilds' rumor-graph design all show that distributing 2–4 partial evidence items that
   jointly imply one event is the strongest cheap driver of player engagement — provided the
   game tracks *discovered clues* deterministically and the journal helps players re-read
   them. Clues stay non-authoritative pointers to `facts`, reusing `fact_visibility`.
5. **LLM as intent parser onto a closed action vocabulary, not as executor.** ALFWorld's
   core result (abstract text policies transfer to grounded execution) and Tachikuma's
   GM-intent framing both support the brief's idea #7: free player text may be *interpreted*
   into `{action, target, tool}` proposals from the closed vocabulary, then validated and
   executed by trusted reducers. But V1 should ship menu/affordance-chip interaction with no
   LLM in the action path at all; free-text intent is an additive later layer.

**Three ideas that sound interesting but should be deferred:**

1. **A player hypothesis system (confidence, confirm/disprove states).** Outer Wilds
   demonstrates that a curated clue graph ("rumor mode") delivers the investigation feeling
   while the *player's head* holds the hypotheses; ClueCart shows interpretation support is
   a real need but is a substantial HCI tool in its own right. Defer to an experimental
   prototype after clue clusters exist (Slice G, only if playtests show players losing the
   thread).
2. **Creative free-text actions ("I jam the iron bar under the gate").** The supporting
   research (Tachikuma) is a preprint with a weak evaluation; the failure modes (prompt
   injection, unbounded target/tool resolution) are exactly the ones the architecture
   forbids. The bounded version — LLM maps text to an *existing* affordance id — is safe but
   should come after the affordance system is proven with direct UI.
3. **Multi-object emergent combinations / `compare` mechanics.** ScienceWorld shows how fast
   combinatorial object interaction explodes in complexity; nothing in the sources suggests
   the payoff justifies it at this product stage. Tag-based tool matching (any `prying`
   item opens a `pry-able` object) is the bounded V2 version.

**Biggest architectural risk:** the purpose/dependency graph quietly becoming a *second
source of truth* — a shadow planner that runtime code consults instead of `WorldState`. The
mitigation is already modeled by ADR-0063: the graph must be a **generation-time artifact
only**; at runtime every gate/affordance re-derives its state from `WorldState` flags and
events. The second-order risk is vocabulary erosion: each "just one more effect kind" step
moves the closed vocabulary toward a scripting language. Every addition should require an
ADR.

**Strongest player-experience opportunity:** the combination of ideas 3 + 4 — blocked
actions that name what is missing, plus clue fragments that add up — turns a generated room
from "decorated container" into "a puzzle you can read." That is achievable with roughly the
same machinery the mechanical gate already uses, extended from exits to objects.

---

## 2. Paper-by-paper analysis

### 2.1 TextWorld [VERIFIED]

- **Citation:** Marc-Alexandre Côté, Ákos Kádár, Xingdi Yuan, Ben Kybartas, Tavian Barnes,
  Emery Fine, James Moore, Matthew Hausknecht, Layla El Asri, Mahmoud Adada, Wendy Tay,
  Adam Trischler. "TextWorld: A Learning Environment for Text-based Games." Computer Games
  Workshop (CGW 2018, IJCAI), Springer CCIS; arXiv:1806.11532.
  <https://arxiv.org/abs/1806.11532>
- **Research question:** How to generate and instrument text-based games with controllable
  difficulty so RL agents can be trained and evaluated.
- **Method/system:** A game-state representation in **linear logic**: world state is a set
  of typed facts (predicates over objects); actions are rules that consume and produce
  facts. Quests are generated by **forward chaining** from an initial state (guaranteeing a
  valid walkthrough exists) or backward from a goal. The engine can emit **admissible
  commands** (all actions valid in the current state) and intermediate rewards.
- **Strongest finding:** Solvability by construction. Because a quest *is* a chain of
  applicable actions, every generated game is completable, and the difficulty (chain length,
  branching, observability, vocabulary) is a tunable parameter rather than an emergent
  accident.
- **Limitations:** Generated quests are structurally formulaic ("fetch/open/place" chains);
  the prose is template-flat; the fact vocabulary is small and hand-designed. It optimizes
  for RL benchmarking, not player delight.
- **Transfers directly:** (a) closed predicate/action/effect vocabulary as the object model;
  (b) generate the dependency chain first, decorate with prose second; (c) admissible-action
  computation = your contextual-affordance list; (d) walkthrough-by-construction = your
  solvability guarantee.
- **Does not transfer:** linear-logic engine, Inform 7 backend, RL reward shaping, and its
  assumption that all world text is engine-produced (yours is LLM-produced and untrusted).
- **Concrete implementation idea:** implement `availableAffordances(object, worldState,
  inventory)` as a pure function (TextWorld's admissible commands, scoped to one object) and
  drive both the HUD verb chips and the validator from the same function.
- **Transfer confidence:** **High.** This is the closest formal ancestor of the proposed
  design.

### 2.2 ScienceWorld [VERIFIED]

- **Citation:** Ruoyao Wang, Peter Jansen, Marc-Alexandre Côté, Prithviraj Ammanabrolu.
  "ScienceWorld: Is your Agent Smarter than a 5th Grader?" EMNLP 2022, pp. 11279–11298.
  <https://aclanthology.org/2022.emnlp-main.775/>
- **Research question:** Can agents that answer science questions also *perform* science
  procedures in an interactive environment?
- **Method/system:** A text environment with ~30 tasks over 10 topics, backed by small
  deterministic **simulation engines** (thermodynamics, electricity, chemistry, biology).
  Objects have typed state that evolves under simulation rules; ~25 action verbs combine
  with objects into a very large action space. Compared RL agents (DRRN) with large offline
  language models.
- **Strongest finding:** Interactive grounding beats scale — a comparatively small RL agent
  interacting with the environment outperformed far larger LMs reasoning offline. Rich
  object *state* (temperature, conductivity, life stages) is what makes tasks meaningful
  rather than lexical.
- **Limitations:** Building even these small simulators was a large engineering effort; the
  action space explosion (~200k combinations) makes both agents and players flounder without
  guidance; no narrative layer at all.
- **Transfers directly:** the warning. Object state should be a **small closed enum set**
  (you already have condition + interactionState), not continuous simulation. Also
  transfers: failed actions return *informative* environment responses, which the paper's
  agents demonstrably needed.
- **Does not transfer:** continuous simulations, combinatorial verb×object action space —
  the brief's "no physics/crafting simulator" exclusion is empirically well-founded here.
- **Concrete implementation idea:** cap the per-object affordance count (e.g., ≤3) and make
  the validator enforce it, keeping the player-facing action space readable.
- **Transfer confidence:** **High** for the negative lesson; **medium** for specifics.

### 2.3 ALFWorld [VERIFIED]

- **Citation:** Mohit Shridhar, Xingdi Yuan, Marc-Alexandre Côté, Yonatan Bisk, Adam
  Trischler, Matthew Hausknecht. "ALFWorld: Aligning Text and Embodied Environments for
  Interactive Learning." ICLR 2021. <https://openreview.net/pdf?id=VpNENmFBEEg>,
  <https://alfworld.github.io/>
- **Research question:** Can policies learned in an abstract text world transfer to a
  grounded embodied environment?
- **Method/system:** Parallel aligned environments: each ALFRED household task exists both
  as a TextWorld game and a 3D THOR scene. The BUTLER agent learns high-level text policies
  ("take the mug", "heat it in the microwave") and executes them through a low-level
  controller.
- **Strongest finding:** Training in the abstract text space **generalizes better** than
  training in the visual space; a semantic action layer ("open fridge") decoupled from
  presentation is the right interface between reasoning and execution.
- **Limitations:** Hand-built alignment between the two layers; household-task domain;
  agent-centric (no notion of narrative or player experience).
- **Transfers directly:** the two-layer architecture *is* your architecture: LLM reasons in
  an abstract, validated action vocabulary; trusted code executes against the concrete
  world. It's independent evidence that keeping the LLM at the semantic-action level (not
  the pixel/mesh/state level) is the *more* capable design, not a compromise.
- **Does not transfer:** the learning machinery; the assumption that the abstract layer is
  auto-derivable from the concrete one.
- **Concrete implementation idea:** when free-text intent parsing arrives (V2), have the LLM
  output only `{action ∈ closed enum, targetObjectId ∈ room objects, toolItemId? ∈
  inventory}` — the exact "abstract action" ALFWorld's text layer uses — and fail closed on
  anything else.
- **Transfer confidence:** **High** for the layering principle.

### 2.4 Affordances in robotics [VERIFIED]

- **Citations:** Paola Ardón, Èric Pairet, Katrin S. Lohan, Subramanian Ramamoorthy, Ronald
  P. A. Petrick. "Affordances in Robotic Tasks — A Survey." arXiv:2004.07400 (2020)
  [PREPRINT — survey, widely cited]. <https://arxiv.org/abs/2004.07400>
  Daniel Beßler et al. "A Formal Model of Affordances for Flexible Robotic Task Execution."
  ECAI 2020 (IOS Press). <https://ebooks.iospress.nl/doi/10.3233/FAIA200374>
- **Research question:** How should machines represent "what can be done with this object"?
- **Method/system:** The survey's consensus formalization is the **triple (object, action,
  effect)** relative to an agent's capability; Beßler et al. formalize affordances as
  *dispositions* — latent object properties realized only in an event where both object and
  agent play the right roles, encoded in a description-logic ontology and validated by
  simulation.
- **Strongest finding:** Affordance is a **relation**, not an object property. "Openable"
  is not on the chest; it is between the chest (state: locked?), the agent (has key? has
  crowbar?), and the context. Models that bake affordances into object types generalize
  poorly.
- **Limitations:** Robotics evaluation criteria (grasping success etc.) are irrelevant here;
  ontology machinery is far heavier than needed.
- **Transfers directly:** the brief's "contextual affordances" idea #1 is exactly the
  dispositional model: compute available actions from object type × object state × inventory
  × world flags, at lookup time, never stored as a static list.
- **Does not transfer:** OWL ontologies, perception, physics validation.
- **Concrete implementation idea:** affordance *definitions* live in generated data;
  affordance *availability* is always computed by a pure function over `WorldState` — never
  cached in the room spec (mirrors ADR-0063's re-derivation rule).
- **Transfer confidence:** **High** for the relational principle; the formal machinery is
  explicitly *not* recommended.

### 2.5 Narrative Planning: Balancing Plot and Character [VERIFIED]

- **Citation:** Mark O. Riedl, R. Michael Young. "Narrative Planning: Balancing Plot and
  Character." Journal of Artificial Intelligence Research 39 (2010), 217–268. DOI
  10.1613/jair.2989. <https://jair.org/index.php/jair/article/view/10669>
- **Research question:** How to generate stories that are both causally sound and
  character-believable.
- **Method/system:** IPOCL, a partial-order causal-link planner extended with **intention
  frames**: every character action must be justified both by plot causality (its effects are
  needed downstream) and by a character goal. Evaluated with a user study on perceived
  believability.
- **Strongest finding:** Causal soundness alone is not enough — audiences notice when events
  happen "because the plot needed them." Dual justification (causal + motivational)
  measurably improves believability.
- **Limitations:** Full planning is expensive and brittle at scale; domains are
  hand-authored STRIPS; offline story generation, not interactive play.
- **Transfers directly:** the brief's idea #6 in its exact form — objects should exist
  because a causal chain needs them (the causal-link half of IPOCL). The intention half
  transfers as a *lightweight* rule: every clue/object should be attributable to an
  in-fiction actor or event ("who left this here and why"), which is one enum field, not a
  planner.
- **Does not transfer:** running a POCL planner at generation time. The dependency chains
  here are 2–4 steps; a planner is overkill (see §8 — the LLM proposes the chain, the
  validator checks it, which is the generate-and-test shortcut).
- **Concrete implementation idea:** add `originHint` (closed enum: `left-by-faction`,
  `dropped-in-flight`, `ritual-remnant`, `decay`, …) to clue-bearing objects so narration
  can answer "why does this exist" consistently.
- **Transfer confidence:** **High** for the principle, **low** for the mechanism.

### 2.6 ClueCart [VERIFIED]

- **Citation:** Xiyuan Wang, Yi-Fan Cao, Junjie Xiong, Sizhe Chen, Wenxuan Li, Junjie
  Zhang, Quan Li. "ClueCart: Supporting Game Story Interpretation and Narrative Inference
  from Fragmented Clues." CHI 2025. DOI 10.1145/3706598.3713381; arXiv:2503.06098.
  <https://dl.acm.org/doi/10.1145/3706598.3713381>
- **Research question:** How to support people reconstructing a game's story from fragmented
  ("indexical") clues.
- **Method/system:** Formative study (literature review, app survey, co-design workshop with
  14 experienced game-narrative interpreters) → a hierarchical **clue taxonomy** → the
  ClueCart tool for organizing/retrieving clues → between-subjects evaluation (N=40) against
  Miro.
- **Strongest finding:** Fragmented-clue interpretation is a real, effortful activity that
  players *want* to do, and it collapses without organizational support: interpreters need
  categorization, source-tracking, and spatial/relational arrangement (timelines, character
  relations, thematic clusters) to sustain inference.
- **Limitations:** Studies *creators/interpreters* working outside the game, not players
  in-game; N=40 tool-usability evidence, not game-design evidence; taxonomy details require
  the full paper (I verified the paper, not the full taxonomy contents — flag if the
  taxonomy is to be adopted verbatim).
- **Transfers directly:** clue records need `category`, `sourceObjectId`, and cluster
  membership *at minimum*, or downstream comprehension tooling (journal) has nothing to
  organize by. Also: player-side interpretation support (journal grouping by cluster) is
  where the value is — not machine inference.
- **Does not transfer:** the authoring-tool UI; free-form spatial canvases.
- **Concrete implementation idea:** the consequence journal groups revealed clues by
  `clusterId` with the cluster's title once ≥2 members are found ("The burned caravan —
  2 of 4 traces found") — organizational support with zero new authority.
- **Transfer confidence:** **Medium-high** (adjacent activity, same cognitive task).

### 2.7 "That Darned Sandstorm" [VERIFIED]

- **Citation:** Florence Smith Nicholls, Michael Cook. "'That Darned Sandstorm': A Study of
  Procedural Generation through Archaeological Storytelling." FDG 2023. DOI
  10.1145/3582437.3587207; arXiv:2304.08293. <https://dl.acm.org/doi/10.1145/3582437.3587207>
- **Research question:** How do players archaeologically interpret procedurally generated
  environments?
- **Method/system:** *Nothing Beside Remains*, a generated ruined village where the only
  mechanic is walking to objects and reading short descriptions; survey of 187 players about
  what they believed happened there.
- **Strongest finding:** Players **spontaneously construct causal narratives from
  arrangements of inert objects** — including from an unintended glitch (the boundary-lock
  "sandstorm"), which many players folded into their story of the village. Interpretation is
  cheap to trigger and does not require deep mechanics.
- **Limitations:** Single game, no ground truth to compare interpretations against, no
  progression/objectives — it cannot tell you whether players' stories were *right*, only
  that they were produced.
- **Transfers directly:** (a) evidence *placement and co-occurrence* does narrative work
  before any interaction system exists — your visual pack already carries this; (b) the
  warning: players will confabulate from noise (apophenia). If room comprehension is a
  product goal (your evaluation metric "player can explain what happened"), fragments must
  be *anchored* to authoritative facts and redundantly discoverable, or players will
  confidently believe wrong things.
- **Does not transfer:** "no aim except explore" — your rooms have objectives.
- **Concrete implementation idea:** the validator requires each clue cluster to have ≥1
  redundant member (event implied by k of n fragments, n > k), so a missed object doesn't
  silently produce a wrong story.
- **Transfer confidence:** **High** for the design lesson.

### 2.8 Tachikuma [PREPRINT]

- **Citation:** Yuanzhi Liang, Linchao Zhu, Yi Yang. "Tachikuma: Understading Complex
  Interactions with Multi-Character and Novel Objects by Large Language Models."
  arXiv:2307.12573 (July 2023). Preprint only; the title's "Understading" typo is in the
  official record. No peer-reviewed venue found. <https://arxiv.org/abs/2307.12573>
- **Research question:** Can LLMs understand multi-character interactions with novel
  objects the way a TRPG Game Master does?
- **Method/system:** The MOE task (Multiple character and novel Object based interaction
  Estimation) built from real TRPG play logs; a GM-inspired prompting baseline in which the
  model tracks information, estimates intentions, and gives feedback.
- **Strongest finding (as claimed):** GM-style structured oversight prompting improves
  interaction understanding versus naive prompting. The durable insight is the framing:
  a GM's job decomposes into *intent estimation → ruling against world state → narrated
  feedback*, which maps 1:1 onto your `intent → validation → reducer → narration` pipeline.
- **Limitations:** Preprint, self-described preliminary, evaluation thin; claims should not
  be load-bearing.
- **Transfers directly:** the decomposition of the GM role — use the LLM only for the
  intent-estimation and narration ends, never the ruling middle.
- **Does not transfer:** any capability claim about LLM ruling accuracy; benchmark itself.
- **Concrete implementation idea:** none beyond the pipeline framing (already planned).
- **Transfer confidence:** **Low-medium**; treat as supporting color, not evidence.

### 2.9 From World-Gen to Quest-Line [PREPRINT — very recent]

- **Citation:** Dominik Borawski, Marta Szulc, Robert Chudy, Małgorzata Giedrowicz, Piotr
  Mironowicz (Gdańsk University of Technology). "From World-Gen to Quest-Line: A
  Dependency-Driven Prompt Pipeline for Coherent RPG Generation." arXiv:2604.25482
  (April 2026). Unreviewed; treat all claims cautiously. <https://arxiv.org/abs/2604.25482>
- **Research question:** Does staging LLM generation through dependency-ordered prompts with
  structured intermediate JSON improve RPG content coherence?
- **Method/system:** Five sequential stages (world → NPCs → player character →
  campaign-level quest plan → quest expansion), each conditioning on schema-enforced JSON
  from earlier stages. Evaluated by human analysis across independent runs on structural
  completeness, consistency, coherence, diversity, actionability.
- **Strongest finding (as claimed):** Schema-enforced staged prompting reduces narrative
  drift and hallucination, and separating campaign planning from quest expansion improves
  both global structure and local storytelling, without degradation as complexity grows.
- **Limitations:** Human-centered evaluation only, no automated solvability checking, no
  playable runtime, no player study; very recent preprint.
- **Transfers directly:** direct support for the brief's pipeline idea #6/§8: **generate the
  dependency skeleton before the content, one bounded prompt per stage, structured JSON
  between stages** — which is also how your world-bible → room → objective providers already
  work.
- **Does not transfer:** their stages (campaign/PC creation) don't match your unit of work
  (a room/quest slice); and unlike them you *can* validate automatically — do it.
- **Concrete implementation idea:** make the dependency sketch its own small provider call
  with its own zod schema, separate from room-object generation, so prompt size stays
  bounded and the validator sits between the two calls.
- **Transfer confidence:** **Medium** (mechanism plausible and matches your own ADR-0050/0057
  experience; evidence weak).

### 2.10 Additional sources (verified during search)

**Kybartas & Bidarra, "A Survey on Story Generation Techniques for Authoring Computational
Narratives," IEEE TCIAIG 9(3):239–253, 2017.** [VERIFIED]
Frames all story generation on two axes — plot automation vs. space automation — and finds
most systems automate one while hand-authoring the other. Transfer: you are automating
*space* (rooms/objects); keep plot structure (objective→clue chains) template-shaped and
validated rather than fully generative. Confidence: high.

**Doran & Parberry, "A prototype quest generator based on a structural analysis of quests
from four MMORPGs," PCG Workshop (FDG) 2011.** [VERIFIED]
Analyzed 3,000 quests from four MMORPGs: player-facing quests reduce to a small grammar of
action primitives (~20 verbs) composed into trees; preorder traversal of the tree is the
quest walkthrough. Transfer: strong empirical support that a **closed action vocabulary of
~10–20 verbs covers real RPG quests** — your proposed 15-action list is the right order of
magnitude. Limitation: generated quests are structurally sound but generic; prose must come
from elsewhere (in your case the LLM). Confidence: high.

**Joris Dormans — mission/space grammars and cyclic generation.** [VERIFIED for the
industry practice; academic paper "Adventures in Level Design" (PCG Workshop 2010) known
and widely cited but not re-fetched here — flag as high-confidence secondary.]
Generates a **mission graph** (locks, keys, valves, secrets) first via graph grammar, then
maps it onto space; *Unexplored*'s cyclic generation replaces linear chains with loops
(lock+key cycle, hidden shortcut cycle, danger/reward cycle) for stronger pacing.
(<https://www.boristhebrave.com/2021/04/10/dungeon-generation-in-unexplored/>,
<https://www.gamedeveloper.com/design/unexplored-s-secret-cyclic-dungeon-generation->)
Transfer: mission-before-space = purpose-graph-before-objects; cycle *patterns* (e.g., "you
see the locked gate before you find the crank") are cheap, high-value templates for the
dependency sketch provider. Confidence: high.

**Ron Gilbert — Puzzle Dependency Charts.** [INDUSTRY]
(<https://grumpygamer.com/puzzle_dependency_charts/>) Adventure-game dependency DAGs,
designed *backwards* from goals; healthy charts show diamond shapes (fan-out then
reconverge); dead-ends and cycles are authoring bugs caught on the chart, not in playtest.
Transfer: the exact mental model for the room-scale purpose graph and its "no cycles, no
orphan rewards, diamonds not chains" health checks. Confidence: high (decades of practice).

**Smith & Worch, "What Happened Here? Environmental Storytelling," GDC 2010.** [INDUSTRY]
(<https://gdcvault.com/play/1012647/What-Happened-Here-Environmental>) Game spaces read as
history when props imply *events*; meaning arises from player inference over arrangement;
"it has to be possible to miss some things to make finding them meaningful" (Smith).
Transfer: clue clusters should be spatial arrangements, not just object attributes; partial
discoverability is a feature the validator should permit (optional cluster members) while
guaranteeing the required core. Confidence: high as craft knowledge.

**Ammanabrolu et al., "Toward Automated Quest Generation in Text-Adventure Games," CCNLG
2019 (arXiv:1909.06283); "Bringing Stories Alive," AIIDE 2020.** [VERIFIED]
Quest = action sequence grounded in a knowledge graph of the world; grounding generation in
an explicit graph is what keeps quests semantically coherent (a knight's quest shouldn't
require a microwave). Transfer: your world-bible seed + room theme vocabulary is that
grounding graph in miniature; the dependency sketch prompt should receive *only* validated
room/theme entities as candidate anchors. Confidence: high.

**Smith & Mateas, "Answer Set Programming for Procedural Content Generation: A Design Space
Approach," IEEE TCIAIG 2011.** [VERIFIED]
Declares the design space as logical constraints; a solver emits only artifacts satisfying
them — generate-and-test unified. Transfer: the *principle* (explicit constraints, reject
invalid artifacts) without the machinery: your zod schemas + semantic validator + the
proposed graph validator are the low-tech equivalent. Do **not** add an ASP solver.
Confidence: high for principle.

**Zhu, Martin, Head, Callison-Burch, "CALYPSO: LLMs as Dungeon Masters' Assistants," AIIDE
2023 (arXiv:2308.07540).** [VERIFIED]
Formative study + real deployment with D&D DMs. Finding: DMs want LLMs for *low-stakes
synthesis and inspiration* (describing scenes, brainstorming) while retaining authority over
rules and truth themselves — human DMs independently arrived at your architecture
(LLM narrates, trusted authority rules). Transfer: validating evidence for
narration-as-non-authoritative-decoration. Confidence: high.

**Leandro, Rao, Xu, Xu, Jojic, Brockett, Dolan, "GENEVA: GENErating and Visualizing
branching narratives using LLMs," Microsoft Research; arXiv:2311.09213 (presented at IEEE
CoG per MSR).** [VERIFIED, venue medium-confidence]
GPT-4 generates branching/reconverging narrative DAGs from constraints in a two-step
process (generate narrative → render graph). Limitation relevant to you: the nodes are prose
beats with **no playability semantics and no automated validation** — it demonstrates LLMs
can propose graph *structure*, and equally that structure without validation is decorative.
Confidence: high.

**Kreminski et al. — story sifting (Felt, Winnow) and the "Cozy Mystery Construction Kit"
prototypes.** [VERIFIED existence; venue details medium-confidence]
(<https://mkremins.github.io/>) Sifting = running declarative patterns over an **event log**
to find storyful sequences retrospectively. Transfer: your append-only event log is exactly
siftable; a deterministic "recap what happened in this room" journal projector is a
micro-sifter. Confidence: medium-high.

**Outer Wilds — knowledge-based progression / ship-log rumor graph.** [INDUSTRY]
(<https://outerwilds.ventures/> and the shipped game's design) The only progression currency
is *information*; the ship log is a curated graph of discovered facts and rumor edges,
grouped by location, with "there's more here" indicators. Widely regarded as the strongest
existing implementation of clue-graph play. Transfer: (a) discovered-clue tracking with
cluster grouping and a more-to-find indicator delivers hypothesis-like play without modeling
hypotheses; (b) clue reveals must be idempotent (the log never duplicates); (c) the game
never *tells* the player conclusions — conclusions live in the player's head, confirmed only
by acting on them. Confidence: high as design precedent (no formal talk verified — analysis
based on the shipped system).

**"Deciphering Digital Detectives" (arXiv:2312.00746)** [PREPRINT] — LLM agents in
multi-agent jubensha (murder-mystery) games; relevant only as further evidence that LLMs
leak/confuse hidden information without hard information partitioning. Not load-bearing.

---

## 3. Cross-paper synthesis

How the sources model each concern, and where they agree/disagree:

- **World state.** Consensus: a discrete set of typed facts/flags (TextWorld's linear-logic
  facts, ScienceWorld's object properties, Dormans' graph node states, your
  `roomStates[roomId].flags`). Disagreement: ScienceWorld adds continuous simulation and
  pays heavily for it. **Principle: closed discrete state wins at this scale.**
- **Objects.** Consensus: an object = identity + type + mutable state + relations. Nobody
  successful models objects as prose. That Darned Sandstorm shows prose/arrangement alone
  produces *interpretation* but not *gameplay*.
- **Affordances/actions.** Consensus across robotics, TextWorld, and Doran & Parberry: a
  small closed verb set (10–25), with availability computed relationally from object state +
  agent capability. Disagreement: none of substance — this is the strongest cross-domain
  agreement in the whole review.
- **Preconditions/effects.** Consensus: STRIPS-shaped (facts consumed/required → facts
  produced). Planners (IPOCL) and generators (TextWorld) differ in *when* they use them
  (search vs. construction), but the data model is identical.
- **Observations.** TextWorld/ScienceWorld/ALFWorld: observations are computed from state on
  demand and can be partial. Your equivalent: narration and HUD text are projections;
  `fact_visibility` already implements partial observability. Nobody stores observations as
  truth.
- **Rewards.** TextWorld: rewards attached to quest-graph milestones, granted once.
  ScienceWorld: task scoring functions. Industry (Gilbert): a puzzle solved is solved.
  **Idempotency by construction (state transition grants, and transitions happen once) is
  universal.**
- **Goals.** All systems make goals graph-reachable states, not text. Riedl & Young add:
  goals should be *motivated*, not just reachable.
- **Clues.** Only ClueCart, Outer Wilds, and the mystery-design line treat clues as
  first-class; they agree clues are *pointers to facts plus provenance*, and that the
  player, not the system, does the inference. ClueCart adds: without organizational support,
  fragmented clues overwhelm.
- **Causal dependencies.** Gilbert/Dormans/TextWorld: dependencies are the *generated
  artifact* (chart, mission graph, quest chain). Riedl & Young: dependencies are *searched
  for*. GENEVA/World-Gen-to-Quest-Line: dependencies are *proposed by an LLM*. The emerging
  hybrid — LLM proposes, deterministic code validates — is exactly your pattern and the
  strongest available synthesis.
- **Partial information.** TextWorld treats partial observability as a difficulty *dial*;
  Smith & Worch treat missability as *meaning*. Both agree it must be a controlled quantity
  — hence validator rules about required vs. optional discoverability.
- **Failure.** TextWorld/ScienceWorld: invalid actions produce informative, state-derived
  messages and no state change. Adventure-game craft: a good failure names the missing
  dependency. Nobody rewards failure with state mutation. (Your idea #9 "informative
  failure" is universally supported, with the boundary: failure may reveal *information*,
  never grant *progress state* other than marking the information revealed.)
- **Solvability.** Three schools: by construction (TextWorld, Dormans), by constraint solver
  (Smith & Mateas), by post-hoc validation/repair (your ADR-0007/0020 lineage, and the only
  option when an LLM proposes content). All three converge on: **never ship an unchecked
  graph.**
- **Narrative coherence.** Riedl & Young: coherence = causal + intentional justification.
  Ammanabrolu: coherence = grounding in a world graph. Kybartas & Bidarra: coherence risks
  rise with the degree of automation. Practical synthesis: keep the *structure* templated
  and validated, spend the LLM budget on *surface* coherence (names, prose, theming).

**Recurring principles:** (1) structure first, prose second; (2) closed vocabularies
everywhere; (3) availability computed, never stored; (4) validate before playable; (5) the
authoritative layer is boring and deterministic; (6) player inference is the fun — protect
it with redundancy and organization, don't automate it away.

**Genuine disagreement worth tracking:** how much *planning* intelligence is needed. The
planning school (Riedl & Young) says search for globally coherent causal structure; the
template school (Doran & Parberry, Dormans) says small grammars suffice and players don't
notice the difference at quest scale. For 2–4 step room chains, the template school's
evidence is more applicable. Revisit only if multi-room story arcs (V2+) feel mechanical.

---

## 4. New feature ideas (not already in the brief)

Ordered by value-to-complexity. Effect/action names refer to §5's vocabulary.

**4.1 Clue cluster progress indicator ("2 of 4 traces")** — V1.5
- *Player experience:* the journal shows "The burned caravan — 2 of 4 traces found," making
  investigation legible and pulling the player back to under-searched rooms (Outer Wilds'
  "more to explore here").
- *Example:* player inspects the burned cart and the palace token; journal creates the
  cluster entry with a progress count; finding the barricade and ledger completes it and
  appends a closed conclusion line.
- *Data:* `clusterId`, cluster title, member clue ids (generation-time data); revealed-clue
  events (already needed for clues generally).
- *Runtime:* pure projection over revealed-clue events; no new commands.
- *LLM role:* proposes cluster title/member texts at generation time only.
- *Deterministic role:* counting, grouping, completion detection, conclusion line selection.
- *Persistence:* clue reveals are events; clusters ride the generated quest sidecar.
- *Risks:* leaking the existence of undiscovered content (mitigate: show count only after ≥1
  member found). Security: none (read-only projection).
- *Complexity:* small. Highest value/cost ratio of the new ideas.

**4.2 Search-with-closure (`search` yields, then permanently reads as searched)** — V1
- *Player experience:* searching a container/remains gives its content once; afterwards the
  object reads "already searched" — eliminating the repeated-generic-message problem the
  brief complains about, and making object state visible history.
- *Data:* `interactionState: looted/read` transitions (already exist as closed states).
- *Runtime:* affordance availability excludes `search` when state is `looted`; inspect body
  swaps to a "searched" variant (closed template).
- *LLM/deterministic split:* all deterministic.
- *Persistence:* the state transition is already persisted via flags/events.
- *Risks:* none new. *Complexity:* trivial — mostly a presentation rule over Slice B.

**4.3 Deterministic room recap on exit ("story sifting lite")** — V2
- *Player experience:* leaving a room appends one journal paragraph recapping validated
  events ("You forced the vestry gate after finding the sexton's crank; the ledger's missing
  pages point to the palace."), reinforcing comprehension (your metric #7).
- *Data/runtime:* pure projector over this room's slice of the event log (Kreminski-style
  micro-sifter); optional LLM *rewording* of the assembled recap, display-only.
- *Risks:* if LLM rewording is used, it must remain display-text-only (existing
  sanitization path). *Complexity:* small-medium.
- *Why not V1:* journal candidates per event already cover the essentials.

**4.4 Blocked-affordance objective hooks ("the socket is empty" becomes trackable)** — V1.5
- *Player experience:* when a blocked action's failure names a missing item/condition, the
  game offers a lightweight journal note ("Find something to fit the square socket") —
  failed actions *produce* direction, the brief's idea #2 made persistent.
- *Data:* failure observation template id + optional `hintFlag` on the affordance.
- *Runtime:* reducer sets `hint:<gateId>` flag (idempotent); journal projects it.
- *LLM role:* none at runtime. *Risks:* hint spam (cap one hint per gate).
- *Complexity:* small, but depends on Slices B–D.

**4.5 Tag-based tool matching (bounded creativity without free text)** — V2
- *Player experience:* any `prying` item (iron bar, chisel) force-opens a `pry-able`
  barricade; the game acknowledges the specific item used. Players feel clever inside a
  validated lattice.
- *Data:* closed item-tag enum (`prying`, `cutting`, `burning-source`, `cranking`); tags on
  items and on affordance preconditions (`has-item-tag: prying`).
- *Runtime:* precondition check by tag instead of id; effect unchanged.
- *LLM role:* assigns tags at generation time from the closed enum (validated).
- *Risks:* tag inflation → mini-crafting-system; hold the enum to ~6 and require ADR per
  addition. *Complexity:* small mechanically, medium in vocabulary discipline.

**4.6 Evidence decay via world clock** — later
- Unvisited-room evidence degrades on lazy transition (weathered → overgrown), removing
  optional clues but never required ones (validator invariant). Atmospheric, reinforces the
  living world; real risk of frustrating investigators and of validator complexity.
  Defer until clue play is proven fun. *Complexity:* medium.

**4.7 NPC clue reactions (show-clue-as-dialogue-topic)** — V2
- *Player experience:* a discovered clue unlocks one closed question per relevant NPC
  ("Ask about the palace token"); the NPC's answer respects their knowledge boundaries
  (facts visible to them), possibly lying per relationship state.
- *Data:* `unlocksTopicId` on clue; topic → NPC mapping in generated quest data.
- *Runtime:* dialogue context builder already consumes room/objective context; add revealed
  clue-topic ids (read-only). *LLM role:* NPC reply prose only, existing provider path.
- *Risks:* knowledge leakage — the topic list given to the provider must be filtered by
  `fact_visibility` for that NPC. *Complexity:* medium; high narrative payoff.

**4.8 Red-herring budget** — V2/later
- Generator may mark ≤1 object per room `decoy: true` (plausible but pointing at a wrong
  cluster); validator enforces the budget and that decoys are never required. Real mysteries
  need noise, but only after players demonstrably master signal. *Complexity:* small
  mechanically, risky for comprehension metrics — gate on playtest data.

---

## 5. Recommended object model

Smallest robust contract, staying inside existing schema philosophy (zod, closed enums,
data-only). Names are illustrative.

```ts
// Generation-time data, rides the generated room/quest sidecar (like the gate proposal).
// NEVER consulted as runtime truth; runtime state lives in WorldState flags/events.

type ObjectPurpose = {
  objectId: string
  category: 'clue-bearing' | 'container' | 'lore' | 'mechanism'
          | 'blocker' | 'resource' | 'decorative'         // closed
  narrativeDependency?: { objectiveId: string; role: 'required' | 'optional' }
  originHint?: OriginHint                                  // closed enum, see §2.5
  affordances: ObjectAffordance[]                          // max 3, validator-enforced
}

type ObjectAffordance = {
  id: string                                               // idempotency key
  action: AffordanceAction                                 // closed, below
  preconditions: Precondition[]
  effects: AffordanceEffect[]                              // applied atomically
  observationKey: string                                   // closed template id for success
  failure?: { observationKey: string; hintFlag?: string }  // informative failure (§4.4)
  repeat: 'once' | 'per-state' | 'always'
  // 'once'      — effects apply a single time ever (event-log guarded)
  // 'per-state' — available again only if preconditions re-become true after a state change
  // 'always'    — observation-only affordances (inspect); zero effects allowed except
  //               first-time reveal effects, which remain 'once' internally
}

type Precondition =
  | { kind: 'room-flag'; roomId: string; flag: string; value: boolean }   // EXISTS (gate)
  | { kind: 'has-item'; itemId: string; quantity?: number }
  | { kind: 'object-state'; objectId: string; state: InteractionState }   // closed enum
  | { kind: 'objective-stage'; objectiveId: string; atLeast: number }
  // unknown kind => affordance unavailable (fail closed)

type AffordanceEffect =
  | { kind: 'set-interaction-state'; objectId: string; state: InteractionState }
  | { kind: 'set-room-flag'; flag: string; value: boolean }               // EXISTS (inspect flag)
  | { kind: 'add-item'; item: InventoryItem }                             // EXISTS (take-item)
  | { kind: 'remove-item'; itemId: string; quantity: number }             // EXISTS (use-item)
  | { kind: 'reveal-clue'; clueId: string }                               // idempotent by id
  | { kind: 'progress-objective'; objectiveId: string; toStage: number }  // monotonic only
  | { kind: 'unlock-exit'; exitId: string }                               // EXISTS (gate)
  | { kind: 'journal-candidate'; templateId: string }                     // closed templates
  // unknown kind => whole proposal rejected at validation (fail closed)
```

**Closed actions — recommendation for the brief's list of 15:**

| Action | Verdict | Reason |
| --- | --- | --- |
| `inspect` | **V1** | exists; becomes `always` + first-reveal effects |
| `read` | **V1** | exists as prompt; now may `reveal-clue` |
| `search` | **V1** | the container/remains verb; pairs with `looted` state |
| `open` | **V1** | closed→open transition; containers |
| `take` | **V1** | exists (`take-item`) |
| `use` | **V1** | exists (`use-item`); covers unlock-with-key via `has-item` precondition |
| `force-open` | **V1.5** | `use` variant with tool/strength flavor; wait for tags (§4.5) |
| `unlock` | **V1.5** | presentation alias of `use` with key item — add as label, not new semantics |
| `activate` / `deactivate` | **V1.5** | mechanisms slice (D); maps to flag set + state |
| `clear` | **V1.5** | barricades/vegetation; slice D |
| `repair` | **V2** | needs item sinks; defer |
| `move` | **V2** | reveals hidden objects; needs `reveal-object` effect — defer |
| `compare` | **Reject as action** | it's journal/UI work over revealed clues, not a world action |
| `reveal` | **Reject as action** | it's an *effect* (`reveal-clue`), not something a player does |

**Effects:** V1 = the eight listed above minus `remove-item` risk cases (V1 rule: key items
are *not consumed*, eliminating the softlock class entirely — see §6). Defer:
`establish candidate fact` (V1.5, once clue→fact wiring is proven), `unlock dialogue topic`
(V2, §4.7), `emit noise/alert marker` (later; no consumer system exists),
`reveal another object` (V2 with `move`).

Idempotency mechanics [INFERENCE, follows existing event-log design]: reducers guard each
`once` affordance by checking the event log/projection for `affordance-applied` with the
same `(roomId, objectId, affordanceId)`; `reveal-clue` and `progress-objective` are
additionally idempotent by their own ids (set-union / monotonic max), so double-application
is harmless even if a guard is missed. Rewards can never be granted twice because `add-item`
from a `once` affordance is gated by the same guard.

---

## 6. Purpose/dependency graph

**Data model** (generation-time only, pure TypeScript, no graph DB):

```ts
type PurposeGraph = {
  nodes: PurposeNode[]
  edges: { from: NodeId; to: NodeId; kind: 'requires' | 'provides' }[]
}
type PurposeNode =
  | { id; kind: 'objective-stage'; objectiveId: string; stage: number }
  | { id; kind: 'clue'; clueId: string }
  | { id; kind: 'item'; itemId: string }
  | { id; kind: 'flag'; flag: string }
  | { id; kind: 'affordance'; objectId: string; affordanceId: string }
  | { id; kind: 'exit'; exitId: string }
  | { id; kind: 'dialogue-topic'; topicId: string }        // V2
```

An affordance node *requires* its precondition nodes and *provides* its effect nodes. The
graph is assembled deterministically from `ObjectPurpose[]` — the LLM never emits edges
directly; edges fall out of preconditions/effects, which keeps the graph honest.

**Validator (fixpoint reachability — the same idea as TextWorld's forward chaining and a
generalization of the existing gate satisfiability check):**

```text
function validatePurposeGraph(graph, initial):
  # initial = flags true at room entry, starting inventory, objects present, stage 0
  available ← initial
  fired ← ∅
  repeat:
    progress ← false
    for each affordance node a not in fired:
      if requires(a) ⊆ available:
        fired ← fired ∪ {a}
        available ← available ∪ provides(a)
        progress ← true
  until not progress

  problems ← []
  # 1. unreachable required content
  for each node n with kind clue|item|flag|exit required by any required objective-stage:
    if n ∉ available: problems += UNREACHABLE(n)
  # 2. impossible objective completion
  for each required objective-stage s:
    if s ∉ available: problems += OBJECTIVE_INCOMPLETABLE(s)
  # 3. cycles (distinguish from plain missing providers)
  for each SCC of size > 1 in the requires/provides digraph
      containing an unfired affordance: problems += CYCLE(scc)
  # 4. duplicate rewards
  for each item/clue node p:
    if count(affordances providing p with repeat ≠ 'once') > 0
       or count(providers of p) > 1: problems += DUPLICATE_REWARD(p)
  # 5. softlocks via consumption (V1: vacuous — keys are not consumed)
  for each consumable item i:
    if count(consumers of i on required paths) > count(providers of i):
      problems += CONSUMPTION_SOFTLOCK(i)
  # 6. required content behind optional failure / optional content
  for each required node n:
    if every provider path of n passes through a node marked optional
       or through a 'failure-only' hint edge: problems += REQUIRED_BEHIND_OPTIONAL(n)
  # 7. conflicting state transitions
  for each object o:
    if two 'once' affordances set the same object-state/flag to different values
       and both are reachable with no ordering edge: problems += STATE_CONFLICT(o)
  # 8. meaningfulness floor
  for each object with category ≠ 'decorative':
    if it has no affordance with ≥1 effect: problems += PURPOSELESS_OBJECT(o)

  return problems   # data, not exceptions — matches existing validator style
```

The brief's example (crank in chest, chest opens after machine, machine needs crank) is
caught twice: the fixpoint never fires any of the three affordances (UNREACHABLE ×3) and the
SCC check names the cycle explicitly for repair.

Complexity is trivially bounded: a room has tens of nodes; the fixpoint is O(N²) worst case
on tiny N. Room-scoped graphs only in V1; cross-room chains (V2+) validate over the quest's
room set at generation time, with the same code.

**How each failure class maps** — unreachable clues → check 1; missing required items →
check 1 (item node has no provider so never `available`); cycles → check 3; softlocks →
checks 5 and 7 (plus the V1 no-consumable-keys rule making class 5 empty by construction);
duplicate rewards → check 4; conflicting transitions → check 7; required-behind-optional →
check 6; impossible objectives → check 2.

---

## 7. Fragmented clue and hypothesis design

**Recommendation: implement the clue layer; do not implement the hypothesis layer (V1–V2).**

Implement (Slice C/F):

```ts
type ClueSpec = {
  id: string
  category: 'trace' | 'document' | 'testimony' | 'object-evidence' | 'absence'  // closed
  sourceObjectId: string
  supportsFactId?: string          // existing facts table
  contradictsFactId?: string
  importance: 'required' | 'supporting' | 'flavor'
  reliability: 'firm' | 'circumstantial'   // presentation-only in V1
  clusterId?: string
}
```

- **Clue *content* is generated data** (rides the generated-quest sidecar, like gate
  proposals). **Clue *discovery* is authoritative**: a `clue-revealed { clueId }` event,
  idempotent by id. This split keeps clues non-authoritative about the *world* while making
  the player's discovery history real, replayable, and save/load-safe.
- **Integration with facts/fact_visibility:** a clue never *creates* a fact. `supportsFactId`
  points at an existing (possibly hidden) fact; revealing enough `required` clues of a
  cluster may flip that fact's *visibility to the player* — a visibility change, not a truth
  change, so the existing firewall holds. NPC dialogue context may include revealed-clue
  topics only after filtering by that NPC's fact visibility (knowledge boundaries).
- **Clusters** (Slice F): id + title + member ids + `minimumForConclusion`; completion emits
  a deterministic journal conclusion line. This is Outer Wilds' rumor-grouping and ClueCart's
  organizational support, without machine inference.
- **Skip in V1–V2:** player hypothesis records, confidence scores, confirmed/disproved
  bookkeeping. Rationale: (a) the strongest shipped precedent (Outer Wilds) deliberately
  leaves hypotheses in the player's head; (b) ClueCart shows interpretation support is about
  *organization*, which clusters already give; (c) a hypothesis store is a new authored
  UI + persistence + firewall surface with no evidence of proportional payoff. Revisit as
  Slice G *only* if playtests show players cannot retain the thread across sessions —
  and then start as a free-text player note pinned to a cluster (inert text, zero authority),
  not a modeled belief system.

---

## 8. LLM generation pipeline

Dependency-aware pipeline (extends the existing world-bible → room → objective chain;
staging evidence: World-Gen-to-Quest-Line [PREPRINT], GENEVA, and your own ADR-0050/0057
experience):

```
world/room conflict            (existing world-bible seed + theme vocabulary)
  → room objective             (existing objective provider — REUSE)
  → required outcome + dependency sketch     [LLM CALL A — new, small]
  → meaningful objects + prose               [LLM CALL B — existing room/object generation, enriched]
  → deterministic graph assembly             (pure)
  → validator (§6)                           (pure)
  → deterministic repair                     (pure)
  → assembleRoom stages → validateRoom       (existing)
  → renderer/runtime                         (existing)
```

- **LLM steps:** Call A proposes, as schema-validated JSON only: the required outcome, 1–2
  chain *patterns* chosen from a closed template set (see below), clue cluster texts, and
  which object *slots* carry which purpose. Call B is the existing room generation with
  purpose slots attached to concrete objects (names/prose). Both calls are bounded because
  they receive only: theme enums, objective id/kind, the closed vocabularies, and slot
  counts — never prior raw text (matches existing no-raw-replay rule).
- **Deterministic steps:** everything else. Template patterns are the Dormans/Gilbert
  insight made cheap — a closed library like `key-behind-clue`, `two-fragment-evidence`,
  `blocked-exit-with-tool`, `lore-chain`, each a parameterized mini-graph with known-valid
  shape. The LLM *selects and skins* patterns; it does not freeform graph topology. This
  single decision removes most repair complexity.
- **Data reuse:** object slots map onto the existing visual vocabulary types (document/
  container/remains/mechanism/barricade...) so renderer mappings stay independent of purpose
  (existing constraint). The gate proposal path (ADR-0064) is the wiring precedent: proposal
  → transient sidecar → deterministic derivation → frozen contract check.
- **Repair ladder (deterministic, in order):** (1) drop `optional` nodes that are
  unreachable; (2) re-anchor a required provider onto an existing unpurposed object of a
  compatible type; (3) synthesize the missing provider from the pattern's default (e.g.,
  the crank lies beside the machine); (4) downgrade the chain: gate becomes unlocked,
  chain becomes plain clue reveals; (5) full fallback — room ships with today's v0
  inspect-only behavior. Every rung fails *closed and playable*; count-only diagnostics
  (`purposeRepairsApplied`, `purposeFallback`) per logging rules.
- **Safe fallback behavior:** provider unavailable / invalid JSON / budget exceeded ⇒ rung 5
  directly. No multi-attempt LLM repair loop (explicit guardrail in AGENTS.md).

---

## 9. Runtime interaction pipeline

```
player input
  (V1: affordance selection from HUD chips — no free text, no LLM)
  (V2: optional free text → LLM intent proposal {action, targetObjectId, toolItemId}
       — schema-validated; ids must resolve against current room/inventory; else fail closed
       with a closed "you can't see how" observation)
→ target resolution            (existing interactable id path from renderer intent callback)
→ affordance lookup            availableAffordances(object, worldState, inventory) — pure
→ precondition check           evaluateCondition extension — pure, fail closed on unknown
→ deterministic reducer        interactions planner maps effects → existing WorldCommands;
                               atomic: all effects or none; 'once' guard via event log
→ append validated event(s)    WorldSession.appendEvent (authoritative)
→ projections                  objective progress, journal candidate, revealed-clue set,
                               HUD/room state (all read-only projections)
→ narration                    success/failure observationKey → closed template (authoritative-
                               safe); optional LLM rewording of the template output is
                               display-only decoration through the existing sanitization path
```

**Authoritative:** appended events, `WorldState` projection, inventory, objective stages,
clue-revealed set, exit locks. **Non-authoritative:** all narration text, LLM rewordings,
memory entries derived from the interaction, dialogue references to it, journal *prose*
(journal *entries' existence* is authoritative via events; their display text is templated).
Failed actions append **no** world-mutating event; if the failure reveals a hint, that is a
dedicated idempotent `hint` flag event (information-revealed, not progress-granted).

---

## 10. Evaluation framework

**Automated (CI, deterministic):**

1. *Validator property tests:* generate thousands of random purpose graphs (seeded); assert
   no false-negatives on planted defects (cycle/orphan/duplicate fixtures) — reuse the
   fixture-builder style of existing gate tests.
2. *Solvability replay:* for each generated room fixture, mechanically execute the
   validator's fired-affordance order against a real `WorldSession`; assert objective
   completes. (The fixpoint's fire order *is* a walkthrough — TextWorld's trick.)
3. *Idempotency/duplicate rewards:* apply every `once` affordance twice; assert single event
   and unchanged inventory/clue set.
4. *Persistence & return visits:* save → load → re-enter room; assert affordance
   availability derives identically from restored flags (extends gate re-derivation tests).
5. *Deterministic replay:* replay event log from zero; assert identical projection.
6. *Fail-closed:* fuzz unknown precondition/effect kinds and malformed provider JSON; assert
   rejection + rung-5 fallback, never partial application.
7. *Prompt injection:* extend the existing redteam suite: adversarial object names/clue
   texts attempting `"effects": [...]` smuggling or instruction text; assert display-only
   handling and no vocabulary escape.
8. *No cross-world leakage:* clue/fact ids scoped by `(worldId, sessionId)`; assert recall
   filters (reuses memory-scoping tests).
9. *Bounded prompts:* assert Call A/B token budgets against fixtures (extends usage
   guardrails).

**Manual/playtest (per slice acceptance):**

- % of non-decorative objects whose purpose a tester can state after one interaction
  (target ≥80% — brief metric 1).
- % of inspections yielding information or state change (target ≥60% in objective rooms —
  metric 2).
- Clue comprehension: after finishing a room, tester writes one sentence on "what happened
  here"; grade against the generated ground-truth event (possible now, unlike That Darned
  Sandstorm, because clusters have ground truth) — metrics 3 and 7.
- Objective completion without hints; count of no-op interactions per room (metrics 4–5).
- Repeated-generic-message rate: instrument count of identical observation template ids
  shown twice for the same object (metric 6; §4.2 should drive it near zero).

---

## 11. Implementation recommendation (phased)

Slices match the brief's lettering. Each is one maintainer-approved plan per existing
workflow; files are best-guesses from the current tree.

**Slice A — Contract + validator, dry at runtime.**
Scope: `ObjectPurpose`/`ObjectAffordance`/`ClueSpec` zod schemas; graph assembly;
`validatePurposeGraph`; fixtures. No runtime consumption, no generation, no UI (the
gate-contract ADR-0061 playbook).
Files: new `domain/objectPurpose.ts`, `domain/purposeGraph.ts` (+tests); reuse
`evaluateCondition` shape from `domain/generatedMechanicalGate.ts`.
Tests: schema round-trips; every §6 defect class has a fixture caught + a clean fixture
passing. Manual acceptance: none (dry). Exclusions: no provider, no reducers, no HUD.
Risks: over-modeling — hold V1 vocabulary exactly to §5. Dependencies: none.

**Slice B — Deterministic single-object affordances (documents, containers, remains).**
Scope: deterministic builder assigns pattern-based affordances to those three categories in
generated rooms (extends `assignGeneratedObjectPurpose`); interactions layer executes
`inspect/read/search/open/take` with `set-interaction-state` + `add-item` + observation
templates; `search`-closure (§4.2).
Files: `domain/generatedRoomObjectPurpose.ts`, `interactions/**`, HUD chip labels
(ADR-0036 enum gains `read`/`search`/`open` verbs), observation template table.
Tests: reducer idempotency; availability function; per-state re-derivation after save/load.
Manual acceptance: open a generated room; search a container, get an item once, see
"searched" thereafter. Exclusions: clues, objectives, gates, LLM. Risks: HUD affordance enum
churn. Depends on A.

**Slice C — Clue/item/objective integration + idempotency.**
Scope: `reveal-clue` + `progress-objective` effects; `clue-revealed` events; journal
candidates; fact-visibility wiring (§7, minus clusters).
Files: `world-session` event types/projection, `interactions` planner, journal projector,
`domain/quests`.
Tests: idempotent reveals; objective monotonicity; save/load of revealed set; no
fact-truth mutation (firewall test). Manual acceptance: inspect corpse → clue appears in
journal → objective advances. Exclusions: clusters, hypotheses, dialogue unlocks. Depends on B.

**Slice D — Mechanisms, barricades, exit unlocking.**
Scope: `use/activate/clear` actions; `has-item` preconditions; blocked-action failure
observations + hint flags (§4.4); generalizes the mechanical gate to object-shaped blockers.
Files: `domain/generatedMechanicalGate.ts` lineage, `interactions`, navigation seam
(already enforced at `navigateWithExitGate`).
Tests: blocked-then-satisfied sequences; failure reveals hint exactly once; no reward from
failure. Manual acceptance: the brief's crank scenario end-to-end in a fixture room.
Depends on B (C optional but recommended first).

**Slice E — Dependency-graph generation + generated-room validator wiring.**
Scope: LLM Call A (pattern selection + skinning, schema-validated), deterministic assembly,
validator gate before playable, repair ladder rungs 1–5, count-only diagnostics.
Files: `generation/**` (new provider call beside the gate-proposal precedent),
`assembleRoom` stage insertion, usage guardrails.
Tests: invalid proposals land on correct repair rung; budget caps; fail-closed fuzzing.
Manual acceptance: real-provider room passes validator or degrades visibly-safely.
Risks: prompt cost (one extra bounded call — cover under ADR-0050 budget); pattern library
too rigid (acceptable v1 trade). Depends on A–D.

**Slice F — Clue clusters + dialogue topic unlocks.**
Scope: clusters + progress indicator (§4.1); `unlock dialogue topic` effect consumed by the
dialogue context builder with NPC fact-visibility filtering (§4.7).
Files: journal projector, `dialogue/buildRoomDialogueContext` lineage, quest sidecar.
Tests: cluster completion determinism; NPC knowledge-boundary filtering; injection redteam
on clue text in dialogue context. Manual acceptance: two-room evidence thread → new NPC
question. Depends on C, E.

**Slice G — Player hypothesis system. Only if** post-F playtests show comprehension loss
across sessions. Start as inert pinned player notes on clusters; no confidence modeling.
Explicitly experimental; separate go/no-go.

---

## 12. Final decision table

| Idea (brief §) | Decision | Reason |
| --- | --- | --- |
| 1. Contextual affordances | **Implement now (A/B)** | Unanimous cross-domain support; small extension of existing machinery |
| 2. Blocked-action feedback | **Implement now (D)** | High player value, pure templates over structured preconditions |
| 3. Short interaction chains (2–4 steps) | **Implement now (B–D)** | Pattern-template approach avoids scripting language; Doran/Dormans-backed |
| 4. Fragmented environmental evidence | **After first vertical slice (C, clusters in F)** | Needs clue substrate first; strongest engagement lever |
| 5. Player hypotheses | **Defer (G, experimental)** | Precedent (Outer Wilds) says clusters+journal suffice; high complexity, unproven payoff |
| 6. Narrative dependency generation | **After first vertical slice (E)** | Right idea; requires A-validator to be safe; pattern library bounds it |
| 7. Abstract intent → trusted execution | **Implement after slices, V2** | Architecture-aligned (ALFWorld), but menu-driven V1 must prove the vocabulary first |
| 8. Creative bounded actions (free text) | **Experimental prototype, V2+** | Evidence weak (preprint); tag-matching (§4.5) is the bounded stepping stone |
| 9. Informative failure | **Implement now (D)** | Universally supported; info-reveal-only boundary keeps it safe |
| 10. Purpose-graph validation | **Implement now (A, wired in E)** | Cheapest insurance in the whole design; ~100 lines, pure |
| Search-with-closure (§4.2) | **Implement now (B)** | Trivial; kills the repeated-generic-message complaint |
| Cluster progress indicator (§4.1) | **After first slice (F)** | Small; depends on clusters |
| Hint-to-journal hooks (§4.4) | **After first slice (D/F)** | Small; depends on failure system |
| Room recap sifting (§4.3) | **Defer V2** | Nice-to-have; journal candidates cover essentials |
| Tag-based tool matching (§4.5) | **Defer V2** | Guarded creativity; needs vocabulary discipline |
| NPC clue reactions (§4.7) | **Defer V2 (F groundwork)** | High value, but knowledge-boundary filtering must be built carefully |
| Evidence decay (§4.6) | **Defer later** | Atmosphere vs. investigation frustration; unproven |
| Red herrings (§4.8) | **Defer later** | Only after comprehension metrics are healthy |
| Hypothesis confidence/verdict modeling | **Reject (V1–V2 horizon)** | No supporting evidence; new authority surface; player's head does it better |
| `compare`/`reveal` as player actions | **Reject** | Journal feature / effect respectively, not world actions |
| Full planner (IPOCL-style) at generation | **Reject** | Template patterns + validation achieve the result at 2–4-step scale |
| ASP/constraint solver, graph DB | **Reject** | Pure TS fixpoint suffices at room scale; explicit brief constraint |
| Crafting/physics/free simulation | **Reject** | ScienceWorld demonstrates the cost curve |

---

## Final answer

**The smallest architecture that turns generated objects into meaningful, causal, persistent
gameplay is: one closed affordance contract (precondition/effect triples over the existing
flag-and-event substrate), one pure fixpoint validator over the dependency graph those
triples already imply, and one bounded LLM call that skins a small library of known-valid
chain patterns — with clue discovery recorded as idempotent events pointing at existing
facts.** Everything else — narration, journal grouping, dialogue unlocks, free-text intent —
is a projection or a later additive layer. The project has already built this architecture
once at exit scale (mechanical gates, ADR-0061..0064); this proposal is that same trusted
pattern generalized from one exit to every important object in the room.
