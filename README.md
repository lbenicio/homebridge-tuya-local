<div align="center">

  <br />

  <img src="docs/public/logo.svg" alt="lbenicio" width="96" />

<br /><br />

# Homebridge Tuya Local Platform

**Control Tuya smart devices locally over LAN through Apple HomeKit. No cloud, no latency.**

  <br />

[![CI](https://github.com/lbenicio/homebridge-tuya-local/actions/workflows/unit-tests.yml/badge.svg)](https://github.com/lbenicio/homebridge-tuya-local/actions/workflows/unit-tests.yml)
[![GitHub release](https://img.shields.io/github/v/release/lbenicio/homebridge-tuya-local)](https://github.com/lbenicio/homebridge-tuya-local/releases)
[![npm version](https://img.shields.io/npm/v/@lbenicio/homebridge-tuya-local)](https://www.npmjs.com/package/@lbenicio/homebridge-tuya-local)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/lbenicio/homebridge-tuya-local/badges/coverage.json)](https://github.com/lbenicio/homebridge-tuya-local/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D26.0.0-339933)](https://www.npmjs.com/package/@lbenicio/homebridge-tuya-local)
[![Homebridge](https://img.shields.io/badge/homebridge-%3E%3D1.6.0-blue)](https://homebridge.io)
[![license](https://img.shields.io/npm/l/@lbenicio/homebridge-tuya-local)](LICENSE)
[![Docs](https://img.shields.io/website?url=https%3A%2F%2Fdocs.lbenicio.io%2Fhomebridge-tuya-local%2F&label=docs)](https://docs.lbenicio.io/homebridge-tuya-local/)

</div>

---

## Table of Contents

- [Homebridge Tuya Local Platform](#homebridge-tuya-local)
  - [Table of Contents](#table-of-contents)
  - [Quick Start](#quick-start)
  - [Why Local Control?](#why-local-control)
  - [Matter](#matter)
  - [Features](#features)
  - [Supported Devices](#supported-devices)
  - [Documentation](#documentation)
  - [Contributing](#contributing)
  - [Contributors](#contributors)
  - [Security](#security)
  - [Support this project](#support-this-project)
  - [License](#license)

---

## Quick Start

**Option 1: Homebridge UI (recommended):**

1. Open the Homebridge web UI and navigate to the **Plugins** tab.
2. Search for `@lbenicio/homebridge-tuya-local` and click **Install**.
3. Use the plugin's settings form to add your devices, then restart Homebridge.

**Option 2: Command line:**

```bash
npm install -g @lbenicio/homebridge-tuya-local
```

Add to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "TuyaLocalPlatform",
      "devices": [
        {
          "name": "My Light",
          "type": "SimpleLight",
          "id": "<device-id>",
          "key": "<local-key>"
        }
      ]
    }
  ]
}
```

> **Need your device credentials?** See the [Getting Local Keys](https://docs.lbenicio.io/homebridge-tuya-local/get-local-keys) guide.

---

## Matter

On Homebridge 2, enable the Matter protocol for this platform's child bridge in the Homebridge UI. Supported local lights, switches, outlets, temperature/humidity sensors, contact sensors, and wireless switches are then published by the same LAN connection, without Tuya cloud access.

The existing HomeKit bridge remains available, and device UUIDs are kept stable when switching the package name.

---

## Why Local Control?

Tuya's cloud relies on remote servers. Any outage, policy change, or internet disruption can leave your automations unresponsive. This plugin talks directly to your devices over your LAN using the Tuya protocol (v3.1, v3.3, v3.4, v3.5):

- **Works offline:** your smart home keeps working even when the internet is down
- **Instant response:** no round-trip to the cloud; commands execute in milliseconds
- **No subscription:** zero dependency on Tuya's infrastructure or account

---

## Features

- **Local LAN Control:** Communicates directly with devices; no cloud, no internet dependency
- **29 Device Types:** Outlets, lights, dimmers, fans, sensors, climate control, IR/RF hubs, and more
- **Adaptive Lighting:** HomeKit Adaptive Lighting on compatible tunable white and RGBTW accessories
- **Energy Monitoring:** Real-time voltage, current, and power readings on supported devices
- **Automatic Discovery:** UDP broadcast discovery finds devices on your local network automatically
- **Flexible Configuration:** Override DataPoints (DPs) and tune device behavior per accessory
- **Multi-protocol Support:** Protocol handling for Tuya LAN versions v3.1, v3.3, v3.4, and v3.5, using the protection available in each version
- **TypeScript:** Fully typed codebase with comprehensive test coverage

---

## Supported Devices

<!-- prettier-ignore -->
| Device                                |        Type key         |
| :------------------------------------ | :---------------------: |
| Air Conditioner                       |    `AirConditioner`     |
| Air Purifier                          |      `AirPurifier`      |
| Circuit Breaker Monitor _(read-only)_ | `CircuitBreakerMonitor` |
| Contact / Door Sensor                 | `ContactSensor`         |
| Heat Convector                        |       `Convector`       |
| Non-sequential Power Strip            |   `CustomMultiOutlet`   |
| Dehumidifier                          |     `Dehumidifier`      |
| Smart Fan Regulator                   |          `Fan`          |
| Smart Fan with Light                  |       `FanLight`        |
| Garage Door                           |      `GarageDoor`       |
| Infrared / RF Hub                     |      `InfraredHub`      |
| Mapped Heat Pump Heater               | `MappedHeatPumpHeater`  |
| Smart Power Strip                     |      `MultiOutlet`      |
| Oil Diffuser                          |      `OilDiffuser`      |
| Smart Plug                            |        `Outlet`         |
| Smart Plug w/ Color Lights            |      `RGBTWOutlet`      |
| White and Color Light Bulb            |      `RGBTWLight`       |
| Simple Blinds                         |     `SimpleBlinds`      |
| Simple Dimmer                         |     `SimpleDimmer`      |
| Simple Dimmer 2                       |     `SimpleDimmer2`     |
| Simple Heater                         |     `SimpleHeater`      |
| Simple Light Bulb                     |      `SimpleLight`      |
| Temperature and Humidity Sensor       | `TemperatureHumiditySensor` |
| Multi-Switch                          |        `Switch`         |
| Tunable White Light Bulb              |        `TWLight`        |
| Water Valve                           |      `WaterValve`       |
| Wireless Zigbee Switch                |    `WirelessSwitch`    |
| Zigbee Gateway                        |        `Gateway`        |

> The `type` value is **case-insensitive**. `"SimpleLight"`, `"simplelight"`, and `"SIMPLELIGHT"` all work.

Full per-device configuration details and DataPoint overrides are covered in the [Supported Device Types](https://docs.lbenicio.io/homebridge-tuya-local/device-types) docs.

---

## Documentation

Full documentation is available at **[docs.lbenicio.io/homebridge-tuya-local](https://docs.lbenicio.io/homebridge-tuya-local/)**, including:

- [Installation](https://docs.lbenicio.io/homebridge-tuya-local/installation)
- [Getting Local Keys](https://docs.lbenicio.io/homebridge-tuya-local/get-local-keys)
- [Configuration](https://docs.lbenicio.io/homebridge-tuya-local/configuration)
- [Supported Device Types](https://docs.lbenicio.io/homebridge-tuya-local/device-types)
- [Troubleshooting](https://docs.lbenicio.io/homebridge-tuya-local/troubleshooting)

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and pull request guidelines.

---

## Contributors

Thank you to everyone who has contributed to this plugin. Protocol support, device types and bug fixes here come from people testing against hardware we do not own, and the plugin is better for it.

<a href="https://github.com/lbenicio/homebridge-tuya-local/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=lbenicio/homebridge-tuya-local" alt="Contributors to homebridge-tuya-local" />
</a>

Reporting a device that does not work, or confirming that one does, is a real contribution too. See [open issues](https://github.com/lbenicio/homebridge-tuya-local/issues).

---

## Security

UDP discovery is unauthenticated, and Tuya protocol versions 3.1 and 3.3 do not authenticate status-frame integrity. Keep Homebridge and Tuya devices on a trusted LAN. Where supported, configure a fixed IP and protocol version 3.4 or 3.5 for authenticated frame handling.

For security vulnerabilities, please see [SECURITY.md](SECURITY.md) for responsible disclosure procedures.

---

## Support this project

If this plugin helps your Homebridge setup, consider sponsoring development. Maintaining device integrations, testing hardware, and providing support takes significant time. GitHub Sponsors helps ensure long-term maintenance.

- ❤️ [Sponsor via GitHub](https://github.com/sponsors/joseporto)
- ⭐ [Star the repository](https://github.com/lbenicio/homebridge-tuya-local)

---

## License

[GPLv3](LICENSE.txt)
