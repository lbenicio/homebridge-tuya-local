# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.1.0] - 2026-11-24

### Added

- Added Matter exposure for supported Tuya LAN devices, including dimmers, tunable-white lights, multi-outlet and multi-switch devices, fans, fan lights, sensors, and wireless switches.
- Added Matter gesture events for wireless switches and state updates for individual endpoints.

### Changed

- Improved Matter accessory restoration and lifecycle handling, including cleanup of stale cached accessories.
- Log unsupported Matter device types while keeping those devices available in HomeKit.
- Changed release automation to use manual dispatch and changelog-based release notes.
- Pinned the Vite override to `^6.4.4`.

### Fixed

- Corrected the package license metadata to match the GPLv3 license text.
- Corrected Matter contact sensor state mapping.

## [2.0.1] - 2026-11-24

### Changed

- Published the package to npm and refined build, release, and CI workflows.
- Added automated dependency updates for npm packages and GitHub Actions.
- Added Codecov coverage uploads to the unit test workflow.

## [2.0.0] - 2026-11-24

### Added

- Initial release of the Homebridge Tuya Local plugin for controlling Tuya devices over the LAN.
- Added Tuya LAN protocol support for versions 3.1, 3.3, and 3.4, with UDP device discovery.
- Added HomeKit accessory support for the documented device types.
