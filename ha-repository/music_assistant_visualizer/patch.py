#!/usr/bin/env python3
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
        # Process helper where the AsyncProcess feeds stdin
        os.path.join(package_dir, "server", "helpers", "process.py"),
        os.path.join(package_dir, "helpers", "process.py"),
        # FFMpeg wrapper class
        os.path.join(package_dir, "server", "helpers", "ffmpeg.py"),
        os.path.join(package_dir, "helpers", "ffmpeg.py"),
        # Audio processing generator helpers
        os.path.join(package_dir, "server", "helpers", "audio.py"),
        os.path.join(package_dir, "helpers", "audio.py"),
    ]

    patched_any = False

    # The metadata-prepended non-blocking UDP socket tap code block
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
            # Limit UDP packet payload to 32000 bytes to prevent OS transmission exceptions
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

        # Check if already patched
        if "MUSIC ASSISTANT VISUALIZER TAP" in content:
            print(f"Already patched! Skipping: {target_path}")
            patched_any = True
            continue

        # Pattern 1: Feed stdin loop inside AsyncProcess / ffmpeg wrappers
        target_pattern = "async for chunk in self.audio_input:"
        if target_pattern in content:
            # We insert our tap code block right after the loop statement
            replacement = f"{target_pattern}{tap_code_template}"
            content = content.replace(target_pattern, replacement)
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Successfully patched stdin feeder in: {target_path}")
            patched_any = True
            continue

        # Pattern 2: Audio input loop where self isn't used
        target_pattern_alt = "async for chunk in audio_input:"
        if target_pattern_alt in content:
            replacement = f"{target_pattern_alt}{tap_code_template.replace('self', 'None')}"
            content = content.replace(target_pattern_alt, replacement)
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Successfully patched general chunk generator in: {target_path}")
            patched_any = True
            continue

        # Pattern 3: Standard yield chunk fallback inside audio.py
        target_yield = "        yield chunk"
        if target_yield in content and ("audio" in target_path or "ffmpeg" in target_path):
            replacement = f"{tap_code_template.replace('self', 'None')}\n        yield chunk"
            content = content.replace(target_yield, replacement)
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Successfully patched yield fallback in: {target_path}")
            patched_any = True
            continue

    if patched_any:
        print("Music Assistant codebase patched successfully! Audio flow will tap directly to Visualizer.")
    else:
        print("Error: Could not locate a secure audio tap injection point in any Music Assistant helper files.")
        sys.exit(1)

if __name__ == "__main__":
    main()
