#!/bin/sh
case "$1" in
  *sername*) printf '%s\n' "${GIT_SYNC_USERNAME:-x-access-token}" ;;
  *assword*) printf '%s\n' "${GITHUB_TOKEN:-}" ;;
  *) exit 1 ;;
esac
