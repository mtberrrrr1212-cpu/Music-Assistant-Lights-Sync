#!/usr/bin/env python3
import os
import sys
import json
import socket
import struct
import array
import time
import urllib.request
import threading
import math

class MusicAssistantVisualizer:
    def __init__(self, diagnostic_mode=False):
        self.diagnostic_mode = diagnostic_mode
        self.load_config()
        self.udp_host = "127.0.0.1"
        self.udp_port = 9999
        self.running = True
        
        # Audio Analysis State
        self.current_energy = 0.0
        self.current_bass = 0.0
        self.lpf_state = 0.0
        self.lpf_alpha = 0.02
        self.smoothed_energy = 0.0
        self.smoothed_bass = 0.0
        
        # Stream Continuity State
        self.expected_seq = -1
        self.last_audio_received = 0
        self.is_playing = False
        
        # Diagnostics
        self.packets_sec = 0
        self.bytes_sec = 0
        self.analyzer_errors = 0
        self.dropped_packets = 0
        self.last_diagnostic_print = 0
        self.last_header_info = "Unknown"
        self.current_duration_ms = 0.0
        
        # Throttling
        self.last_ha_update = 0
        self.last_brightness = -1
        
        # Setup Home Assistant headers
        # Use SUPERVISOR_TOKEN provided by Home Assistant Add-on environment
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

    def send_ha_request(self, endpoint, payload):
        """Sends service call to Home Assistant using standard library urllib (local network only)."""
        if self.standalone: return
        
        url = f"{self.ha_url}/services/light/{endpoint}"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Authorization", f"Bearer {self.ha_token}")
        req.add_header("Content-Type", "application/json")
        
        try:
            # Short timeout to ensure playback is never blocked
            with urllib.request.urlopen(req, timeout=0.15) as response:
                pass
        except Exception:
            # Absolute isolation: ignore all HA network failures
            pass

    def send_ha_command(self, brightness):
        self.send_ha_request("turn_on", {
            "entity_id": self.config["light_entity"],
            "brightness": int(brightness)
        })

    def turn_off_light(self):
        self.send_ha_request("turn_off", {
            "entity_id": self.config["light_entity"]
        })
        if not self.diagnostic_mode:
            print(f"[Visualizer] Audio flow stopped. Dimmed {self.config['light_entity']}.")

    def decode_and_analyze_pcm(self, data):
        if len(data) < 16:
            self.analyzer_errors += 1
            return 0.0, 0.0
        try:
            seq, idx, total, rate, ch, depth, pcm_type, _ = struct.unpack("<IHHIBBBB", data[:16])
            payload = data[16:]
            
            # Sequence Tracking
            if self.expected_seq != -1:
                gap = (seq - self.expected_seq) % 0xFFFFFFFF
                if gap > 0: self.dropped_packets += gap
            self.expected_seq = (seq + 1) % 0xFFFFFFFF
            
            # Dynamic Duration Logic
            self.last_header_info = f"{'F32LE' if pcm_type==1 else 'S16LE' if pcm_type==2 else 'S24LE'} | {rate}Hz | {ch}ch"
            bytes_per_sample = max(1, depth // 8)
            bytes_per_frame = ch * bytes_per_sample
            if rate > 0 and bytes_per_frame > 0:
                self.current_duration_ms = (len(payload) / (rate * bytes_per_frame)) * 1000.0

            # Cutoff 150Hz
            fc = 150.0
            dt = 1.0 / max(rate, 8000)
            rc = 1.0 / (2.0 * math.pi * fc)
            self.lpf_alpha = dt / (rc + dt)

            samples = []
            if pcm_type == 1:
                num = len(payload) // 4
                if num > 0:
                    arr = array.array('f')
                    arr.frombytes(payload[:num*4])
                    samples = list(arr)
            elif pcm_type == 2:
                num = len(payload) // 2
                if num > 0:
                    arr = array.array('h')
                    arr.frombytes(payload[:num*2])
                    samples = [x / 32768.0 for x in arr]
            elif pcm_type == 3:
                num = len(payload) // 3
                for i in range(num):
                    s = payload[i*3 : (i+1)*3]
                    sb = b'\xff' if s[2] & 0x80 else b'\x00'
                    val = struct.unpack("<i", s + sb)[0]
                    samples.append(val / 8388608.0)
            
            if not samples: return 0.0, 0.0

            # RMS Energy
            rms = math.sqrt(sum(x*x for x in samples) / len(samples))
            energy = min(rms * 2.5, 1.0)

            # LPF Bass
            bass_samples = []
            for x in samples:
                self.lpf_state = self.lpf_alpha * x + (1.0 - self.lpf_alpha) * self.lpf_state
                bass_samples.append(self.lpf_state)
            
            bass_rms = math.sqrt(sum(x*x for x in bass_samples) / len(bass_samples))
            bass = min(bass_rms * 3.5 * self.config["bass_boost_factor"], 1.0)
            return energy, bass
        except Exception:
            self.analyzer_errors += 1
            return 0.0, 0.0

    def print_diagnostics(self):
        now = time.time()
        if now - self.last_diagnostic_print >= 1.0:
            status = "ACTIVE" if self.is_playing else "STANDBY"
            print("\n" + "="*50)
            print("         MUSIC ASSISTANT AUDIO TAP DIAGNOSTICS      ")
            print("="*50)
            print(f"Status:             {status}")
            print(f"Stream:             {self.last_header_info}")
            print(f"Packet Duration:    {self.current_duration_ms:.2f} ms")
            print(f"Throughput:         {self.bytes_sec / 1024:.2f} KB/s")
            print(f"Packets/sec:        {self.packets_sec}")
            print(f"Dropped Packets:    {self.dropped_packets}")
            print(f"Energy (RMS):       {self.current_energy:.4f} (Smoothed: {self.smoothed_energy:.4f})")
            print(f"Bass (LPF):         {self.current_bass:.4f} (Smoothed: {self.smoothed_bass:.4f})")
            print(f"Errors:             {self.analyzer_errors}")
            print("="*50)
            self.packets_sec = self.bytes_sec = 0
            self.last_diagnostic_print = now

    def playback_monitor(self):
        while self.running:
            time.sleep(1.0)
            if self.is_playing and (time.time() - self.last_audio_received > 3.0):
                self.is_playing = False
                self.turn_off_light()
                self.smoothed_energy = self.smoothed_bass = 0.0
                self.expected_seq = -1

    def listen_loop(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try: sock.bind((self.udp_host, self.udp_port))
        except Exception: self.running = False; return
        sock.settimeout(0.5)
        threading.Thread(target=self.playback_monitor, daemon=True).start()
        self.last_diagnostic_print = time.time()
        while self.running:
            try:
                data, _ = sock.recvfrom(2048)
                self.last_audio_received = time.time()
                self.packets_sec += 1
                self.bytes_sec += len(data)
                if not self.is_playing: self.is_playing = True
                energy, bass = self.decode_and_analyze_pcm(data)
                self.current_energy, self.current_bass = energy, bass
                es, bs = self.config["energy_smoothing"], self.config["bass_smoothing"]
                self.smoothed_energy = (es * energy) + ((1.0 - es) * self.smoothed_energy)
                self.smoothed_bass = (bs * bass) + ((1.0 - bs) * self.smoothed_bass)
                if self.diagnostic_mode: self.print_diagnostics(); continue
                now = time.time()
                if now - self.last_ha_update >= self.config["update_interval"]:
                    min_b, max_b = self.config["min_brightness"], self.config["max_brightness"]
                    val = max(self.smoothed_energy, self.smoothed_bass * 0.8)
                    bri = int(min_b + (val * (max_b - min_b)))
                    bri = max(min_b, min(bri, max_b))
                    if abs(bri - self.last_brightness) >= 3 or (bri == min_b and self.last_brightness != min_b):
                        self.send_ha_command(bri); self.last_brightness = bri
                    self.last_ha_update = now
            except socket.timeout:
                if self.diagnostic_mode: self.print_diagnostics()
            except Exception: self.analyzer_errors += 1; time.sleep(0.5)
        sock.close()

if __name__ == "__main__":
    is_diag = "--diagnostic" in sys.argv
    visualizer = MusicAssistantVisualizer(diagnostic_mode=is_diag)
    try: visualizer.listen_loop()
    except KeyboardInterrupt: visualizer.running = False
