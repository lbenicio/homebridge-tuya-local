# Installation

## Option 1: Homebridge Config UI X

1. Open the Homebridge UI.
2. Go to **Plugins**.
3. Search for `@lbenicio/homebridge-tuya-local`.
4. Click **Install**.
5. Restart Homebridge.

## Option 2: Manual (npm)

```bash
npm install -g @lbenicio/homebridge-tuya-local
```

Restart Homebridge after installation.

## Matter on Homebridge 2

Open the platform's child bridge settings in Homebridge 2 and enable Matter. The plugin publishes supported Tuya LAN devices through the Matter child bridge while retaining the existing HomeKit bridge. Current mappings include power controls, dimmable and tunable-white lights, multi-outlet strips, multi-switch devices, fans, temperature/humidity sensors, contact sensors, and wireless switches. RGB color controls are exposed as on/off controls; unsupported device types remain available through HomeKit.

Homebridge's Matter implementation is community-provided and is not CSA-certified, so controllers may show an uncertified-device warning during pairing. See the [Homebridge Matter documentation](https://github.com/homebridge/homebridge#matter-support).

## Verify Installation

Check that the plugin is registered:

```bash
npm list -g @lbenicio/homebridge-tuya-local
```

## Upgrading from `homebridge-tuya` / `TuyaLocalPlatform`

If you previously used the `homebridge-tuya` plugin with `"platform": "TuyaLocalPlatform"`:

1. Uninstall the old plugin.
2. Install this plugin.
3. Update your `config.json` — change `"platform": "TuyaLocalPlatform"` to `"platform": "TuyaLocalPlatform"`.
4. Restart Homebridge.

All device configurations remain compatible.
