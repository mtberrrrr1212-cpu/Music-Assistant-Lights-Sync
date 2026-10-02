# Use the base image provided by the build system
ARG BUILD_FROM
FROM ${BUILD_FROM}

# Set system shell for execution
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

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
