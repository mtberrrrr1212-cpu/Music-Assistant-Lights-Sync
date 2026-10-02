#!/usr/bin/env python3
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
        # 16-byte header + zeros
        # IHHIBBBB: seq=0, idx=0, tot=1, rate=44100, ch=2, depth=32, type=1 (float), res=0
        header = struct.pack("<IHHIBBBB", 0, 0, 1, 44100, 2, 32, 1, 0)
        silence_chunk = header + (b"\\x00" * 4000)
        energy, bass = self.visualizer.decode_and_analyze_pcm(silence_chunk)
        self.assertLess(energy, 0.01)
        self.assertLess(bass, 0.01)

    def test_loud_vs_quiet_signal(self):
        header = struct.pack("<IHHIBBBB", 0, 0, 1, 44100, 2, 32, 1, 0)
        quiet_signal = header + self.generate_sine_wave(frequency=440, amplitude=0.1)
        loud_signal = header + self.generate_sine_wave(frequency=440, amplitude=0.8)
        quiet_energy, _ = self.visualizer.decode_and_analyze_pcm(quiet_signal)
        loud_energy, _ = self.visualizer.decode_and_analyze_pcm(loud_signal)
        self.assertGreater(loud_energy, quiet_energy)

    def test_packetization_reconstruction(self):
        """
        Verifies that multiple UDP packets representing a split PCM block 
        are processed as a continuous stream.
        """
        # Generate 0.2s of audio
        full_pcm = self.generate_sine_wave(frequency=440, amplitude=0.5, duration=0.2)
        payload_max = 1000
        total_packets = (len(full_pcm) + payload_max - 1) // payload_max
        
        energies = []
        for i in range(total_packets):
            start = i * payload_max
            end = min(start + payload_max, len(full_pcm))
            subchunk = full_pcm[start:end]
            # seq incrementing, index=i, tot=total_packets
            header = struct.pack("<IHHIBBBB", i, i, total_packets, 44100, 2, 32, 1, 0)
            energy, _ = self.visualizer.decode_and_analyze_pcm(header + subchunk)
            if energy > 0: energies.append(energy)
            
        self.assertGreater(len(energies), 0)
        # Check that energy is relatively consistent across chunks for a sine wave
        avg_energy = sum(energies) / len(energies)
        for e in energies:
            self.assertAlmostEqual(e, avg_energy, delta=0.05)

    def test_dropped_packet_recovery(self):
        """Verifies that the analyzer continues gracefully when a packet is dropped."""
        self.visualizer.expected_seq = 0
        self.visualizer.dropped_packets = 0
        
        # Packet 1 (seq 0)
        h1 = struct.pack("<IHHIBBBB", 0, 0, 2, 44100, 2, 32, 1, 0)
        self.visualizer.decode_and_analyze_pcm(h1 + b"\\x00"*100)
        
        # Drop seq 1, receive seq 2
        h2 = struct.pack("<IHHIBBBB", 2, 0, 2, 44100, 2, 32, 1, 0)
        self.visualizer.decode_and_analyze_pcm(h2 + b"\\x00"*100)
        
        self.assertEqual(self.visualizer.dropped_packets, 1)
        self.assertEqual(self.visualizer.expected_seq, 3)

    def test_packetization_reconstruction(self):
        """Verify that multiple UDP-style packets for a single block are processed correctly."""
        # Simulate a 16kHz Mono S16LE block split into 2 packets
        rate, ch, depth, pcm_type = 16000, 1, 16, 2
        
        # 1000 samples of a 440Hz sine wave
        samples = [math.sin(2 * math.pi * 440 * i / rate) for i in range(1000)]
        pcm_data = struct.pack("<" + "h"*1000, *[int(x * 32767) for x in samples])
        
        # Split into 2 packets
        mid = len(pcm_data) // 2
        p1_payload = pcm_data[:mid]
        p2_payload = pcm_data[mid:]
        
        # Headers: sequence=100, indices 0 and 1, total=2
        h1 = struct.pack("<IHHIBBBB", 100, 0, 2, rate, ch, depth, pcm_type, 0)
        h2 = struct.pack("<IHHIBBBB", 101, 1, 2, rate, ch, depth, pcm_type, 0)
        
        e1, b1 = self.visualizer.decode_and_analyze_pcm(h1 + p1_payload)
        e2, b2 = self.visualizer.decode_and_analyze_pcm(h2 + p2_payload)
        
        # Both should return non-zero energy if sine wave is present
        self.assertGreater(e1, 0)
        self.assertGreater(e2, 0)
        self.assertEqual(self.visualizer.dropped_packets, 0)

    def test_drop_resilience(self):
        """Verify that missing packets increase the drop counter but don't crash."""
        rate, ch, depth, pcm_type = 44100, 2, 16, 2
        h1 = struct.pack("<IHHIBBBB", 200, 0, 1, rate, ch, depth, pcm_type, 0)
        h2 = struct.pack("<IHHIBBBB", 205, 0, 1, rate, ch, depth, pcm_type, 0)
        
        self.visualizer.decode_and_analyze_pcm(h1 + b'\x00'*100)
        self.visualizer.decode_and_analyze_pcm(h2 + b'\x00'*100)
        
        self.assertEqual(self.visualizer.dropped_packets, 4) # 201, 202, 203, 204 are missing

if __name__ == "__main__":
    unittest.main()
