# PR quality rubric

Treat every pull request in this repository as a contract change until proven
otherwise. For each diff, walk this checklist and flag the first unmet item you
can defend with a line citation.

- Every new branch has a test that drives it, or the PR says out loud why not.
- Error paths return typed results, never raw throws across module boundaries.
- Public signatures carry a doc comment naming the caller contract.
- No commit mixes a refactor with a behaviour change.

A PR that fails two or more items is a request_changes, not a comment.
