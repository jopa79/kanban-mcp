/**
 * ABOUTME: Handlebars Prompt Template fuer Ralph TUI.
 * Definiert wie der aktuelle Task dem Agent praesentiert wird.
 */

export const PROMPT_TEMPLATE = `## Current Task
**{{task.title}}** (ID: {{task.id}})
Status: {{task.status}}
{{#if task.labels}}Labels: {{#each task.labels}}{{this}} {{/each}}{{/if}}

{{#if task.description}}
## Description
{{{task.description}}}
{{/if}}

{{#if task.metadata.notes}}
## Task Notes
{{{task.metadata.notes}}}
{{/if}}

## Instructions
Work on this task. Follow any instructions in the task notes above.
When the task is fully implemented and verified, output:
<promise>COMPLETE</promise>

If you encounter a blocker that prevents completion, output:
<promise>BLOCKED: [reason]</promise>
`;
