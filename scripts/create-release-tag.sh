#!/usr/bin/env bash
set -euo pipefail

source_branch=""
source_sha=""
release_tag_file=""
release_notes_file=""
skip_push="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-branch)
      source_branch="${2:-}"
      shift 2
      ;;
    --source-sha)
      source_sha="${2:-}"
      shift 2
      ;;
    --release-tag-file)
      release_tag_file="${2:-}"
      shift 2
      ;;
    --release-notes-file)
      release_notes_file="${2:-}"
      shift 2
      ;;
    --skip-push)
      skip_push="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${source_branch}" || -z "${source_sha}" || -z "${release_tag_file}" || -z "${release_notes_file}" ]]; then
  echo "Usage: $0 --source-branch <branch> --source-sha <sha> --release-tag-file <path> --release-notes-file <path>" >&2
  exit 1
fi

git fetch --force --tags

mapfile -t release_tags < <(git tag --list 'v[1-9]*.[0-9]*.[0-9]*' --sort=-v:refname)
latest_tag="${release_tags[0]:-}"
if [[ -z "${latest_tag}" ]]; then
  latest_tag="v1.0.0"
  mapfile -t previous_release_tags < <(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname)
  previous_tag="${previous_release_tags[0]:-}"
  if [[ -n "${previous_tag}" ]]; then
    commit_range="${previous_tag}..${source_sha}"
  else
    commit_range="${source_sha}"
  fi
else
  commit_range="${latest_tag}..${source_sha}"
fi

commits="$(git log --format=%B "${commit_range}")"
release_notes="$(git log -n 20 --format='- %s (%h)' "${commit_range}")"
if [[ -z "${release_notes}" ]]; then
  release_notes="- ${source_sha}"
fi

if grep -Eq '(^|[[:space:]])BREAKING[ -]CHANGE:|^[a-zA-Z][a-zA-Z0-9-]*(\([^)]+\))?!:' <<< "${commits}"; then
  bump="major"
else
  echo "No breaking change detected; defaulting to patch bump."
  bump="patch"
fi

version="${latest_tag#v}"
IFS='.' read -r major minor patch <<< "${version}"

case "${bump}" in
  major)
    major=$((major + 1))
    minor=0
    patch=0
    ;;
  patch)
    patch=$((patch + 1))
    ;;
esac

tag_name="v${major}.${minor}.${patch}"

printf '%s\n' "${release_notes}" > "${release_notes_file}"
printf '%s\n' "${tag_name}" > "${release_tag_file}"

if [[ "${skip_push}" == "true" ]]; then
  exit 0
fi

if git rev-parse -q --verify "refs/tags/${tag_name}" >/dev/null; then
  echo "Tag ${tag_name} already exists locally."
  exit 0
fi

if git ls-remote --exit-code --tags origin "refs/tags/${tag_name}" >/dev/null 2>&1; then
  echo "Tag ${tag_name} already exists on origin."
  exit 0
fi

tag_message="$(mktemp)"
{
  echo "Release ${tag_name} (${bump})"
  echo
  echo "Source: ${source_branch}@${source_sha}"
  echo "Range: ${commit_range}"
  echo
  echo "Changes:"
  printf '%s\n' "${release_notes}"
} > "${tag_message}"

git tag -a "${tag_name}" "${source_sha}" -F "${tag_message}"
git push origin "refs/tags/${tag_name}"
