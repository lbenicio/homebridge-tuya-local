# Configuration Examples

## Simple Light

```json
{
  "platform": "TuyaLocalPlatform",
  "devices": [
    {
      "name": "Living Room Light",
      "type": "SimpleLight",
      "id": "REPLACE_WITH_DEVICE_ID",
      "key": "REPLACE_WITH_LOCAL_KEY"
    }
  ]
}
```

## RGB + Tunable White Light

```json
{
  "platform": "TuyaLocalPlatform",
  "devices": [
    {
      "name": "Bedroom Lamp",
      "type": "RGBTWLight",
      "id": "REPLACE_WITH_DEVICE_ID",
      "key": "REPLACE_WITH_LOCAL_KEY",
      "manufacturer": "LIFX",
      "model": "Color Bulb"
    }
  ]
}
```

## Dehumidifier with Custom DPs

```json
{
  "platform": "TuyaLocalPlatform",
  "devices": [
    {
      "name": "Basement Dehumidifier",
      "type": "Dehumidifier",
      "id": "REPLACE_WITH_DEVICE_ID",
      "key": "REPLACE_WITH_LOCAL_KEY",
      "dpPower": "1",
      "dpMode": "2",
      "dpCurrentHumidity": "6",
      "dpTargetHumidity": "4"
    }
  ]
}
```

## Mapped Heat Pump Heater

```json
{
  "platform": "TuyaLocalPlatform",
  "devices": [
    {
      "name": "Heat Pump",
      "type": "MappedHeatPumpHeater",
      "id": "REPLACE_WITH_DEVICE_ID",
      "key": "abcd1234efgh5678",
      "manufacturer": "Ferroli",
      "model": "Omnia S 3.2"
    }
  ]
}
```

## Circuit Breaker Monitor

```json
{
  "platform": "TuyaLocalPlatform",
  "devices": [
    {
      "name": "Main Panel Monitor",
      "type": "CircuitBreakerMonitor",
      "id": "REPLACE_WITH_DEVICE_ID",
      "key": "efgh5678abcd1234",
      "dpSwitch": "1",
      "dpTemperature": "9"
    }
  ]
}
```
