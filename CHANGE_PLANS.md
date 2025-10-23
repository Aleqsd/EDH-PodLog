# EDH PodLog · Change Plans

## CSS Design Tokens & Layering

- Extract color, spacing, typography tokens into a dedicated source (e.g. `frontend/public/styles/tokens.css` or JSON feeding a build step).
- Split styles into layers: tokens/utilities, base layout, components, views.
- Enforce usage of the token utilities across components to reduce drift.
- Document how new styles must compose the tokens before merging.
