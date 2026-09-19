# Multi-Agent Delegation

Codex should use subagents when doing so can improve speed, reliability,
code quality, or parallel execution.

## When to delegate

Delegate work to subagents when:

- There are 2 or more independent tasks that can be performed in parallel.
- A task requires independent research or investigation.
- A large codebase needs separate areas inspected simultaneously.
- Tests, debugging, documentation, or code review can be performed independently.
- An independent verification pass would reduce the chance of mistakes.

Do NOT create subagents for trivial tasks where delegation adds more overhead
than value.

The main agent remains responsible for the final result.


## Agent selection

Use the available GPT/Codex subagent model that best matches the task.

### Fast / lightweight GPT subagent
Use a lower-cost, faster GPT model for:

- Searching files
- Finding references
- Simple code inspection
- Reading logs
- Formatting
- Small mechanical changes
- Running straightforward tests
- Collecting information

The goal is to avoid spending high reasoning effort on simple work.


### Standard GPT/Codex subagent
Use the standard capable coding model for:

- Normal feature implementation
- Debugging
- Refactoring
- Writing tests
- API integration
- Moderate architectural decisions
- Reviewing a specific component


### High-reasoning GPT/Codex subagent
Use the strongest available GPT/Codex model when the task requires:

- Difficult debugging
- Complex algorithms
- Architecture decisions
- Security-sensitive reasoning
- Large refactors
- Difficult dependency issues
- Complicated concurrency
- Deep code review
- Problems where previous agents failed

Do not use the strongest model for simple tasks unnecessarily.


## Parallel execution

When tasks are independent, run them in parallel.

Example:

Task A:
Inspect the frontend and identify required changes.

Task B:
Inspect the backend and identify required changes.

Task C:
Inspect the test suite and determine which tests need to change.

After the subagents finish, the main agent should combine their findings
and implement the final solution.


## Implementation workflow

For a substantial coding task:

1. Understand the requirements.
2. Inspect the repository.
3. Identify independent areas of work.
4. Delegate independent investigations or implementations when useful.
5. Collect subagent results.
6. Resolve conflicting recommendations.
7. Implement the final integrated solution.
8. Run tests and validation.
9. Review the resulting diff.
10. Fix any remaining issues.
11. Report the completed work.


## Verification agents

For important or complicated changes, use a separate subagent as a reviewer.

The reviewer should NOT blindly assume that the implementation is correct.

Ask it to check:

- Functional correctness
- Edge cases
- Regressions
- Security problems
- Incorrect assumptions
- Missing tests
- API compatibility
- Unnecessary changes

The main agent decides which review feedback should actually be applied.


## Failure and escalation

If a subagent fails:

1. Inspect the failure.
2. Determine whether the problem is caused by the task,
   environment, or insufficient reasoning.
3. Retry with a better-defined task if appropriate.
4. Escalate to a stronger GPT/Codex model when necessary.

Do not repeatedly spawn agents without changing the approach.


## Context isolation

Give each subagent only the context necessary for its task.

Do not unnecessarily duplicate the entire main-agent reasoning process.

Each subagent should receive:

- Its specific objective
- Relevant files
- Relevant constraints
- Expected output
- Any required verification steps


## Code ownership

Subagents may modify files when explicitly assigned implementation work.

Before allowing multiple agents to modify code simultaneously:

- Ensure they are working on independent files or components.
- Avoid concurrent edits to the same files.
- If two tasks affect the same files, have one agent investigate
  and return recommendations instead of modifying the files.

The main agent owns final integration.


## Testing

After all delegated work is complete:

- Run the relevant tests.
- Run type checking when applicable.
- Run linting when applicable.
- Build the project when appropriate.
- Investigate failures rather than ignoring them.

Do not run unnecessarily expensive checks for trivial changes unless
the repository requires them.


## General rule

Use multi-agent execution when it provides a real advantage.

Prefer:

    simple task → main agent

    independent tasks → parallel subagents

    difficult task → strong GPT/Codex subagent

    complex implementation → implementation + independent review

    final result → main agent integrates and verifies

The objective is not to maximize the number of agents.

The objective is to produce the best correct result with the least
unnecessary time, context, and compute.