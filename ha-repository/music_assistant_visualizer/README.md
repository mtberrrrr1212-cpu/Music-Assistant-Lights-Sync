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

## 3. Installation

Because a safe digital audio tap requires intercepting the raw PCM stream inside Music Assistant, this App is packaged as a modified Music Assistant Server. It preserves all of your databases and settings, but adds the high-speed background tap.

### Step-by-Step UI Instructions:

1. **Back up your current Music Assistant config**:
   * Navigate to **Settings** → **System** → **Backups**.
   * Click **Create Backup**, select a custom name (e.g., "Music Assistant Pre-Visualizer"), and make sure the "Music Assistant" folder is selected. Click Create.
2. **Stop and disable the official Music Assistant Server**:
   * Go to **Settings** → **Add-ons** (or **Apps**) → **Music Assistant**.
   * Toggle off **Start on boot** and click **Stop**.
3. **Add the Custom Repository**:
   * Go to **Settings** → **Apps** (or **Add-ons**) → **Install app** (or **Add-on Store**).
   * In the top-right corner, click the three-dots menu (**⋮**) and choose **Repositories**.
   * Copy the URL of your customized GitHub repository and paste it into the field, then click **Add** and close the dialog.
4. **Install the Visualizer App**:
   * Scroll down or search the Store to locate the new card named **Music Assistant Visualizer**.
   * Click on it and select **Install** (this may take a couple of minutes to build the secure container on your hardware).

---

## 4. Configuration

Once the installation completes, configure the visualizer under the **Configuration** tab in the App's panel:

1. **Light Entity**: Enter the exact entity ID of the light you want to synchronize (e.g., `light.living_room_strip` or `light.ceiling_bulb`).
2. **Min Brightness**: Set the minimum brightness level (e.g., `10` or `15`) so the room does not go completely black during silent moments.
3. **Max Brightness**: Set the maximum allowed brightness (e.g., `255` for full range).
4. **Update Interval**: The speed of updates in seconds. Default is `0.1` (10 updates per second) which is optimal for smoothness without overloading your Zigbee/Wi-Fi hub.
5. **Energy & Bass Smoothing**: Lower values (e.g. `0.1`) make the transitions smoother and slower, while higher values (e.g. `0.3`) make the reactions faster and punchier.
6. **Start on Boot**: Enable this toggle.
7. Click **Save** and then click **Start** on the Info page.

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
* **Zero Playback Interruption**: The audio tap uses a local UDP sender inside a standard try/except block. If the visualizer daemon crashes or stops, UDP packets are instantly dropped by the kernel with zero overhead. There are no blocking locks or queues, meaning music playback will never crackle, lag, or stop.
* **Low Network Overhead**: Updates are throttled at `0.1s` intervals and filtered with a deadband threshold so that Home Assistant is only notified when a noticeable brightness change occurs. This prevents flooding Zigbee, Z-Wave, or Wi-Fi smart plugs.
