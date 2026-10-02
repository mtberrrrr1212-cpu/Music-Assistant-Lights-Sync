FROM ghcr.io/music-assistant/server:stable

# Set system shell for execution
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Add Home Assistant Labels
LABEL \
  io.hass.name="Music Assistant Visualizer" \
  io.hass.description="High-performance digital audio visualizer for Music Assistant" \
  io.hass.type="addon"

# Create application directory
RUN mkdir -p /app

# Copy custom patches and visualizer code
COPY patch.py /app/patch.py
COPY visualizer.py /app/visualizer.py
COPY run.sh /run.sh

# Make scripts executable
RUN chmod +x /app/patch.py \
    && chmod +x /app/visualizer.py \
    && chmod +x /run.sh

# Execute the run.sh script as the entrypoint
ENTRYPOINT [ "/run.sh" ]
