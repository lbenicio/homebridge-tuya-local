import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const changelogPath = resolve('CHANGELOG.md')
const packagePath = resolve('package.json')
const lockfilePath = resolve('package-lock.json')

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readSection(sectionName, allowDatedHeader = false) {
  const lines = readFileSync(changelogPath, 'utf8').split(/\r?\n/)
  const suffix = allowDatedHeader ? '(?:\\s+-\\s+.*)?' : ''
  const header = new RegExp(`^## \\[${escapeRegExp(sectionName)}\\]${suffix}\\s*$`)
  const start = lines.findIndex((line) => header.test(line))

  if (start === -1) {
    return undefined
  }

  const nextSection = lines.findIndex((line, index) => index > start && /^## \[[^\]]+\]/.test(line))
  const notes = lines
    .slice(start + 1, nextSection === -1 ? lines.length : nextSection)
    .join('\n')
    .trim()

  return { lines, start, nextSection, notes }
}

function readUnreleasedSection() {
  const section = readSection('Unreleased')

  if (!section) {
    throw new Error('CHANGELOG.md must contain a "## [Unreleased]" section.')
  }

  if (!section.notes) {
    throw new Error('Add release notes under "## [Unreleased]" before publishing.')
  }

  return section
}

function readReleaseSection(version) {
  const section = readSection(version, true)

  if (section && !section.notes) {
    throw new Error(`Add release notes under "## [${version}]" before publishing.`)
  }

  return section
}

export async function generateNotes(_pluginConfig, { nextRelease }) {
  return (readReleaseSection(nextRelease.version) || readUnreleasedSection()).notes
}

export async function prepare(_pluginConfig, { nextRelease }) {
  const existingRelease = readReleaseSection(nextRelease.version)
  let promotedChangelog

  if (existingRelease) {
    promotedChangelog = readFileSync(changelogPath, 'utf8')
  } else {
    const { lines, start, nextSection, notes } = readUnreleasedSection()
    const preceding = lines
      .slice(0, start + 1)
      .join('\n')
      .replace(/\s+$/, '')
    const historical = nextSection === -1 ? '' : lines.slice(nextSection).join('\n').replace(/^\s+/, '')
    const date = new Date().toISOString().slice(0, 10)
    promotedChangelog = [`${preceding}\n\n## [${nextRelease.version}] - ${date}\n\n${notes}`, historical].filter(Boolean).join('\n\n').replace(/\n*$/, '\n')
  }

  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'))
  const lockfileRoot = lockfile.packages?.['']

  if (!lockfileRoot || lockfile.version !== packageJson.version || lockfileRoot.version !== packageJson.version) {
    throw new Error('package.json and package-lock.json versions must match before a release.')
  }

  lockfile.version = nextRelease.version
  lockfileRoot.version = nextRelease.version

  writeFileSync(changelogPath, promotedChangelog)
  writeFileSync(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`)
}
