# Documentation Rules

## Core Principles

- Use Title Case for headings in `docs/`.

- A code change does not automatically require a documentation change. Change documentation only for
  an explicit requirement or a concrete reader need.
- Before you edit, identify the purpose of the document and its intended reader. Identify the error
  or missing information that prevents the reader from completing the task.
- New, accurate, or user-visible information alone does not justify an edit.

## Scope and Sources

- Preserve the scope and detail of the document. Include only information that serves its purpose.
- If a detail is outside the scope, omit it. Keep background, cross-references, and new documents
  limited to the reader need.
- Prefer the authoritative source over a prose copy of information that the reader can find there.
  Document context, intent, and instructions that the reader cannot obtain from that source.

## Warnings for Code Maintenance

- Put warnings about non-obvious maintenance requirements beside the affected code. Keep these
  warnings out of broader documentation.
- If separate code locations must remain consistent, cross-reference them at each relevant location.

## Keep Edits Focused

- Make the smallest edit that restores accuracy or meets the reader need.
- Replace or delete obsolete text.
- Keep task-completion summaries out of documents with a different purpose.

## Live and Historical Documentation

- **Live documentation** reflects the current state within its defined scope. It does not describe
  every implementation detail.
- **Historical documentation** preserves its original context. Mark superseded or rejected material
  at the start. State the replacement or the reason for rejection. Keep documents about active work
  consistent with its scope, decisions, and status. After the work is complete, update those
  documents with the final result. Then preserve them as historical context.
