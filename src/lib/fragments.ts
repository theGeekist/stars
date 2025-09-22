// src/lib/fragments.ts
import { gql } from "@lib/github";

export const REPO_CORE_FRAGMENT = gql`
  fragment RepoCore on Repository {
    id
    nameWithOwner
    url
    description
    homepageUrl

    stargazerCount
    forkCount
    # Optional if you want to fill RepoInfo.watchers:
    watchers { totalCount }

    issues(states: OPEN) { totalCount }
    pullRequests(states: OPEN) { totalCount }

    defaultBranchRef { name target { ... on Commit { committedDate } } }
    primaryLanguage { name }
    licenseInfo { spdxId }

    isArchived
    isDisabled
    isFork
    isMirror
    hasIssuesEnabled

    pushedAt
    updatedAt
    createdAt
    # Optional if you want RepoInfo.languages:
    languages(first: 50) { edges { size node { name } } }

    repositoryTopics(first: 50) { nodes { topic { name } } }
  }
`;
