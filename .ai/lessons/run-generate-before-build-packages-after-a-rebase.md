---
title: "Run generate before build:packages after a rebase"
modules: ["cli","core","shared"]
areas: ["debugging","framework-context"]
topics: ["generated-files","build-output","package-runtime"]
---

# Run generate before build:packages after a rebase

**Context**: `@open-mercato/core` resolves `#generated/entities.ids.generated` at runtime to `packages/core/dist/generated/entities.ids.generated.js`, a compiled copy of the gitignored `packages/core/generated/entities.ids.generated.ts`. `yarn generate` refreshes the `.ts`; only a package build refreshes the `.js`.

**Problem**: After rebasing a long-lived branch onto a `main` that added modules (`warranty_claims`, `cart`), the sequence was `yarn build:packages` → `yarn generate`. The dist registry was compiled from the pre-rebase ids. `yarn typecheck` and jest still pass, because they read the fresh `.ts`. `yarn initialize` then fails during bootstrap with `Cannot read properties of undefined (reading 'warranty_claim')` / `(reading 'cart_line')`, raised from a module's `search.ts` reading `E.<module>.<entity>`.

**Rules**:

- After a rebase or any change to the set of modules or entities, run `yarn generate` **before** `yarn build:packages`. If you already built, rebuild the affected package (`yarn turbo run build --filter=@open-mercato/core`).
- Diagnose it by comparing mtimes. If `packages/<pkg>/generated/entities.ids.generated.ts` is newer than `packages/<pkg>/dist/generated/entities.ids.generated.js`, the dist copy is stale.
- Typecheck and unit tests do not prove the runtime registry is current. Only a live boot (`yarn initialize` / `yarn dev`) does.
