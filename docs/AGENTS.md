# AGENTS

## Intent
- Clarify the collaborative roles that keep EDH PodLog moving forward.
- Provide handover notes for human teammates and future automation.
- Anchor every contribution to player value and measurable outcomes.

## Agent Roster
- **Product Navigator**  
  Mission: define the product direction, maintain the opportunity backlog, and turn user insights into actionable bets.  
  Inputs: community feedback, playgroup interviews, business constraints.  
  Outputs: quarterly narrative, prioritised roadmap, KPI guardrails.

- **Experience Cartographer**  
  Mission: own UX flows across web and mobile, prototype end-to-end journeys, and keep the design system cohesive.  
  Inputs: Navigator briefs, analytics heatmaps, accessibility baselines.  
  Outputs: wireflows, interaction specs, component tokens, usability reports.

- **API Integrator**  
  Mission: connect external services (Google, Moxfield, Scryfall), manage auth flows, and enforce data contracts.  
  Inputs: service documentation, Integrator runbooks, security requirements.  
  Outputs: integration adapters, test harnesses, incident postmortems.

- **Data Chronicler**  
  Mission: structure player, deck, and match data, surface insights, and keep the metrics layer trustworthy.  
  Inputs: database snapshots, telemetry events, patch notes.  
  Outputs: schema migrations, stat dashboards, data quality alerts.

- **Playtest Conductor**  
  Mission: facilitate session logs, capture edge cases from real pods, and feed learnings back into the build loop.  
  Inputs: playtest scripts, session recordings, beta feedback.  
  Outputs: session summaries, bug triage, player archetype updates.

## Shared Principles
- Center decisions on Commander players, especially informal playgroups.
- Prefer iterative releases with observable success metrics.
- Keep documentation lightweight, versioned, and discoverable.
- Default to asynchronous updates; escalate synchronously when blocked.
- Capture learnings in the open so future agents ramp quickly.

## Operating Loops
- Daily async standup (Navigator host): blockers, next increment, metric watchlist.
- Twice-weekly design-dev desk check (Navigator + Cartographer + Integrator).
- Weekly playtest review (Conductor host): top findings, fixes committed, insights archived.
- Monthly data calibration (Chronicler host): schema diffs, metric drift, experiment results.
- Quarterly strategy reset (all agents): player voice, roadmap delta, resource needs.

## Tooling Map
- Source control: GitHub `edh-podlog` mono-repo, squash merge default.
- Issue tracking: GitHub Projects board tagged by agent ownership.
- Design: Figma library mirrored to a lightweight Storybook as source of truth.
- Analytics: posthog for event tracking, Metabase dash linked in `dashboard.html`.
- Integrations: Google Identity Services, Moxfield v2 API, Scryfall card catalog.
- Knowledge base: `EDH PodLog trashdraft.md` for long-form vision, `AGENTS.md` for role clarity.

## Open Questions
- How do we model guest players who join pods without full profiles?
- What is the minimal offline capability needed for remote pods?
- Which trust signals reassure players about data usage and privacy?
- Where do we centralise deck evaluation heuristics for cross-agent reuse?
