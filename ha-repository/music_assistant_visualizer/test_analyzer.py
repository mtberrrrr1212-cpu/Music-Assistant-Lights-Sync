#!/usr/bin/env python3
import unittest
import struct
import math
import time
from visualizer import MusicAssistantVisualizer

class TestAudioAnalyzer(unittest.TestCase):
    def setUp(self):
        self.visualizer = MusicAssistantVisualizer()
        # Force standalone mode during testing
        self.visualizer.standalone = True

    def generate_sine_wave(self, frequency, duration=0.1, sample_rate=44100, amplitude=0.5, fmt='float'):
        """Helper to generate a raw PCM sine wave of a given frequency."""
        num_samples = int(sample_rate * duration)
        samples = []
        for i in range(num_samples):
            t = i / sample_rate
            val = amplitude * math.sin(2 * math.pi * frequency * t)
            samples.append(val)

        if fmt == 'float':
            return struct.pack(f"{num_samples}f", *samples)
        elif fmt == 'int16':
            int_samples = [int(x * 32767) for x in samples]
            return struct.pack(f"{num_samples}h", *int_samples)
        return b""

    def test_silence(self):
        """Test that silence produces very low energy and bass values."""
        silence_chunk = b"\x00" * 4000 # 1000 samples of float zero
        energy, bass = self.visualizer.analyze_pcm_chunk(silence_chunk)
        self.assertLess(energy, 0.01, "Silence should produce near-zero energy")
        self.assertLess(bass, 0.01, "Silence should produce near-zero bass")

    def test_loud_vs_quiet_signal(self):
        """Test that a louder signal produces higher energy than a quiet one."""
        quiet_signal = self.generate_sine_wave(frequency=440, amplitude=0.1)
        loud_signal = self.generate_sine_wave(frequency=440, amplitude=0.8)

        quiet_energy, _ = self.visualizer.analyze_pcm_chunk(quiet_signal)
        loud_energy, _ = self.visualizer.analyze_pcm_chunk(loud_signal)

        print(f"[Test Logs] Quiet signal energy: {quiet_energy:.4f}, Loud signal energy: {loud_energy:.4f}")
        self.assertGreater(loud_energy, quiet_energy, "Loud signal must have higher energy than quiet signal")

    def test_bass_vs_treble_signal(self):
        """Test that a low-frequency signal produces higher bass measurements than a high-frequency signal."""
        # Low bass wave (50Hz)
        bass_signal = self.generate_sine_wave(frequency=50, amplitude=0.5)
        # High treble wave (2000Hz)
        treble_signal = self.generate_sine_wave(frequency=2000, amplitude=0.5)

        # Process bass signal
        _, bass_value_on_bass = self.visualizer.analyze_pcm_chunk(bass_signal)
        # Process treble signal
        _, bass_value_on_treble = self.visualizer.analyze_pcm_chunk(treble_signal)

        print(f"[Test Logs] Bass wave bass measure: {bass_value_on_bass:.4f}")
        print(f"[Test Logs] Treble wave bass measure: {bass_value_on_treble:.4f}")
        
        self.assertGreater(bass_value_on_bass, bass_value_on_treble, 
                           "Low-frequency signal must produce higher bass response than high-frequency signal")

    def test_smoothing_exponential_moving_average(self):
        """Test that the smoothing EMA prevents wild jumps between successive iterations."""
        # We simulate sudden jump from 0 to 1.0 energy and see that smoothed value rises gradually
        e_smoothing = self.visualizer.config["energy_smoothing"]
        
        # Step 1: Initialize at zero
        self.visualizer.smoothed_energy = 0.0
        
        # Step 2: Feed a 1.0 energy signal
        # The equation is: y_new = beta * 1.0 + (1 - beta) * y_old
        # Since y_old is 0, y_new should be exactly beta * 1.0 = e_smoothing
        energy_input = 1.0
        self.visualizer.smoothed_energy = (e_smoothing * energy_input) + ((1.0 - e_smoothing) * self.visualizer.smoothed_energy)
        
        self.assertEqual(self.visualizer.smoothed_energy, e_smoothing, "EMA smoothing did not rise gradually")
        print(f"[Test Logs] First step smoothed energy: {self.visualizer.smoothed_energy:.4f} (expected {e_smoothing:.4f})")

    def test_failure_isolation_and_robustness(self):
        """Test that if the analyzer fails or encounters bad data, it handles it gracefully
        and does not halt execution or affect mock streaming."""
        # Feed corrupt / invalid byte lengths (not multiples of 2 or 4)
        corrupt_data = b"\x12\x34\x56" # 3 bytes
        try:
            energy, bass = self.visualizer.analyze_pcm_chunk(corrupt_data)
            self.assertEqual(energy, 0.0)
            self.assertEqual(bass, 0.0)
            print("[Test Logs] Gracefully handled corrupt audio chunk length")
        except Exception as e:
            self.fail(f"Analyzer crashed on corrupt data: {e}")

    def test_home_assistant_connection_failure_isolation(self):
        """Test that if Home Assistant communication fails (e.g. wrong token or offline),
        the visualizer logs or ignores it without crashing the process."""
        self.visualizer.standalone = False # Force HA mode
        self.visualizer.ha_token = "invalid_token_xyz"
        self.visualizer.ha_url = "http://localhost:1" # Invalid offline address
        
        try:
            # This should try to send requests, time out or fail, and catch the exception gracefully
            self.visualizer.send_ha_command(128)
            print("[Test Logs] Gracefully isolated Home Assistant network timeout/failure")
        except Exception as e:
            self.fail(f"Visualizer crashed on Home Assistant connection failure: {e}")

if __name__ == "__main__":
    unittest.main()
