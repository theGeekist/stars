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

    defaultBranchRef {
      name
      target {
        ... on Commit {
          committedDate
          history(first: 5) {
            nodes { committedDate messageHeadline }
          }
        }
      }
    }
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
    releases(last: 1, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { tagName publishedAt url }
    }
    hasDiscussionsEnabled
    discussionCategories(first: 5) { nodes { id name slug } }

    changelogRoot: object(expression: "HEAD:CHANGELOG.md") {
      ... on Blob { oid byteSize }
    }
    changelogDocs: object(expression: "HEAD:docs/CHANGELOG.md") {
      ... on Blob { oid byteSize }
    }
    changelogHistory: object(expression: "HEAD:HISTORY.md") {
      ... on Blob { oid byteSize }
    }
    changelogChanges: object(expression: "HEAD:CHANGES.md") {
      ... on Blob { oid byteSize }
    }
    changelogNews: object(expression: "HEAD:NEWS.md") {
      ... on Blob { oid byteSize }
    }
  }
`;
