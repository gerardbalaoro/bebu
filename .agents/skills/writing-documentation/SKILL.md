---
name: writing-documentation
description: "Write, edit, and review technical documentation and code comments. Use to assess documentation needs and keep changes focused on the reader's task."
---

# Writing Documentation

Change documentation for an explicit requirement or a concrete reader need.
A code change alone does not require a documentation change.
New, accurate, or user-visible information alone does not justify an edit.

## Reader Needs

Before you write or edit, identify the document's purpose and intended reader.
For an existing document, identify the error or missing information that prevents the reader from completing the task.

## Headings

- Use Title Case for document titles and section headings.
- Write short, descriptive titles that name the section's topic or task.
- Prefer noun phrases or concise task labels, such as "Configuration" or "Error Recovery".
- Keep explanations, questions, and full-sentence claims in the body text.
- Group related content under a heading that helps the reader find it.

## Structure and Brevity

- Lead with the main point or required action.
- Keep each paragraph focused on one topic, usually in one to three short sentences.
- Split dense passages at topic or task boundaries.
- Use numbered lists for sequences, bullets for parallel items, and tables for comparisons.
- Keep list items parallel and nesting shallow.
- Keep connected explanations in short paragraphs instead of fragmenting every sentence into a bullet.
- Put prerequisites before the steps that depend on them.
- Retain details the reader needs to act correctly.
- Remove repeated points, filler, and background that does not serve the task.

## Clear Language

- Use familiar words, active voice, and direct verbs.
- Use one term consistently for each concept.
- Keep instructions within 20 words per sentence and explanations within 25.
- Give one instruction per sentence.
- Put conditions before the instructions they govern.
- Preserve complete grammar and necessary technical terms.
- Keep code, identifiers, commands, paths, and quoted errors exact.

## Scope and Sources

- Preserve the document's scope and level of detail.
- Include only information that serves its purpose.
- If a detail is outside that scope, omit it.
- Limit background, cross-references, and new documents to the reader need.
- Prefer the authoritative source over a prose copy of information that the reader can find there.
- Document context, intent, and instructions that the reader cannot obtain from that source.

## Maintenance Warnings

- Put warnings about non-obvious maintenance requirements beside the affected code.
- Keep these warnings out of broader documentation.
- If separate code locations must remain consistent, cross-reference them at each relevant location.

## Focused Edits

- Make the smallest edit that restores accuracy or meets the reader need.
- Replace or delete obsolete text.
- Keep task-completion summaries out of documents with a different purpose.

## Live and Historical Documentation

Live documentation reflects the current state within its defined scope.
It does not describe every implementation detail.
Historical documentation preserves its original context.

- For live documentation, keep the content consistent with the current state within its scope.
- For superseded or rejected material, mark its status at the start.
- State the replacement or the reason for rejection.
- For documents about active work, keep the content consistent with the work's scope, decisions, and status.
- After the work is complete, update those documents with the final result.
- Then preserve them as historical context.
