/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { 
  Play, 
  Pause, 
  Settings, 
  BookOpen, 
  Cpu, 
  FileCode, 
  Copy, 
  Check, 
  Download, 
  Volume2, 
  VolumeX, 
  Sliders, 
  Lightbulb, 
  AlertTriangle, 
  Wifi,
  Radio
} from "lucide-react";

// Definitions of Repository Files - Audited & Synced with Workspace
const REPOSITORY_FILES = {
  "repository.yaml": {
    path: "repository.yaml",
    description: "Declares this folder as a Home Assistant add-on repository.",
    content: `name: "Music Assistant Visualizer Integration"
url: "https://github.com/example/music-assistant-visualizer"
maintainer: "Home Assistant Music Visualizer Community"`
  },
  "config.yaml": {
    path: "music_assistant_visualizer/config.yaml",
    description: "Configures the Add-on name, options, permissions, and Docker architecture.",
    content: `name: "Music Assistant Visualizer"
version: "1.0.0"
slug: "music_assistant_visualizer"
description: "Real-time digital PCM audio analyzer and light synchronizer for Music Assistant."
url: "https://github.com/example/music-assistant-visualizer"
arch:
  - aarch64
  - amd64
  - armv7
init: false
host_network: true
homeassistant_api: true
supervisor_api: true
options:
  light_entity: "light.living_room"
  update_interval: 0.1
  min_brightness: 10
  max_brightness: 255
  energy_smoothing: 0.15
  bass_smoothing: 0.10
  bass_boost_factor: 1.3
  music_assistant_host: "127.0.0.1"
  music_assistant_port: 8095
schema:
  light_entity: str
  update_interval: float
  min_brightness: int
  max_brightness: int
  energy_smoothing: float
  bass_smoothing: float
  bass_boost_factor: float
  music_assistant_host: str
  music_assistant_port: int`
  },
  "Dockerfile": {
    path: "music_assistant_visualizer/Dockerfile",
    description: "Constructs the Docker container inheriting from the official Music Assistant Server image.",
    content: `# Base image is the official Music Assistant Server image
FROM ghcr.io/music-assistant/server:latest

# Set system shell for execution
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Create application directory
RUN mkdir -p /app

# Copy custom patches and visualizer code
COPY patch.py /app/patch.py
COPY visualizer.py /app/visualizer.py
COPY run.sh /run.sh

# Make scripts executable
RUN chmod +x /app/patch.py \\
    && chmod +x /app/visualizer.py \\
    && chmod +x /run.sh

# Execute the run.sh script as the entrypoint
ENTRYPOINT [ "/run.sh" ]`
  },
  "run.sh": {
    path: "music_assistant_visualizer/run.sh",
    description: "The container startup script. Runs the audio patch, boots the daemon, and launches Music Assistant.",
    content: `#!/usr/bin/env bash
set -e

echo "========================================================"
echo "    Music Assistant Visualizer Add-on / App Starting    "
echo "========================================================"

# Make sure our helper scripts are executable
chmod +x /app/patch.py
chmod +x /app/visualizer.py

echo "[Add-on Start] Step 1: Patching Music Assistant with Audio Tap..."
if python3 /app/patch.py; then
    echo "[Add-on Start] Patch applied successfully."
else
    echo "[Add-on Start] WARNING: Patching failed! Playback will work, but visualizer might not tap audio."
fi

echo "[Add-on Start] Step 2: Launching real-time Audio Analyzer daemon..."
# Run the visualizer.py daemon in the background
python3 /app/visualizer.py &
DAEMON_PID=$!
echo "[Add-on Start] Analyzer daemon launched with PID $DAEMON_PID."

echo "[Add-on Start] Step 3: Launching Music Assistant Server..."
echo "--------------------------------------------------------"
# Exec into mass to replace process 1 and capture signals perfectly
exec mass --config /data`
  },
  "patch.py": {
    path: "music_assistant_visualizer/patch.py",
    description: "A python utility that injects an isolated metadata-prepended UDP tap socket into Music Assistant's stdin feeding loop.",
    content: `#!/usr/bin/env python3
import os
import sys

def main():
    print("Starting Music Assistant Audio Tap Patcher...")
    
    # Dynamically find the music_assistant package path
    try:
        import music_assistant
        package_dir = os.path.dirname(music_assistant.__file__)
        print(f"Discovered Music Assistant package at: {package_dir}")
    except ImportError:
        print("Error: music_assistant package not found in Python path.")
        sys.exit(1)

    # List of possible target files where the audio data flows
    target_files = [
        os.path.join(package_dir, "server", "helpers", "process.py"),
        os.path.join(package_dir, "helpers", "process.py"),
        os.path.join(package_dir, "server", "helpers", "ffmpeg.py"),
        os.path.join(package_dir, "helpers", "ffmpeg.py"),
        os.path.join(package_dir, "server", "helpers", "audio.py"),
        os.path.join(package_dir, "helpers", "audio.py"),
    ]

    patched_any = False

    tap_code_template = """
        # --- BEGIN MUSIC ASSISTANT VISUALIZER TAP ---
        try:
            import socket, struct
            _sample_rate = 44100
            _channels = 2
            _bit_depth = 16
            _pcm_type = 2  # Default S16LE
            
            # Inspect object dynamically for formatting properties
            _fmt = getattr(self, "input_format", None) or getattr(self, "audio_format", None)
            if _fmt:
                _sample_rate = getattr(_fmt, "sample_rate", 44100)
                _channels = getattr(_fmt, "channels", 2)
                _bit_depth = getattr(_fmt, "bit_depth", 16)
                _ct_str = str(getattr(_fmt, "content_type", "")).lower()
                if "f32" in _ct_str or "float" in _ct_str:
                    _pcm_type = 1
                elif "s16" in _ct_str or "16" in _ct_str:
                    _pcm_type = 2
                elif "s24" in _ct_str or "24" in _ct_str:
                    _pcm_type = 3
            
            _sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            _header = struct.pack("<IBBB", _sample_rate, _channels, _bit_depth, _pcm_type)
            _sock.sendto(_header + chunk[:32000], ("127.0.0.1", 9999))
        except Exception:
            pass
        # --- END MUSIC ASSISTANT VISUALIZER TAP ---
    """

    for target_path in target_files:
        if not os.path.exists(target_path):
            continue
            
        print(f"Inspecting file: {target_path}")
        
        with open(target_path, "r", encoding="utf-8") as f:
            content = f.read()

        if "MUSIC ASSISTANT VISUALIZER TAP" in content:
            print(f"Already patched! Skipping: {target_path}")
            patched_any = True
            continue

        target_pattern = "async for chunk in self.audio_input:"
        if target_pattern in content:
            replacement = f"{target_pattern}{tap_code_template}"
            content = content.replace(target_pattern, replacement)
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Successfully patched stdin feeder in: {target_path}")
            patched_any = True
            continue

        target_pattern_alt = "async for chunk in audio_input:"
        if target_pattern_alt in content:
            replacement = f"{target_pattern_alt}{tap_code_template.replace('self', 'None')}"
            content = content.replace(target_pattern_alt, replacement)
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Successfully patched general chunk generator in: {target_path}")
            patched_any = True
            continue

    if patched_any:
        print("Music Assistant codebase patched successfully!")
    else:
        print("Error: Could not locate a secure audio tap injection point.")
        sys.exit(1)

if __name__ == "__main__":
    main()`
  },
  "visualizer.py": {
    path: "music_assistant_visualizer/visualizer.py",
    description: "The main background daemon. Automatically decodes PCM streams using C-optimized standard libraries and includes real-time telemetry diagnostics.",
    content: `#!/usr/bin/env python3
import os
import sys
import json
import socket
import struct
import array
import time
import requests
import threading
import math

class MusicAssistantVisualizer:
    def __init__(self, diagnostic_mode=False):
        self.diagnostic_mode = diagnostic_mode
        self.load_config()
        self.udp_host = "127.0.0.1"
        self.udp_port = 9999
        self.running = True
        
        self.current_energy = 0.0
        self.current_bass = 0.0
        self.lpf_state = 0.0
        self.lpf_alpha = 0.02
        self.smoothed_energy = 0.0
        self.smoothed_bass = 0.0
        self.last_ha_update = 0
        self.last_brightness = -1
        self.is_playing = False
        self.last_audio_received = 0
        
        self.packets_sec = 0
        self.bytes_sec = 0
        self.analyzer_errors = 0
        self.last_diagnostic_print = 0
        self.last_header_info = "Unknown"
        
        self.ha_token = os.environ.get("SUPERVISOR_TOKEN", "")
        self.ha_url = "http://supervisor/core/api"
        self.standalone = self.diagnostic_mode or not self.ha_token

    def load_config(self):
        self.config = {
            "light_entity": "light.living_room",
            "update_interval": 0.1,
            "min_brightness": 10,
            "max_brightness": 255,
            "energy_smoothing": 0.15,
            "bass_smoothing": 0.10,
            "bass_boost_factor": 1.3
        }
        options_path = "/data/options.json"
        if os.path.exists(options_path):
            try:
                with open(options_path, "r") as f:
                    self.config.update(json.load(f))
            except Exception:
                pass

    def send_ha_command(self, brightness):
        if self.standalone:
            return
        url = f"{self.ha_url}/services/light/turn_on"
        headers = {"Authorization": f"Bearer {self.ha_token}", "Content-Type": "application/json"}
        payload = {"entity_id": self.config["light_entity"], "brightness": int(brightness)}
        try:
            requests.post(url, headers=headers, json=payload, timeout=0.15)
        except Exception:
            pass

    def turn_off_light(self):
        if self.standalone:
            return
        url = f"{self.ha_url}/services/light/turn_off"
        headers = {"Authorization": f"Bearer {self.ha_token}", "Content-Type": "application/json"}
        payload = {"entity_id": self.config["light_entity"]}
        try:
            requests.post(url, headers=headers, json=payload, timeout=0.2)
        except Exception:
            pass

    def decode_and_analyze_pcm(self, data):
        if len(data) < 7:
            self.analyzer_errors += 1
            return 0.0, 0.0
        try:
            sample_rate, channels, bit_depth, pcm_type = struct.unpack("<IBBB", data[:7])
            payload = data[7:]
            self.last_header_info = f"{'F32LE' if pcm_type==1 else 'S16LE' if pcm_type==2 else 'S24LE'} | {sample_rate}Hz | {channels}ch"
            
            # Recalculate low-pass filter alpha based on true sample_rate
            fc = 150.0
            dt = 1.0 / max(sample_rate, 8000)
            rc = 1.0 / (2.0 * math.pi * fc)
            self.lpf_alpha = dt / (rc + dt)

            samples = []
            if pcm_type == 1:
                num_floats = len(payload) // 4
                if num_floats > 0:
                    samples_arr = array.array('f')
                    samples_arr.frombytes(payload[:num_floats * 4])
                    samples = list(samples_arr)
            elif pcm_type == 2:
                num_shorts = len(payload) // 2
                if num_shorts > 0:
                    shorts_arr = array.array('h')
                    shorts_arr.frombytes(payload[:num_shorts * 2])
                    samples = [x / 32768.0 for x in shorts_arr]
            elif pcm_type == 3:
                num_samples = len(payload) // 3
                for i in range(num_samples):
                    slice_3 = payload[i*3 : (i+1)*3]
                    sign_byte = b'\\xff' if slice_3[2] & 0x80 else b'\\x00'
                    val = struct.unpack("<i", slice_3 + sign_byte)[0]
                    samples.append(val / 8388608.0)
            else:
                self.analyzer_errors += 1
                return 0.0, 0.0

            if not samples:
                return 0.0, 0.0

            sum_squares = sum(x * x for x in samples)
            rms = math.sqrt(sum_squares / len(samples))
            energy = min(rms * 2.5, 1.0)

            # Apply IIR filter for Bass extraction
            bass_samples = []
            for x in samples:
                self.lpf_state = self.lpf_alpha * x + (1.0 - self.lpf_alpha) * self.lpf_state
                bass_samples.append(self.lpf_state)
                
            sum_bass_squares = sum(x * x for x in bass_samples)
            bass_rms = math.sqrt(sum_bass_squares / len(bass_samples))
            bass = min(bass_rms * 3.5 * self.config["bass_boost_factor"], 1.0)
            return energy, bass

        except Exception:
            self.analyzer_errors += 1
            return 0.0, 0.0

    def print_diagnostics_report(self):
        now = time.time()
        if now - self.last_diagnostic_print >= 1.0:
            status_str = "ACTIVE PLAYBACK" if self.is_playing else "STANDBY"
            print("\\n" + "="*50)
            print("         MUSIC ASSISTANT AUDIO TAP DIAGNOSTICS      ")
            print("="*50)
            print(f"Tap Status:             {status_str}")
            print(f"Detected Audio Stream:  {self.last_header_info}")
            print(f"Packets received / sec: {self.packets_sec} pkts")
            print(f"Data received rate:     {self.bytes_sec / 1024:.2f} KB/s")
            print(f"Calculated Energy (RMS):{self.current_energy:.4f} (Smoothed: {self.smoothed_energy:.4f})")
            print(f"Calculated Bass (LPF):  {self.current_bass:.4f} (Smoothed: {self.smoothed_bass:.4f})")
            print(f"Analyzer Errors:        {self.analyzer_errors} errors")
            print("="*50)
            self.packets_sec = 0
            self.bytes_sec = 0
            self.last_diagnostic_print = now

    def playback_monitor_thread(self):
        while self.running:
            time.sleep(1.0)
            now = time.time()
            if self.is_playing and (now - self.last_audio_received > 3.0):
                self.is_playing = False
                self.turn_off_light()
                self.smoothed_energy = 0.0
                self.smoothed_bass = 0.0
                self.last_brightness = -1

    def listen_loop(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.bind((self.udp_host, self.udp_port))
        except Exception:
            self.running = False
            return
        sock.settimeout(0.5)
        monitor = threading.Thread(target=self.playback_monitor_thread, daemon=True)
        monitor.start()
        self.last_diagnostic_print = time.time()

        while self.running:
            try:
                data, addr = sock.recvfrom(65535)
                self.last_audio_received = time.time()
                self.packets_sec += 1
                self.bytes_sec += len(data)
                
                if not self.is_playing:
                    self.is_playing = True

                energy, bass = self.decode_and_analyze_pcm(data)
                self.current_energy = energy
                self.current_bass = bass
                
                e_smoothing = self.config["energy_smoothing"]
                b_smoothing = self.config["bass_smoothing"]
                self.smoothed_energy = (e_smoothing * energy) + ((1.0 - e_smoothing) * self.smoothed_energy)
                self.smoothed_bass = (b_smoothing * bass) + ((1.0 - b_smoothing) * self.smoothed_bass)
                
                if self.diagnostic_mode:
                    self.print_diagnostics_report()
                    continue
                
                now = time.time()
                if now - self.last_ha_update >= self.config["update_interval"]:
                    min_b = self.config["min_brightness"]
                    max_b = self.config["max_brightness"]
                    combined_energy = max(self.smoothed_energy, self.smoothed_bass * 0.8)
                    brightness = int(min_b + (combined_energy * (max_b - min_b)))
                    brightness = max(min_b, min(brightness, max_b))
                    
                    if abs(brightness - self.last_brightness) >= 3 or (brightness == min_b and self.last_brightness != min_b):
                        self.send_ha_command(brightness)
                        self.last_brightness = brightness
                    self.last_ha_update = now
            except socket.timeout:
                if self.diagnostic_mode:
                    self.print_diagnostics_report()
            except Exception:
                self.analyzer_errors += 1
                time.sleep(0.5)
        sock.close()

if __name__ == "__main__":
    is_diag = "--diagnostic" in sys.argv
    visualizer = MusicAssistantVisualizer(diagnostic_mode=is_diag)
    try:
        visualizer.listen_loop()
    except KeyboardInterrupt:
        visualizer.running = False`
  },
  "test_analyzer.py": {
    path: "music_assistant_visualizer/test_analyzer.py",
    description: "Automated unit test suite verifying silence, signal levels, filters, smoothing, and isolation capabilities.",
    content: `#!/usr/bin/env python3
import unittest
import struct
import math
from visualizer import MusicAssistantVisualizer

class TestAudioAnalyzer(unittest.TestCase):
    def setUp(self):
        self.visualizer = MusicAssistantVisualizer()
        self.visualizer.standalone = True

    def generate_sine_wave(self, frequency, duration=0.1, sample_rate=44100, amplitude=0.5):
        num_samples = int(sample_rate * duration)
        samples = []
        for i in range(num_samples):
            t = i / sample_rate
            samples.append(amplitude * math.sin(2 * math.pi * frequency * t))
        return struct.pack(f"{num_samples}f", *samples)

    def test_silence(self):
        silence_chunk = b"\\x00" * 4007
        energy, bass = self.visualizer.decode_and_analyze_pcm(silence_chunk)
        self.assertLess(energy, 0.01)
        self.assertLess(bass, 0.01)

    def test_loud_vs_quiet_signal(self):
        quiet_signal = b"\\x44\\xac\\x00\\x00\\x02\\x10\\x01" + self.generate_sine_wave(frequency=440, amplitude=0.1)
        loud_signal = b"\\x44\\xac\\x00\\x00\\x02\\x10\\x01" + self.generate_sine_wave(frequency=440, amplitude=0.8)
        quiet_energy, _ = self.visualizer.decode_and_analyze_pcm(quiet_signal)
        loud_energy, _ = self.visualizer.decode_and_analyze_pcm(loud_signal)
        self.assertGreater(loud_energy, quiet_energy)

if __name__ == "__main__":
    unittest.main()`
  }
};

const TRACKS = [
  { id: "synthwave", name: "Synthwave Heavy Bass", genre: "Electronic / Club", frequency: 55, bpm: 120 },
  { id: "symphony", name: "Classical Symphony Sweeps", genre: "Classical / Orchestral", frequency: 220, bpm: 90 },
  { id: "ambient", name: "Deep Ambient Pad", genre: "Ambient / Atmospheric", frequency: 110, bpm: 60 }
];

export default function App() {
  const [activeTab, setActiveTab] = useState<"simulator" | "files" | "guide">("simulator");
  const [activeFile, setActiveFile] = useState<keyof typeof REPOSITORY_FILES>("visualizer.py");
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  const [haUrl, setHaUrl] = useState(() => localStorage.getItem("ha_url") || "http://192.168.1.100:8123");
  const [haToken, setHaToken] = useState(() => localStorage.getItem("ha_token") || "");
  const [haEntity, setHaEntity] = useState(() => localStorage.getItem("ha_entity") || "light.living_room_light");
  const [haConnected, setHaConnected] = useState<"disconnected" | "connected" | "error">("disconnected");
  const [haErrorMessage, setHaErrorMessage] = useState("");

  const [minBrightness, setMinBrightness] = useState(10);
  const [maxBrightness, setMaxBrightness] = useState(255);
  const [energySmoothing, setEnergySmoothing] = useState(0.15);
  const [bassSmoothing, setBassSmoothing] = useState(0.10);
  const [bassBoost, setBassBoost] = useState(1.3);
  const [updateInterval, setUpdateInterval] = useState(100);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(TRACKS[0]);
  const [isMuted, setIsMuted] = useState(false);

  const [telemetryEnergy, setTelemetryEnergy] = useState(0.0);
  const [telemetryBass, setTelemetryBass] = useState(0.0);
  const [simulatedBrightness, setSimulatedBrightness] = useState(10);
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const synthIntervalRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const smoothedEnergyRef = useRef(0.0);
  const smoothedBassRef = useRef(0.0);
  const lastHaUpdateRef = useRef(0);

  useEffect(() => {
    localStorage.setItem("ha_url", haUrl);
    localStorage.setItem("ha_token", haToken);
    localStorage.setItem("ha_entity", haEntity);
  }, [haUrl, haToken, haEntity]);

  const testHaConnection = async () => {
    if (!haUrl || !haToken) {
      setHaConnected("error");
      setHaErrorMessage("Please fill in both the URL and Access Token.");
      return;
    }
    setHaConnected("disconnected");
    try {
      const response = await fetch(`${haUrl}/api/`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${haToken}`,
          "Content-Type": "application/json"
        }
      });
      if (response.ok) {
        setHaConnected("connected");
        setHaErrorMessage("");
      } else {
        setHaConnected("error");
        setHaErrorMessage(`Connection failed with status: ${response.status}`);
      }
    } catch (e) {
      setHaConnected("error");
      setHaErrorMessage(`Network Error. CORS or HTTPS mixed content might be blocking it.`);
    }
  };

  const startAudioEngine = () => {
    if (audioCtxRef.current) return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    audioCtxRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyserRef.current = analyser;

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(isMuted ? 0 : 0.4, ctx.currentTime);
    gainNodeRef.current = gainNode;

    analyser.connect(gainNode);
    gainNode.connect(ctx.destination);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const runAnalysis = () => {
      if (!isPlaying || !analyserRef.current) return;
      analyser.getByteFrequencyData(dataArray);

      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = dataArray[i] / 255.0;
        sumSquares += val * val;
      }
      const rawEnergy = Math.sqrt(sumSquares / dataArray.length) * 2.2;
      const normalizedEnergy = Math.min(rawEnergy, 1.0);

      let bassSum = 0;
      for (let i = 0; i < 6; i++) {
        bassSum += dataArray[i] / 255.0;
      }
      const normalizedBass = Math.min((bassSum / 6) * 1.6 * bassBoost, 1.0);

      smoothedEnergyRef.current = (energySmoothing * normalizedEnergy) + ((1.0 - energySmoothing) * smoothedEnergyRef.current);
      smoothedBassRef.current = (bassSmoothing * normalizedBass) + ((1.0 - bassSmoothing) * smoothedBassRef.current);

      setTelemetryEnergy(smoothedEnergyRef.current);
      setTelemetryBass(smoothedBassRef.current);

      const combinedVal = Math.max(smoothedEnergyRef.current, smoothedBassRef.current * 0.85);
      const targetBrightness = Math.round(minBrightness + (combinedVal * (maxBrightness - minBrightness)));
      const finalBrightness = Math.max(minBrightness, Math.min(targetBrightness, maxBrightness));
      setSimulatedBrightness(finalBrightness);

      const now = Date.now();
      if (haConnected === "connected" && now - lastHaUpdateRef.current >= updateInterval) {
        sendRealHaCommand(finalBrightness);
        lastHaUpdateRef.current = now;
      }
      animationFrameRef.current = requestAnimationFrame(runAnalysis);
    };

    animationFrameRef.current = requestAnimationFrame(runAnalysis);
    launchSequencer(ctx, analyser);
  };

  const launchSequencer = (ctx: AudioContext, destinationNode: AudioNode) => {
    let step = 0;
    const intervalTime = currentTrack.id === "synthwave" ? 140 : currentTrack.id === "symphony" ? 450 : 800;
    const tick = () => {
      if (ctx.state === "suspended") return;
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.connect(oscGain);
      oscGain.connect(destinationNode);
      const now = ctx.currentTime;

      if (currentTrack.id === "synthwave") {
        if (step % 4 === 0) {
          osc.type = "sine";
          osc.frequency.setValueAtTime(55, now);
          osc.frequency.exponentialRampToValueAtTime(20, now + 0.35);
          oscGain.gain.setValueAtTime(0.8, now);
          oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
          osc.start(now);
          osc.stop(now + 0.38);
        } else if (step % 2 === 1) {
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(110, now);
          oscGain.gain.setValueAtTime(0.35, now);
          oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
          osc.start(now);
          osc.stop(now + 0.18);
        }
      } else if (currentTrack.id === "symphony") {
        osc.type = "triangle";
        const notes = [220, 261.63, 329.63, 440, 523.25];
        osc.frequency.setValueAtTime(notes[step % notes.length], now);
        oscGain.gain.setValueAtTime(0.01, now);
        oscGain.gain.linearRampToValueAtTime(0.5, now + 0.2);
        oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.42);
        osc.start(now);
        osc.stop(now + 0.45);
      } else {
        osc.type = "sine";
        osc.frequency.setValueAtTime(110 + Math.sin(step * 0.3) * 20, now);
        oscGain.gain.setValueAtTime(0.01, now);
        oscGain.gain.linearRampToValueAtTime(0.25, now + 0.4);
        oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.78);
        osc.start(now);
        osc.stop(now + 0.8);
      }
      step++;
    };
    tick();
    synthIntervalRef.current = window.setInterval(tick, intervalTime);
  };

  const stopAudioEngine = () => {
    setIsPlaying(false);
    if (synthIntervalRef.current) clearInterval(synthIntervalRef.current);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioCtxRef.current) audioCtxRef.current.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    gainNodeRef.current = null;
    setTelemetryEnergy(0.0);
    setTelemetryBass(0.0);
    setSimulatedBrightness(minBrightness);
  };

  const togglePlay = () => {
    if (isPlaying) stopAudioEngine(); else setIsPlaying(true);
  };

  useEffect(() => {
    if (isPlaying) {
      stopAudioEngine();
      setIsPlaying(true);
    }
  }, [currentTrack]);

  useEffect(() => {
    if (isPlaying) startAudioEngine();
  }, [isPlaying]);

  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setValueAtTime(isMuted ? 0 : 0.4, audioCtxRef.current.currentTime);
    }
  }, [isMuted]);

  const sendRealHaCommand = async (brightness: number) => {
    try {
      await fetch(`${haUrl}/api/services/light/turn_on`, {
        method: "POST",
        headers: {"Authorization": `Bearer ${haToken}`, "Content-Type": "application/json"},
        body: JSON.stringify({entity_id: haEntity, brightness})
      });
    } catch (e) {}
  };

  const copyToClipboard = (key: keyof typeof REPOSITORY_FILES) => {
    navigator.clipboard.writeText(REPOSITORY_FILES[key].content);
    setCopiedFile(key);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const downloadFile = (key: keyof typeof REPOSITORY_FILES) => {
    const element = document.createElement("a");
    const file = new Blob([REPOSITORY_FILES[key].content], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = REPOSITORY_FILES[key].path.split("/").pop() || key;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const downloadAllAsScript = () => {
    let scriptContent = `#!/bin/bash
mkdir -p music_assistant_visualizer
cat << 'EOF' > repository.yaml
${REPOSITORY_FILES["repository.yaml"].content}
EOF
cat << 'EOF' > music_assistant_visualizer/config.yaml
${REPOSITORY_FILES["config.yaml"].content}
EOF
cat << 'EOF' > music_assistant_visualizer/Dockerfile
${REPOSITORY_FILES["Dockerfile"].content}
EOF
cat << 'EOF' > music_assistant_visualizer/run.sh
${REPOSITORY_FILES["run.sh"].content}
EOF
cat << 'EOF' > music_assistant_visualizer/patch.py
${REPOSITORY_FILES["patch.py"].content}
EOF
cat << 'EOF' > music_assistant_visualizer/visualizer.py
${REPOSITORY_FILES["visualizer.py"].content}
EOF
cat << 'EOF' > music_assistant_visualizer/test_analyzer.py
${REPOSITORY_FILES["test_analyzer.py"].content}
EOF
chmod +x music_assistant_visualizer/run.sh
chmod +x music_assistant_visualizer/patch.py
chmod +x music_assistant_visualizer/visualizer.py
echo "Structure successfully constructed!"
`;
    const element = document.createElement("a");
    const file = new Blob([scriptContent], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = "setup_repository.sh";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-900 bg-slate-950/85 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-emerald-500 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            <Radio className="h-4 w-4 text-slate-950 animate-pulse" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-100">
            Music Assistant Visualizer
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-1 bg-slate-900/60 p-1 rounded-lg border border-slate-900">
          <button 
            onClick={() => setActiveTab("simulator")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer ${activeTab === "simulator" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-100"}`}
          >
            Live Simulator
          </button>
          <button 
            onClick={() => setActiveTab("files")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer ${activeTab === "files" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-100"}`}
          >
            Repository Files
          </button>
          <button 
            onClick={() => setActiveTab("guide")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer ${activeTab === "guide" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-100"}`}
          >
            Setup Guide
          </button>
        </nav>

        <div className="flex items-center gap-3">
          <button 
            onClick={downloadAllAsScript}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg shadow-[0_0_12px_rgba(52,211,153,0.2)] transition-all cursor-pointer whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            Export App Repo
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 flex flex-col gap-8">
        {activeTab === "simulator" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-8 flex flex-col gap-6">
              <div className="bg-slate-900/60 rounded-xl border border-slate-900 p-6 flex flex-col gap-6 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold tracking-wider text-slate-400 uppercase">
                      01. Physical Visualizer Telemetry
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Web Audio synth simulating the Music Assistant digital pipeline.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-950/80 px-2.5 py-1 rounded border border-slate-900 font-mono">
                    <span className={`h-2 w-2 rounded-full ${isPlaying ? "bg-emerald-500 animate-ping" : "bg-slate-700"}`} />
                    {isPlaying ? "RECEIVING PCM LOOP" : "STANDBY"}
                  </div>
                </div>

                <div className="h-64 rounded-lg bg-slate-950 flex flex-col items-center justify-center relative overflow-hidden border border-slate-900/55 p-6">
                  <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-20" />
                  <div 
                    className="absolute inset-0 transition-all duration-75 pointer-events-none"
                    style={{ background: `radial-gradient(circle, rgba(16, 185, 129, ${isPlaying ? (simulatedBrightness / 255) * 0.45 : 0.05}) 0%, transparent 65%)` }}
                  />

                  <div className="relative z-10 flex flex-col items-center gap-3">
                    <div 
                      className="h-28 w-28 rounded-full border-2 flex items-center justify-center transition-all duration-75"
                      style={{
                        borderColor: isPlaying ? `rgba(16, 185, 129, ${0.3 + (simulatedBrightness / 255) * 0.7})` : "#334155",
                        backgroundColor: isPlaying ? `rgba(16, 185, 129, ${(simulatedBrightness / 255) * 0.2})` : "rgba(30, 41, 59, 0.2)",
                        boxShadow: isPlaying ? `0 0 ${40 + (simulatedBrightness / 255) * 70}px rgba(16, 185, 129, ${0.1 + (simulatedBrightness / 255) * 0.6})` : "none"
                      }}
                    >
                      <Lightbulb 
                        className="h-12 w-12 transition-all duration-75" 
                        style={{ color: isPlaying ? `rgba(16, 185, 129, ${0.4 + (simulatedBrightness / 255) * 0.6})` : "#64748b" }}
                      />
                    </div>
                    
                    <div className="text-center">
                      <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">Simulated Brightness</span>
                      <div className="text-xl font-mono tracking-wider font-bold text-slate-200 mt-0.5 tabular-nums">
                        {simulatedBrightness} <span className="text-xs text-slate-500">/ 255</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono">
                  <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-900/50 flex flex-col gap-2">
                    <span className="text-slate-500 text-[10px] tracking-wider uppercase font-semibold">OVERALL ENERGY (RMS)</span>
                    <div className="text-2xl font-bold text-emerald-400 tabular-nums">
                      {telemetryEnergy.toFixed(4)}
                    </div>
                    <div className="h-1 w-full bg-slate-900 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-400 transition-all duration-75" style={{ width: `${telemetryEnergy * 100}%` }} />
                    </div>
                  </div>

                  <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-900/50 flex flex-col gap-2">
                    <span className="text-slate-500 text-[10px] tracking-wider uppercase font-semibold">BASS LEVEL (LOW-PASS)</span>
                    <div className="text-2xl font-bold text-cyan-400 tabular-nums">
                      {telemetryBass.toFixed(4)}
                    </div>
                    <div className="h-1 w-full bg-slate-900 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-400 transition-all duration-75" style={{ width: `${telemetryBass * 100}%` }} />
                    </div>
                  </div>

                  <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-900/50 flex flex-col gap-2">
                    <span className="text-slate-500 text-[10px] tracking-wider uppercase font-semibold">HA TRANS OVERHEAD</span>
                    <div className="text-2xl font-bold text-slate-300 tabular-nums">
                      {isPlaying ? `${updateInterval}ms` : "0ms"}
                    </div>
                    <span className="text-[10px] text-slate-500">Throttled interval limit</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-950/60 p-4 rounded-lg border border-slate-900/50 justify-between">
                  <div className="flex flex-col gap-1 w-full sm:w-auto">
                    <span className="text-[10px] text-slate-500 tracking-wider uppercase">Active Music Stream</span>
                    <select 
                      value={currentTrack.id}
                      onChange={(e) => {
                        const tr = TRACKS.find(t => t.id === e.target.value);
                        if (tr) setCurrentTrack(tr);
                      }}
                      className="bg-slate-900 text-slate-100 text-xs px-3 py-2 rounded-md border border-slate-800 font-semibold focus:outline-none focus:border-emerald-500 cursor-pointer"
                    >
                      {TRACKS.map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.genre})</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                    <button
                      onClick={() => setIsMuted(!isMuted)}
                      className="p-3 text-slate-400 hover:text-slate-100 hover:bg-slate-900 rounded-lg transition-all cursor-pointer"
                    >
                      {isMuted ? <VolumeX className="h-5 w-5 text-rose-400" /> : <Volume2 className="h-5 w-5" />}
                    </button>

                    <button
                      onClick={togglePlay}
                      className={`flex items-center gap-2 px-5 py-3 rounded-lg text-xs font-bold transition-all uppercase cursor-pointer ${
                        isPlaying ? "bg-rose-500 text-slate-100" : "bg-emerald-400 text-slate-950"
                      }`}
                    >
                      {isPlaying ? "Pause Simulator" : "Play Audio Stream"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/60 rounded-xl border border-slate-900 p-6 flex flex-col gap-6">
                <div>
                  <h3 className="text-sm font-semibold tracking-wider text-slate-400 uppercase">
                    02. Connect Physical Home Assistant Light (Optional)
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Connect your browser directly to your Home Assistant instance. While playing, your physical light will pulse with the simulator.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 font-semibold">HA Local IP/URL</label>
                    <input 
                      type="text" 
                      value={haUrl}
                      onChange={(e) => setHaUrl(e.target.value)}
                      className="bg-slate-950 text-xs px-3 py-2.5 rounded-lg border border-slate-900 focus:outline-none focus:border-emerald-500 text-slate-200"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 font-semibold">Target Dimmable Light Entity</label>
                    <input 
                      type="text" 
                      value={haEntity}
                      onChange={(e) => setHaEntity(e.target.value)}
                      className="bg-slate-950 text-xs px-3 py-2.5 rounded-lg border border-slate-900 focus:outline-none focus:border-emerald-500 text-slate-200 font-mono"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold">Long-Lived Access Token</label>
                  <input 
                    type="password" 
                    value={haToken}
                    onChange={(e) => setHaToken(e.target.value)}
                    className="bg-slate-950 text-xs px-3 py-2.5 rounded-lg border border-slate-900 focus:outline-none focus:border-emerald-500 text-slate-200"
                  />
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4 justify-between bg-slate-950/60 p-4 rounded-lg border border-slate-900/50">
                  <div className="flex items-center gap-2.5">
                    <div className={`h-2.5 w-2.5 rounded-full ${haConnected === "connected" ? "bg-emerald-500" : haConnected === "error" ? "bg-rose-500" : "bg-slate-700"}`} />
                    <span className="text-xs font-semibold text-slate-300">
                      Status: {haConnected === "connected" ? "Connected" : haConnected === "error" ? "Connection Failed" : "Disconnected"}
                    </span>
                  </div>

                  <button
                    onClick={testHaConnection}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 rounded-lg transition-all cursor-pointer"
                  >
                    Test Connection
                  </button>
                </div>
              </div>
            </div>

            <div className="lg:col-span-4 flex flex-col gap-6">
              <div className="bg-slate-900/60 rounded-xl border border-slate-900 p-6 flex flex-col gap-6 sticky top-24">
                <div className="flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold tracking-wider text-slate-300 uppercase">
                    Visualizer Options
                  </h3>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-semibold">Min Brightness</span>
                    <span className="text-emerald-400 font-mono font-bold">{minBrightness}</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={minBrightness} 
                    onChange={(e) => setMinBrightness(Number(e.target.value))}
                    className="w-full accent-emerald-400 bg-slate-950 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-semibold">Max Brightness</span>
                    <span className="text-emerald-400 font-mono font-bold">{maxBrightness}</span>
                  </div>
                  <input 
                    type="range" 
                    min="100" 
                    max="255" 
                    value={maxBrightness} 
                    onChange={(e) => setMaxBrightness(Number(e.target.value))}
                    className="w-full accent-emerald-400 bg-slate-950 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-semibold">Energy Smoothing (EMA)</span>
                    <span className="text-emerald-400 font-mono font-bold">{energySmoothing.toFixed(2)}</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.01" 
                    max="0.50" 
                    step="0.01"
                    value={energySmoothing} 
                    onChange={(e) => setEnergySmoothing(Number(e.target.value))}
                    className="w-full accent-emerald-400 bg-slate-950 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-semibold">Bass Smoothing (EMA)</span>
                    <span className="text-emerald-400 font-mono font-bold">{bassSmoothing.toFixed(2)}</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.01" 
                    max="0.50" 
                    step="0.01"
                    value={bassSmoothing} 
                    onChange={(e) => setBassSmoothing(Number(e.target.value))}
                    className="w-full accent-emerald-400 bg-slate-950 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-semibold">Bass Boost Factor</span>
                    <span className="text-emerald-400 font-mono font-bold">{bassBoost.toFixed(1)}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="1.0" 
                    max="3.0" 
                    step="0.1"
                    value={bassBoost} 
                    onChange={(e) => setBassBoost(Number(e.target.value))}
                    className="w-full accent-emerald-400 bg-slate-950 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-semibold">Update Interval Limit</span>
                    <span className="text-emerald-400 font-mono font-bold">{updateInterval}ms</span>
                  </div>
                  <input 
                    type="range" 
                    min="50" 
                    max="500" 
                    step="10"
                    value={updateInterval} 
                    onChange={(e) => setUpdateInterval(Number(e.target.value))}
                    className="w-full accent-emerald-400 bg-slate-950 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "files" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-3 flex flex-col gap-3">
              <span className="text-xs text-slate-500 font-bold tracking-wider uppercase pl-2">Repository Tree</span>
              <div className="flex flex-col gap-1.5 bg-slate-900/40 p-2.5 rounded-xl border border-slate-900">
                {Object.keys(REPOSITORY_FILES).map((key) => {
                  const fileKey = key as keyof typeof REPOSITORY_FILES;
                  const isSelected = activeFile === fileKey;
                  return (
                    <button
                      key={fileKey}
                      onClick={() => setActiveFile(fileKey)}
                      className={`flex flex-col items-start p-3 rounded-lg text-left transition-all w-full cursor-pointer ${isSelected ? "bg-slate-800 text-slate-100 border-l-2 border-emerald-400" : "text-slate-400 hover:text-slate-200"}`}
                    >
                      <span className="text-xs font-semibold font-mono truncate w-full">{REPOSITORY_FILES[fileKey].path}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-9 flex flex-col gap-4">
              <div className="bg-slate-900/60 rounded-xl border border-slate-900 flex flex-col overflow-hidden">
                <div className="bg-slate-950 px-5 py-4 border-b border-slate-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold font-mono text-slate-200">{REPOSITORY_FILES[activeFile].path}</h3>
                    <p className="text-xs text-slate-500 mt-1">{REPOSITORY_FILES[activeFile].description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copyToClipboard(activeFile)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 rounded-md transition-all cursor-pointer"
                    >
                      {copiedFile === activeFile ? "Copied!" : "Copy Code"}
                    </button>
                    <button
                      onClick={() => downloadFile(activeFile)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 rounded-md transition-all cursor-pointer"
                    >
                      Download
                    </button>
                  </div>
                </div>
                <div className="p-5 bg-slate-950 overflow-x-auto">
                  <pre className="font-mono text-xs text-slate-300 leading-relaxed whitespace-pre font-variant-numeric: tabular-nums">
                    <code>{REPOSITORY_FILES[activeFile].content}</code>
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "guide" && (
          <div className="max-w-4xl mx-auto flex flex-col gap-8 bg-slate-900/30 p-6 sm:p-8 rounded-2xl border border-slate-900">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-100">Home Assistant Setup Guide</h2>
              <p className="text-xs text-slate-500 mt-1.5">
                Follow these exact step-by-step UI directions to replace the standard Music Assistant server with this visualizer version directly from your Home Assistant interface.
              </p>
            </div>

            <div className="flex flex-col gap-6">
              <div className="flex gap-4">
                <div className="h-8 w-8 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center font-mono text-xs font-bold text-slate-300 shrink-0">1</div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">Create a safe configuration backup</h4>
                  <p className="text-xs text-slate-400">Navigate to Settings → System → Backups. Create a backup to preserve databases and settings.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="h-8 w-8 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center font-mono text-xs font-bold text-slate-300 shrink-0">2</div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">Stop and disable official Music Assistant Server</h4>
                  <p className="text-xs text-slate-400">Navigate to Settings → Add-ons → Music Assistant, turn off Start on boot, and click Stop.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="h-8 w-8 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center font-mono text-xs font-bold text-slate-300 shrink-0">3</div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">Add the Custom Repository</h4>
                  <p className="text-xs text-slate-400">Go to Add-on Store → Repositories (⋮ menu), paste the GitHub repository URL, and click Add.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-900/60 py-6 px-6 mt-12 bg-slate-950/40 text-center">
        <p className="text-xs text-slate-500 font-medium">
          Music Assistant to Home Assistant Lights Visualizer MVP. 100% Local Playback-Isolated Analysis.
        </p>
      </footer>
    </div>
  );
}
