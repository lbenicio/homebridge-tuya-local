# Known Issues

## Unsupported Devices

- **Battery-powered sensor reachability** varies by model. This fork exposes local temperature/humidity and contact DPs when the device accepts Tuya LAN connections. Sleeping sensors can use explicitly configured cached DPS values, but those values remain stale until refreshed.

## Protocol Limitations

- Tuya protocol versions **3.1**, **3.3**, **3.4**, and **3.5** are implemented. Newer devices may use protocol versions or encryption methods not yet implemented.
- UDP discovery is unauthenticated. When `ip` is omitted, another host on the LAN that knows a configured device ID can impersonate that device. Legacy versions **3.1** and **3.3** also do not cryptographically authenticate status-frame integrity. Keep Homebridge and Tuya devices on a trusted LAN. Where supported, set a fixed `ip` and protocol version **3.4** or **3.5** to bypass discovery and use authenticated frame handling.

## Single Connection Limit

Tuya devices allow only one LAN connection at a time. If another app or plugin is connected to the device, this plugin will not be able to communicate with it.

## DataPoint Mapping

- DP mappings vary between manufacturers, even for the same device type. The default mappings may not work for all devices.
- Some devices report DPs in unexpected formats. Check the Homebridge log output to identify the correct DP numbers for your device.

## Adaptive Lighting

- Adaptive Lighting is only supported on `RGBTWLight`, `TWLight`, and `OilDiffuser` types.
- Requires Homebridge >= 1.6.0 and a compatible Home app.
