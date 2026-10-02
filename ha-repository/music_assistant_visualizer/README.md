# Music Assistant Visualizer for Home Assistant Lights

Synchronize your smart home lighting to the digital audio being played by Music Assistant in real-time. This application taps directly into Music Assistant's in-memory audio playback stream, analyzes the audio energy and low-frequency bass, and smoothly translates it into light brightness.

---

## 1. What it does

This Add-on functions as a direct digital bridge between Music Assistant's raw PCM audio pipeline and Home Assistant's native lights. As music plays, a high-speed background analyzer measures the overall loudness (RMS energy) and bass frequency levels, converting them instantly into natural, pulsing lighting levels. It features built-in signal smoothing to prevent distracting flickering, and runs completely in memory with zero microphone recording, zero disk writes, and zero latency.

---

## 2. Requirements

* **Home Assistant Operating System (HAOS)** or **Home Assistant Supervised** installation.
* **Music Assistant (mass)** server already installed (this App will replace the standard server to safely tap the audio pipeline).
* At least one smart light entity (e.g., dimmable Zigbee, Z-Wave, or Wi-Fi bulbs/strips like Philips Hue, LIFX, etc.).

---

## 3. Installation & Architecture

To tap into the real-time digital audio pipeline with zero latency, this application is packaged as a **replacement for the official Music Assistant Add-on**. It uses the exact same base code but inserts an isolated analysis bridge.

**IMPORTANT: Do NOT run two Music Assistant servers simultaneously.**

### Recommended Migration Path:

1. **Back up your current configuration**:
   * Open **Music Assistant**.
   * Go to **Settings** → **Server** → **Backup/Restore**.
   * Perform a full backup of your providers and settings.
2. **Stop the official Add-on**:
   * Navigate to **Settings** → **Add-ons** → **Music Assistant**.
   * Toggle off **Start on boot** and click **Stop**.
3. **Add this Repository**:
   * Go to **Settings** → **Add-ons** → **Add-on Store**.
   * In the top-right menu (⋮), select **Repositories**.
   * Add: `https://github.com/example/music-assistant-visualizer`
4. **Install the Visualizer Version**:
   * Find **Music Assistant Visualizer** in the store.
   * Click **Install**. This will build the container on your hardware.
5. **Restore your data (if needed)**:
   * Since this is a new Add-on instance, it has a separate data folder.
   * Start the Add-on, open its Web UI, and use the **Backup/Restore** feature to import your previously saved configuration.
   * Alternatively, most users find that simply re-logging into their streaming providers takes only a few seconds.

---

## 4. Configuration

1. Go to the **Configuration** tab in the Add-on panel.
2. **Light Entity**: The exact ID (e.g. `light.living_room_strip`).
3. **Update Interval**: Default `0.1` (10Hz). Increase to `0.2` if your Zigbee network is unstable.
4. **Energy/Bass Smoothing**: Fine-tune how "snappy" or "smooth" the lights react.
5. Click **Save** and **Start**.

---

## 5. Architecture Verification

This installation ensures:
1. **Single Instance**: Only one `mass` process runs on port 8095.
2. **True Digital Tap**: The visualizer patches the `_feed_stdin` loop in the active `ffmpeg` pipeline. It sees the exact PCM data that travels to your speakers.
3. **Complete Isolation**: The visualizer daemon runs as a child process. If it crashes, `mass` continues playing music without interruption.
4. **Zero Cloud Dependencies**: All analysis and Home Assistant communication stays on your local network. No audio is recorded or sent to external servers.

---

## 5. Testing & Verification

1. Open your **Music Assistant** panel.
2. Select any media player and play an energetic song.
3. Observe your selected light entity:
   * **Play starts**: The light instantly turns on and glows to the beat.
   * **Bass drops / Climax**: The light surges in brightness.
   * **Music pauses**: The light immediately stops updating and returns to a dim resting state.
   * **Music stops**: The light turns off completely.

---

## 6. Troubleshooting

### The App does not appear in the store
* Make sure you added the correct repository URL under the three-dot Repositories menu.
* Click **Check for updates** in the store menu to force Home Assistant to refresh the catalog.

### The App will not start
* Check the **Logs** tab at the top of the Add-on page. Look for port conflicts or Python startup errors.
* Ensure that the official Music Assistant server Add-on is completely stopped, as both cannot bind to the same network ports simultaneously.

### Music Assistant stopped working
* Stop the Visualizer Add-on and check its logs.
* If playback is failing, you can easily restart the official Music Assistant Server to restore playback instantly. Your database and files remain untouched.

### The light does not react
* Check if the **Light Entity ID** matches exactly in the settings.
* Verify that the App has permission to communicate with Home Assistant (ensure the **Supervisor API** permission is enabled in the Add-on settings).
* Check the logs to see if "Audio flow detected" is appearing. If not, the audio tap might have been bypassed by setting your player to bit-perfect stream bypass mode. Make sure crossfading or volume normalization is enabled on your Music Assistant player configuration to engage the digital DSP pipeline.

---

## 7. Architecture (For Developers)

```
                       [ Music Assistant playback pipeline ]
                                         │
                                         ▼
                            ( get_ffmpeg_stream() generator )
                                         │
                                         ├──► [ Non-blocking UDP Socket ] (port 9999)
                                         │    (PCM chunk data copy / Safe isolated tap)
                                         ▼
                             ( Original PCM continued )
                                         │
                                         ▼
                                  [ Audio Output ]
                                         
                                         │
                       ┌─────────────────┘ (Separated Process Boundary)
                       ▼
             [ visualizer.py daemon ]
                       │
                       ├──► [ PCM Analysis ] ──► Calculates overall RMS energy.
                       │                         Filters low-frequency bands for bass.
                       ├──► [ Smoothing ] ──────► Exponential Moving Average filter.
                       ▼
             [ Home Assistant Bridge ]
                       │
                       └──► REST Service call ──► light.turn_on (Throttled/coalesced updates)
```

### Safety & Isolation Guarantees:
* **Zero Playback Interruption**: The audio tap uses a non-blocking UDP sender. Chunks are split into small datagrams (< 1500 bytes) to avoid IP fragmentation. If the visualizer daemon crashes or stops, UDP packets are dropped instantly with zero overhead.
* **Dynamic Analysis**: The analyzer calculates audio duration and filter coefficients dynamically using the embedded PCM metadata (Sample Rate, Bit Depth, Channels). It reconstructs the continuous stream by tracking packet sequence numbers and handles dropped packets gracefully without blocking.
* **Low Network Overhead**: Light updates are throttled (default 100ms) and use a deadband threshold to prevent Zigbee/Wi-Fi congestion.
