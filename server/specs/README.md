# server/ specs

Behavior specs and design decisions for `@devdigest/api`: what a feature MUST
do, and why it was decided that way. Files are numbered `NN-slug.md`
(`01-…`, `02-…`, …).

A spec is updated in the same PR that changes the behavior it describes.

| Spec | Topic |
|------|-------|
| [01](01-pr-list-findings-field.md) | PR list findings field — `PrMeta.findings` latest-round previews |
| [02](02-skills.md) | Skills — storage, trust model, versioning, prompt injection |
| [03](03-conventions.md) | Conventions Extractor — repo → evidence-gated candidates → skill |
| [04](04-pr-intent.md) | PR Intent — motivation classification before review |
| [05](05-smart-diff.md) | Smart Diff — role-grouped Files-changed with inline findings |
