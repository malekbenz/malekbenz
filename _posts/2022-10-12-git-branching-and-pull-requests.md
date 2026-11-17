---
layout: post
title: "Git branching and pull requests - Feature branches, merge vs rebase, conflicts and code review"
date: 2022-10-12
author: Malekbenz
comments: true
category: GIT
tags : [ 'GIT', 'GitHub' ]
categories: ['GIT']
description: 'Git branching and pull requests - Feature branches, merge vs rebase, conflicts and code review'
image: /images/covers/git-branching-and-pull-requests.png
---

In [Git Basics](/blog/2018/02/20/git-basics) we created a repository, committed and pushed — everything on one branch. That works alone. With a team, everybody committing directly to `main` means half-finished features in production, a broken build every other day, and no chance to review code before it lands. **Branches** and **pull requests** fix that. Let's practice the whole workflow by typing the commands: create a feature branch, keep it up to date, solve a conflict, open a pull request, merge it — and undo things when they go wrong.

## The core idea: a branch is just a pointer

A branch is not a copy of your code. It's a **movable label** pointing to a commit:

```sql
                     feature/discounts
                           ▼
            ┌── D ─── E ───┘
A ─── B ─── C ─── F ─── G
                        ▲
                       main
```

- Creating a branch costs nothing: Git writes a 41-byte file with a commit id.
- Committing moves the current branch forward.
- `main` and `feature/discounts` share history up to `C`, then diverge.

> **Branch for every change, keep branches short-lived, and let main always be in a working state.**

---

## Create a feature branch

Always start from an up-to-date `main`:

```sql
 $ git switch main
 $ git pull
 $ git switch -c feature/order-discounts
```

`git switch -c` creates the branch and moves to it (the older equivalent is `git checkout -b`). Check where you are:

```sql
 $ git branch
   main
 * feature/order-discounts
```

Work as usual — small commits with clear messages:

```sql
 $ git add src/Pricing/DiscountCalculator.cs
 $ git commit -m "Add discount calculation for orders over 100 euros"

 $ git add tests/DiscountCalculatorTests.cs
 $ git commit -m "Test discount thresholds and VIP rate"
```

A good commit message says **what** and **why** in one line, in the imperative: "Add...", "Fix...", "Remove...". "wip", "fix", "changes" tell your colleagues (and you, in six months) nothing.

Push the branch to GitHub:

```sql
 $ git push -u origin feature/order-discounts
```

`-u` links your local branch to the remote one, so later a plain `git push` / `git pull` knows where to go.

### Naming branches

```sql
feature/order-discounts      new functionality
fix/negative-stock           bug fix
chore/upgrade-dotnet-6       maintenance, dependencies
```

A prefix + a short description. Some teams add the ticket number: `feature/1234-order-discounts`.

---

## Keep your branch up to date: merge or rebase?

While you work, colleagues merge their branches into `main`. Your branch falls behind:

```sql
            ┌── D ─── E          (your branch)
A ─── B ─── C ─── F ─── G        (main moved on)
```

There are two ways to bring `F` and `G` into your branch.

### Option 1: merge main into your branch

```sql
 $ git switch feature/order-discounts
 $ git fetch origin
 $ git merge origin/main
```

```sql
            ┌── D ─── E ─── M    (M = a merge commit with two parents)
A ─── B ─── C ─── F ─── G ──┘
```

Safe and simple: nothing is rewritten. The history shows exactly what happened, including the merge.

### Option 2: rebase your branch on main

```sql
 $ git fetch origin
 $ git rebase origin/main
```

```sql
A ─── B ─── C ─── F ─── G ─── D' ─── E'    (your commits replayed on top of G)
```

Rebase **replays** your commits on top of the latest `main`, as if you had started your work today. The history becomes a straight line — but `D'` and `E'` are **new** commits (new ids). If you had already pushed the branch, you must force-push:

```sql
 $ git push --force-with-lease
```

`--force-with-lease` refuses to overwrite the remote branch if someone else pushed to it meanwhile — always prefer it to `--force`.

| | Merge | Rebase |
|---|---|---|
| History | Shows the real story, with merge commits | Straight line, easier to read |
| Rewrites commits | ❌ Never | ✅ Your branch's commits get new ids |
| Needs force-push if already pushed | ❌ | ✅ |
| Conflicts | Solved once | Possibly once per replayed commit |
| Safe on shared branches | ✅ | ❌ |

> **The golden rule of rebase: never rebase commits that other people have based work on.** Rebasing *your own* feature branch is fine; rebasing `main` is not.

---

## Solving a conflict

A colleague changed the same lines in `DiscountCalculator.cs` and merged first. When you merge (or rebase):

```sql
 $ git merge origin/main
 Auto-merging src/Pricing/DiscountCalculator.cs
 CONFLICT (content): Merge conflict in src/Pricing/DiscountCalculator.cs
 Automatic merge failed; fix conflicts and then commit the result.
```

Git marks the conflicting part in the file:

```csharp
public decimal For(decimal total, bool isVip)
{
<<<<<<< HEAD
    var rate = total >= 100 ? 0.05m : 0m;
=======
    var rate = total >= 150 ? 0.07m : 0m;
>>>>>>> origin/main
    return isVip ? total * (rate + 0.10m) : total * rate;
}
```

- Between `<<<<<<< HEAD` and `=======`: **your** version.
- Between `=======` and `>>>>>>>`: **their** version.

Git can't know which one is right — **you** decide (sometimes it's one of them, sometimes a combination). Talk to your colleague if you're not sure. Edit the file to the final version, remove the markers, then:

```sql
 $ git add src/Pricing/DiscountCalculator.cs
 $ git commit                      # for a merge
 $ git rebase --continue           # or, for a rebase
```

**Build and run the tests** before committing the resolution: a conflict resolved "textually" can still be wrong logically. And if you're lost: `git merge --abort` or `git rebase --abort` puts everything back as it was.

VS Code and Visual Studio show conflicts with buttons ("Accept current", "Accept incoming", "Accept both") — easier than editing markers by hand.

---

## Open a pull request

A **pull request** (PR) says: "Here's my branch, please review it and merge it into `main`." On GitHub, after pushing, a banner offers **Compare & pull request**. Or from the terminal with the GitHub CLI:

```sql
 $ gh pr create --base main --title "Add order discounts" --body "Discount of 5% above 100 €, +10% for VIP customers. Closes #1234."
```

A good PR description answers three questions:

```sql
1. What does it change?           "Adds discounts on orders over 100 €"
2. Why?                           "Requested by the sales team, ticket #1234"
3. How to test / what to look at? "Run DiscountCalculatorTests; the VIP rule is in For()"
```

### Small PRs get better reviews

A PR of 50 lines gets a careful review in 10 minutes. A PR of 2,000 lines gets "LGTM 👍" — nobody really reads it. Split big features into several small PRs (an early PR can add code that's not used yet, behind a flag).

### Reviewing

As a reviewer, look for what tools can't see: is the logic right, are edge cases handled, is it tested, will we understand it in a year? Leave comments on specific lines; distinguish **blocking** issues from suggestions ("nit: ..."). As an author, push new commits to the same branch to answer comments — the PR updates automatically.

---

## Merge the pull request

GitHub offers three buttons:

| Option | Result on main | Good for |
|---|---|---|
| **Create a merge commit** | All commits + a merge commit | Keeping the full history of the branch |
| **Squash and merge** | **One** commit with all the changes | Feature branches with "fix typo" commits — clean history |
| **Rebase and merge** | The branch's commits, replayed in line | Branches with clean, meaningful commits |

Many teams choose **squash and merge**: one commit per feature on `main`, easy to read and easy to revert. Then delete the branch (GitHub has a button), and locally:

```sql
 $ git switch main
 $ git pull
 $ git branch -d feature/order-discounts
 $ git fetch --prune                 # forget remote branches that were deleted
```

---

## Protect main

In the repository settings on GitHub, **branch protection rules** for `main` make the workflow mandatory:

```sql
✅ Require a pull request before merging        (no direct pushes to main)
✅ Require approvals: 1                          (at least one reviewer)
✅ Require status checks to pass                 (the build and tests must be green)
✅ Require branches to be up to date             (tested against the latest main)
```

With these, "someone pushed broken code to main" simply can't happen anymore.

---

## Undoing things

| Situation | Command | Note |
|---|---|---|
| Discard changes in a file (not committed) | `git restore file.cs` | The changes are lost |
| Unstage a file (keep the changes) | `git restore --staged file.cs` | |
| Fix the last commit's message or add a forgotten file | `git commit --amend` | Only if not pushed yet |
| Undo the last commit, keep the changes | `git reset --soft HEAD~1` | Only if not pushed yet |
| Undo a commit that's already on main | `git revert <commit>` | Creates a new "undo" commit — safe for shared branches |
| "I lost a commit after a reset/rebase!" | `git reflog` | Shows every position HEAD had — find it and `git switch -c rescue <id>` |
| Put work aside to switch branches | `git stash` / `git stash pop` | |

The rule behind the table: **rewrite only what you haven't shared** (`amend`, `reset`, `rebase`), and **add new commits to undo what's shared** (`revert`). And `git reflog` is the safety net that makes almost every mistake recoverable.

---

## Key rules to remember

| Rule | Why |
|---|---|
| One branch per change, from an up-to-date `main` | Isolation, main stays working |
| Short-lived branches, small PRs | Easy reviews, fewer conflicts |
| Clear commit messages: imperative, what and why | Readable history |
| `git push -u` the first time | Local and remote branches linked |
| Merge or rebase to stay up to date — never rebase shared branches | Rebase rewrites history |
| `--force-with-lease`, never plain `--force` | Doesn't overwrite a colleague's push |
| Resolve conflicts, then build and test | Textually merged ≠ logically correct |
| PR description: what, why, how to test | Faster, better reviews |
| Squash and merge for messy branches | One clean commit per feature |
| Protect `main`: PRs, reviews, green checks | Broken code can't land |
| `revert` on shared history, `reset/amend` only locally; `reflog` saves you | Undo without hurting others |

>
> ## That's it & see you soon!.
>
