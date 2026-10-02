#!/usr/bin/env python3
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
        if self.diagnostic_mode:
            print("[Diagnostic] Running in audio stream diagnostic telemetry mode.")
        else:
            print("[Visualizer] Initializing Music Assistant Visualizer...")
            
        self.load_config()
        
        # UDP Socket configuration
        self.udp_host = "127.0.0.1"
        self.udp_port = 9999
        self.running = True
        
        # Audio Analysis State
        self.current_energy = 0.0
        self.current_bass = 0.0
        
        # Digital filter states
        self.lpf_state = 0.0
        self.lpf_alpha = 0.02  # Initial default, will be adjusted dynamically by sample_rate!
        
        # Smoothed values for lighting
        self.smoothed_energy = 0.0
        self.smoothed_bass = 0.0
        
        # Throttling & Home Assistant State
        self.last_ha_update = 0
        self.last_brightness = -1
        self.is_playing = False
        self.last_audio_received = 0
        
        # Diagnostic Counters
        self.packets_sec = 0
        self.bytes_sec = 0
        self.analyzer_errors = 0
        self.last_diagnostic_print = 0
        self.last_header_info = "Unknown"
        
        # Setup Home Assistant headers
        self.ha_token = os.environ.get("SUPERVISOR_TOKEN", "")
        self.ha_url = "http://supervisor/core/api"
        
        if self.diagnostic_mode:
            self.standalone = True
        elif not self.ha_token:
            print("[Visualizer] WARNING: SUPERVISOR_TOKEN not found. Running in standalone simulator mode.")
            self.standalone = True
        else:
            self.standalone = False
            print("[Visualizer] Connected to Home Assistant Supervisor API.")

    def load_config(self):
        # Default options matching config.yaml
        self.config = {
            "light_entity": "light.living_room",
            "update_interval": 0.1,
            "min_brightness": 10,
            "max_brightness": 255,
            "energy_smoothing": 0.15,
            "bass_smoothing": 0.10,
            "bass_boost_factor": 1.3
        }
        
        # Try to load Home Assistant Add-on config
        options_path = "/data/options.json"
        if os.path.exists(options_path):
            try:
                with open(options_path, "r") as f:
                    user_config = json.load(f)
                    self.config.update(user_config)
                if not self.diagnostic_mode:
                    print(f"[Visualizer] Loaded user configuration: {self.config}")
            except Exception as e:
                if not self.diagnostic_mode:
                    print(f"[Visualizer] Error loading config: {e}. Using defaults.")
        else:
            if not self.diagnostic_mode:
                print("[Visualizer] No options.json found, using default configuration.")

    def send_ha_command(self, brightness):
        """Sends light command to Home Assistant with error isolation."""
        if self.standalone or self.diagnostic_mode:
            return

        url = f"{self.ha_url}/services/light/turn_on"
        headers = {
            "Authorization": f"Bearer {self.ha_token}",
            "Content-Type": "application/json"
        }
        payload = {
            "entity_id": self.config["light_entity"],
            "brightness": int(brightness)
        }
        
        try:
            # We set a fast timeout to never block the main playback loop
            response = requests.post(url, headers=headers, json=payload, timeout=0.15)
        except Exception:
            # Isolation: if Home Assistant is down, timeout, or refuses, playback is unaffected.
            pass

    def turn_off_light(self):
        """Turns off the light when playback stops."""
        if self.standalone or self.diagnostic_mode:
            return
            
        url = f"{self.ha_url}/services/light/turn_off"
        headers = {
            "Authorization": f"Bearer {self.ha_token}",
            "Content-Type": "application/json"
        }
        payload = {
            "entity_id": self.config["light_entity"]
        }
        try:
            requests.post(url, headers=headers, json=payload, timeout=0.2)
            print(f"[Visualizer] Playback stopped. Dimmed/turned off light: {self.config['light_entity']}")
        except Exception:
            pass

    def decode_and_analyze_pcm(self, data):
        """Unpacks 7-byte metadata header and decodes raw PCM bytes mathematically."""
        if len(data) < 7:
            self.analyzer_errors += 1
            return 0.0, 0.0

        try:
            # Unpack 7-byte metadata header injected by our patch
            # < = little endian, I = unsigned int (4B), B = unsigned char (1B)
            sample_rate, channels, bit_depth, pcm_type = struct.unpack("<IBBB", data[:7])
            payload = data[7:]
            
            # Keep sample rate, channels, bit depth for diagnostics
            format_name = "F32LE" if pcm_type == 1 else "S16LE" if pcm_type == 2 else "S24LE" if pcm_type == 3 else "Unknown"
            self.last_header_info = f"{format_name} | {sample_rate}Hz | {channels}ch | {bit_depth}-bit"

            # Dynamically recalculate our First-Order low-pass filter alpha based on the incoming sample_rate!
            # fc = 150Hz. dt = 1.0 / sample_rate. alpha = 2 * pi * dt * fc / (2 * pi * dt * fc + 1)
            # This ensures that our Bass filter cutoff is mathematically consistent across different songs!
            fc = 150.0
            dt = 1.0 / max(sample_rate, 8000)
            rc = 1.0 / (2.0 * math.pi * fc)
            self.lpf_alpha = dt / (rc + dt)

            samples = []
            
            if pcm_type == 1:
                # 32-bit Float PCM - decode using C-optimized array module
                # 'f' represents C float type (4 bytes)
                num_floats = len(payload) // 4
                if num_floats > 0:
                    samples_arr = array.array('f')
                    samples_arr.frombytes(payload[:num_floats * 4])
                    samples = list(samples_arr)
                    
            elif pcm_type == 2:
                # 16-bit Signed Integer PCM - decode using array module
                # 'h' represents C signed short type (2 bytes)
                num_shorts = len(payload) // 2
                if num_shorts > 0:
                    shorts_arr = array.array('h')
                    shorts_arr.frombytes(payload[:num_shorts * 2])
                    # Normalize to [-1.0, 1.0] range
                    samples = [x / 32768.0 for x in shorts_arr]
                    
            elif pcm_type == 3:
                # 24-bit Signed Integer PCM (3 bytes per sample) - manual decode with structural sign padding
                num_samples = len(payload) // 3
                for i in range(num_samples):
                    slice_3 = payload[i*3 : (i+1)*3]
                    # Sign extension: pad with 0xFF if sign bit is set, else 0x00
                    sign_byte = b'\xff' if slice_3[2] & 0x80 else b'\x00'
                    val = struct.unpack("<i", slice_3 + sign_byte)[0]
                    # Normalize to [-1.0, 1.0]
                    samples.append(val / 8388608.0)
            else:
                self.analyzer_errors += 1
                return 0.0, 0.0

            if not samples:
                return 0.0, 0.0

            # Calculate continuous overall RMS Energy
            sum_squares = sum(x * x for x in samples)
            rms = math.sqrt(sum_squares / len(samples))
            # Scale up normalized energy to make it reactive
            energy = min(rms * 2.5, 1.0)

            # Apply Software IIR Low-Pass Filter for Bass extraction
            # y[n] = alpha * x[n] + (1 - alpha) * y[n-1]
            bass_samples = []
            for x in samples:
                self.lpf_state = self.lpf_alpha * x + (1.0 - self.lpf_alpha) * self.lpf_state
                bass_samples.append(self.lpf_state)
                
            sum_bass_squares = sum(x * x for x in bass_samples)
            bass_rms = math.sqrt(sum_bass_squares / len(bass_samples))
            bass = min(bass_rms * 3.5 * self.config["bass_boost_factor"], 1.0)

            return energy, bass

        except Exception as e:
            self.analyzer_errors += 1
            return 0.0, 0.0

    def print_diagnostics_report(self):
        """Prints a comprehensive text-based real-time diagnostic summary report."""
        now = time.time()
        if now - self.last_diagnostic_print >= 1.0:
            status_str = "ACTIVE PLAYBACK" if self.is_playing else "STANDBY"
            print("\n" + "="*50)
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
            
            # Reset counters for the next second
            self.packets_sec = 0
            self.bytes_sec = 0
            self.last_diagnostic_print = now

    def playback_monitor_thread(self):
        """Timeout monitor. Stops transmitting and dims lights if audio stops flowing."""
        if not self.diagnostic_mode:
            print("[Visualizer] Started playback monitor thread.")
        while self.running:
            time.sleep(1.0)
            now = time.time()
            if self.is_playing and (now - self.last_audio_received > 3.0):
                if self.diagnostic_mode:
                    print("[Diagnostic] Audio flow timeout. Standing by...")
                else:
                    print("[Visualizer] No audio stream detected for 3 seconds. Dimming/turning off lights.")
                self.is_playing = False
                self.turn_off_light()
                self.smoothed_energy = 0.0
                self.smoothed_bass = 0.0
                self.last_brightness = -1

    def listen_loop(self):
        """Main UDP audio listen and Home Assistant control loop."""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.bind((self.udp_host, self.udp_port))
            if not self.diagnostic_mode:
                print(f"[Visualizer] Listening for digital PCM audio on udp://{self.udp_host}:{self.udp_port}")
            else:
                print(f"[Diagnostic] Listening on udp://{self.udp_host}:{self.udp_port}. Waiting for Music Assistant audio...")
        except Exception as e:
            print(f"[Visualizer] CRITICAL Error binding socket: {e}")
            self.running = False
            return

        sock.settimeout(0.5)  # Keep loop responsive
        
        # Start playback timeout monitor
        monitor = threading.Thread(target=self.playback_monitor_thread, daemon=True)
        monitor.start()

        self.last_diagnostic_print = time.time()

        while self.running:
            try:
                data, addr = sock.recvfrom(65535) # Max UDP packet buffer size
                self.last_audio_received = time.time()
                
                # Keep rate diagnostics
                self.packets_sec += 1
                self.bytes_sec += len(data)
                
                # Turn on / Mark playing when audio starts flowing
                if not self.is_playing:
                    if self.diagnostic_mode:
                        print("[Diagnostic] Audio flow detected! Starting telemetry output...")
                    else:
                        print("[Visualizer] Audio flow detected! Starting lighting synchronization...")
                    self.is_playing = True

                # Analyze raw continuous PCM
                energy, bass = self.decode_and_analyze_pcm(data)
                self.current_energy = energy
                self.current_bass = bass
                
                # Apply Exponential Moving Average (EMA) for butter-smooth fading
                e_smoothing = self.config["energy_smoothing"]
                b_smoothing = self.config["bass_smoothing"]
                
                self.smoothed_energy = (e_smoothing * energy) + ((1.0 - e_smoothing) * self.smoothed_energy)
                self.smoothed_bass = (b_smoothing * bass) + ((1.0 - b_smoothing) * self.smoothed_bass)
                
                # If diagnostic mode, print reports
                if self.diagnostic_mode:
                    self.print_diagnostics_report()
                    continue
                
                # Coalesce Home Assistant light API calls
                now = time.time()
                if now - self.last_ha_update >= self.config["update_interval"]:
                    min_b = self.config["min_brightness"]
                    max_b = self.config["max_brightness"]
                    
                    combined_energy = max(self.smoothed_energy, self.smoothed_bass * 0.8)
                    brightness = int(min_b + (combined_energy * (max_b - min_b)))
                    brightness = max(min_b, min(brightness, max_b))
                    
                    # Prevent Zigbee spam on micro-fluctuations
                    if abs(brightness - self.last_brightness) >= 3 or (brightness == min_b and self.last_brightness != min_b):
                        self.send_ha_command(brightness)
                        self.last_brightness = brightness
                        
                    self.last_ha_update = now

            except socket.timeout:
                if self.diagnostic_mode:
                    self.print_diagnostics_report()
            except Exception as e:
                self.analyzer_errors += 1
                if not self.diagnostic_mode:
                    print(f"[Visualizer] Loop Error: {e}")
                time.sleep(0.5)

        sock.close()
        if not self.diagnostic_mode:
            print("[Visualizer] Shutdown completed.")

if __name__ == "__main__":
    # Check for diagnostic flag
    is_diag = "--diagnostic" in sys.argv
    visualizer = MusicAssistantVisualizer(diagnostic_mode=is_diag)
    try:
        visualizer.listen_loop()
    except KeyboardInterrupt:
        print("\n[Visualizer] Exiting...")
        visualizer.running = False
