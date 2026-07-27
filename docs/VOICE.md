# Voice control (Siri / HomePod)

There are two layers, and you can use either or both.

## 1. Native Siri + HomeKit (recommended, zero extra setup)

Once your devices are bridged to Apple Home (see [`DEVICES.md`](DEVICES.md)) and
assigned to **HomeKit rooms**, Siri already understands natural room/most
commands on any HomePod or iPhone signed into the home:

- "Hey Siri, turn off the kitchen lights" → all lights in the HomeKit *Kitchen*
  room turn off.
- "Hey Siri, turn off the kitchen sink light" → just that accessory.
- "Hey Siri, set the kitchen lights to 50%".
- "Hey Siri, make the living room lamp purple".

**To make grouping work well:** in the Apple Home app, put each accessory in the
right room (matching the rooms you set on the touch screen). HomeKit's own
grouping then handles "the kitchen lights" as a set. Name accessories clearly
("Kitchen Sink Light") so per-light commands are unambiguous.

Your **kitchen and bedroom HomePods** act as the Siri endpoints — whichever
hears you handles the request; your iPhone works too.

## 2. Rich phrases via an Apple Shortcut (optional)

Some phrasings ("dim the kitchen lights **by** 99%", "change kitchen lights to
**warm 50%**") are easier to handle with our parser. The dashboard exposes:

```
POST http://<pi-ip>:8080/api/voice/command
Content-Type: application/json
{ "text": "dim the kitchen lights by 99%" }
```

It returns `{ "spoken": "...", "understood": true, "matched": [entity_ids] }`.

### Create the Shortcut

1. iPhone → **Shortcuts** app → **＋** → add actions:
   - **Dictate Text** (or **Ask for Input**) → captures the phrase.
   - **Get Contents of URL**:
     - URL: `http://<pi-ip>:8080/api/voice/command`
     - Method: **POST**, Request Body: **JSON**, field `text` = *Dictated Text*.
   - **Get Dictionary Value** `spoken` from the response.
   - **Speak Text** → speaks the confirmation back.
2. Name the Shortcut something Siri-friendly, e.g. **"Lights"**.
3. Now say: "Hey Siri, Lights" → dictate "dim the kitchen by 99%".

> The Pi must be reachable from your phone/HomePod. On the same Wi-Fi that's the
> LAN IP; remotely, use the Tailscale IP (see
> [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md#remote-access)).

### What the parser understands

| Say… | Result |
|------|--------|
| turn off the lights in the kitchen | all Kitchen lights off |
| turn off kitchen sink light | that one light off |
| dim lights in the kitchen by 99% | Kitchen lights → 1% |
| set kitchen to 30% | Kitchen lights → 30% |
| change kitchen lights to warm 50% | Kitchen → warm white, 50% |
| set kitchen to cool white | Kitchen → daylight white |
| change living room lamp to purple | color-capable lights → purple |
| turn all lights off | every light off |

Targeting priority: **all lights** → a **specific light** named in the phrase →
otherwise **every light in the named room**. Color commands only send RGB to
color-capable bulbs; warm/cool go to tunable-white bulbs. Rooms come from the
assignments you set on the touch screen, so it always matches your home.

You can dry-run any phrase without changing lights from **Setup → Voice → Test**.
