#!/usr/bin/env python3
"""
Lightweight version management and release tooling for EDH PodLog.

Usage examples:
  - python scripts/version_manager.py current
  - python scripts/version_manager.py prepare patch
  - python scripts/version_manager.py publish --push --create-release
"""

from __future__ import annotations

import argparse
import datetime as _dt
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = REPO_ROOT / "VERSION"
RELEASE_NOTES_FILE = REPO_ROOT / "docs" / "RELEASE_NOTES.md"

SEMVER_PATTERN = re.compile(r"^(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)$")


class VersionError(RuntimeError):
    """Raised when the version file cannot be parsed."""


def _read_file(path: Path) -> str:
    try:
        return path.read_text(encoding="utf8")
    except FileNotFoundError:
        return ""


def read_version() -> tuple[int, int, int]:
    """Return the current semantic version from VERSION."""
    raw = _read_file(VERSION_FILE).strip()
    if not raw:
        raise VersionError("VERSION file is empty; expected semantic version (e.g. 0.1.0).")
    match = SEMVER_PATTERN.match(raw)
    if not match:
        raise VersionError(f"VERSION '{raw}' is not a valid semantic version.")
    return tuple(int(match.group(part)) for part in ("major", "minor", "patch"))


def write_version(parts: tuple[int, int, int]) -> str:
    """Persist the semantic version to VERSION and return the formatted string."""
    version = format_version(parts)
    VERSION_FILE.write_text(f"{version}\n", encoding="utf8")
    return version


def format_version(parts: Iterable[int]) -> str:
    major, minor, patch = parts
    return f"{major}.{minor}.{patch}"


def bump_version(parts: tuple[int, int, int], part: str) -> tuple[int, int, int]:
    major, minor, patch = parts
    if part == "major":
        return major + 1, 0, 0
    if part == "minor":
        return major, minor + 1, 0
    if part == "patch":
        return major, minor, patch + 1
    raise ValueError(f"Unknown version part '{part}'.")


def run_git(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        check=check,
        capture_output=True,
        text=True,
    )


def get_latest_tag() -> str | None:
    try:
        result = run_git(["describe", "--tags", "--abbrev=0"], check=True)
    except subprocess.CalledProcessError:
        return None
    tag = result.stdout.strip()
    return tag or None


def generate_release_notes(start_ref: str | None) -> str:
    range_spec = "HEAD"
    if start_ref:
        range_spec = f"{start_ref}..HEAD"
    try:
        result = run_git(["log", range_spec, "--pretty=format:%s"], check=True)
    except subprocess.CalledProcessError:
        return "- Maintenance updates."
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        return "- Maintenance updates."
    return "\n".join(f"- {line}" for line in lines)


def ensure_release_notes_dir() -> None:
    RELEASE_NOTES_FILE.parent.mkdir(parents=True, exist_ok=True)


def update_release_notes(version: str, notes: str) -> None:
    ensure_release_notes_dir()
    date_str = _dt.date.today().isoformat()
    section = f"## v{version} - {date_str}\n\n{notes.strip()}\n"

    existing = _read_file(RELEASE_NOTES_FILE).strip()
    header = "# Release Notes"

    if existing.startswith(header):
        _, _, remainder = existing.partition("\n")
        remainder = remainder.lstrip("\n")
    else:
        remainder = existing

    new_content = f"{header}\n\n{section}"
    if remainder:
        new_content += "\n" + remainder.strip() + "\n"

    RELEASE_NOTES_FILE.write_text(new_content.rstrip() + "\n", encoding="utf8")


def stage_paths(paths: Iterable[Path]) -> None:
    staged = [str(path.relative_to(REPO_ROOT)) for path in paths]
    if not staged:
        return
    run_git(["add", *staged], check=True)


def extract_release_notes_section(version: str) -> str:
    content = _read_file(RELEASE_NOTES_FILE)
    if not content:
        raise VersionError("Release notes file is empty; cannot publish release without notes.")
    pattern = re.compile(
        rf"^##\s+v{re.escape(version)}\b.*?(?=^##\s+v|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(content)
    if not match:
        raise VersionError(f"No release notes section found for version v{version}.")
    return match.group(0).strip()


def git_tag_exists(tag: str) -> bool:
    result = run_git(["tag", "-l", tag], check=True)
    return tag in [line.strip() for line in result.stdout.splitlines()]


def create_git_tag(tag: str, message: str, allow_existing: bool = False) -> None:
    if git_tag_exists(tag):
        if allow_existing:
            return
        raise VersionError(f"Git tag '{tag}' already exists.")
    run_git(["tag", "-a", tag, "-m", message], check=True)


def push_git_tag(tag: str) -> None:
    run_git(["push", "origin", tag], check=True)


def gh_available() -> bool:
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if not entry:
            continue
        candidate = Path(entry) / "gh"
        if candidate.exists() and os.access(candidate, os.X_OK):
            return True
    return False


def create_github_release(tag: str, title: str, notes: str, *, draft: bool, prerelease: bool) -> None:
    if not gh_available():
        raise VersionError("GitHub CLI (gh) not found in PATH; install gh to create releases.")

    with tempfile.NamedTemporaryFile("w+", encoding="utf8", delete=False) as handle:
        handle.write(notes.strip() + "\n")
        handle.flush()
        notes_file = handle.name

    try:
        command = [
            "gh",
            "release",
            "create",
            tag,
            "--title",
            title,
            "--notes-file",
            notes_file,
        ]
        if draft:
            command.append("--draft")
        if prerelease:
            command.append("--prerelease")
        subprocess.run(command, cwd=REPO_ROOT, check=True)
    finally:
        Path(notes_file).unlink(missing_ok=True)


def command_current(_: argparse.Namespace) -> None:
    version = format_version(read_version())
    print(version)


def command_prepare(args: argparse.Namespace) -> None:
    current_parts = read_version()
    new_parts = bump_version(current_parts, args.part)
    new_version = format_version(new_parts)
    previous_version = format_version(current_parts)

    start_ref = args.since or f"v{previous_version}"
    if start_ref and not git_tag_exists(start_ref.replace("^", "")):
        start_ref = args.since if args.since else get_latest_tag()

    notes = generate_release_notes(start_ref)

    if args.dry_run:
        print(f"[dry-run] Would bump {previous_version} -> {new_version}")
        print("[dry-run] Release notes preview:")
        print(notes)
        return

    written_version = write_version(new_parts)
    update_release_notes(written_version, notes)

    if not args.no_stage:
        stage_paths([VERSION_FILE, RELEASE_NOTES_FILE])

    print(f"Bumped version: {previous_version} -> {written_version}")
    print("Release notes updated with latest changes.")


def command_publish(args: argparse.Namespace) -> None:
    parts = read_version()
    version = format_version(parts)
    tag = f"v{version}"

    if args.create_release or args.push:
        # Ensure release notes exist before pushing tags.
        extract_release_notes_section(version)

    if not git_tag_exists(tag) or args.recreate_tag:
        if git_tag_exists(tag) and args.recreate_tag:
            run_git(["tag", "-d", tag], check=True)
        create_git_tag(tag, f"Release {tag}", allow_existing=args.recreate_tag)
        print(f"Created git tag {tag}.")
    else:
        print(f"Git tag {tag} already exists.")

    if args.push:
        push_git_tag(tag)
        print(f"Pushed tag {tag} to origin.")

    if args.create_release:
        section = extract_release_notes_section(version)
        create_github_release(
            tag,
            f"v{version}",
            section,
            draft=args.draft,
            prerelease=args.prerelease,
        )
        print(f"Created GitHub release for {tag}.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage semantic versioning and releases.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    current_parser = subparsers.add_parser("current", help="Print the current project version.")
    current_parser.set_defaults(func=command_current)

    prepare_parser = subparsers.add_parser(
        "prepare",
        help="Bump the project version and prepend release notes from recent commits.",
    )
    prepare_parser.add_argument("part", choices=("major", "minor", "patch"), help="Version component to bump.")
    prepare_parser.add_argument(
        "--since",
        help="Git ref to diff from when generating release notes (defaults to latest tag).",
    )
    prepare_parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing files.")
    prepare_parser.add_argument("--no-stage", action="store_true", help="Do not stage modified files.")
    prepare_parser.set_defaults(func=command_prepare)

    publish_parser = subparsers.add_parser(
        "publish",
        help="Create a git tag and optional GitHub release for the current version.",
    )
    publish_parser.add_argument(
        "--push",
        action="store_true",
        help="Push the created tag to origin.",
    )
    publish_parser.add_argument(
        "--create-release",
        action="store_true",
        help="Create a GitHub release using the notes for the current version.",
    )
    publish_parser.add_argument(
        "--draft",
        action="store_true",
        help="Mark the GitHub release as a draft.",
    )
    publish_parser.add_argument(
        "--prerelease",
        action="store_true",
        help="Mark the GitHub release as a prerelease.",
    )
    publish_parser.add_argument(
        "--recreate-tag",
        action="store_true",
        help="Delete and recreate the existing tag if it already exists.",
    )
    publish_parser.set_defaults(func=command_publish)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except VersionError as error:
        print(f"[version-manager] {error}", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as error:
        print(error.stderr or error.stdout, file=sys.stderr)
        sys.exit(error.returncode)


if __name__ == "__main__":
    main()
