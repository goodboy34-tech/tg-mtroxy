#!/bin/bash
set -e

# Installation script path
SCRIPT_PATH="/usr/local/bin/install-node.sh"

# If script is run from URL, install it locally first
if [ ! -f "$SCRIPT_PATH" ] || [ "$0" != "$SCRIPT_PATH" ]; then
    echo "========================================================"
    echo "  Installing MTProxy Node Script"
    echo "========================================================"
    echo ""

    # Root check
    if [ "$EUID" -ne 0 ]; then
        echo "X Run script with root privileges:"
        echo "   sudo bash <(curl -fsSL https://raw.githubusercontent.com/goodboy34-tech/eeee/master/install-node.sh)"
        exit 1
    fi

    echo "* Downloading script to $SCRIPT_PATH..."
    curl -fsSL https://raw.githubusercontent.com/goodboy34-tech/eeee/master/install-node.sh -o "$SCRIPT_PATH"
    chmod +x "$SCRIPT_PATH"

    echo "-> Script installed successfully!"
    echo ""
    echo "Now running the installation..."
    echo ""
    exec "$SCRIPT_PATH" "$@"
    exit 0
fi

echo "========================================================"
echo "  MTProxy Node - Installation"
echo "========================================================"
echo ""

# Root check
if [ "$EUID" -ne 0 ]; then
    echo "X Run script with root privileges:"
    echo "   sudo $SCRIPT_PATH"
    exit 1
fi

# Installation directory
INSTALL_DIR="/opt/mtproxy-node"

# Create systemd service function
create_systemd_service() {
    echo "* Creating systemd service..."

    cat > /etc/systemd/system/mtproxy-node.service <<EOF
[Unit]
Description=MTProxy Node Service
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose up
ExecStop=/usr/bin/docker compose down
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    echo "-> Systemd service created: mtproxy-node.service"
}

# Update function
perform_update() {
    echo ""
    echo "-> Updating..."

    # Check if installation directory exists
    if [ ! -d "$INSTALL_DIR" ]; then
        echo "X Installation directory $INSTALL_DIR not found"
        echo "   Run full installation first:"
        echo "   curl -fsSL https://raw.githubusercontent.com/goodboy34-tech/eeee/master/install-node.sh | sudo bash"
        exit 1
    fi

    cd "$INSTALL_DIR"

    # Check write permissions
    if [ ! -w "$INSTALL_DIR" ]; then
        echo "X No write permissions to $INSTALL_DIR"
        echo "   Make sure you're running as root: sudo bash ..."
        exit 1
    fi

    # Ensure node-agent directory exists and has proper permissions
    mkdir -p node-agent/src
    chown -R root:root node-agent
    chmod -R 755 node-agent

    # Download updated files
    REPO_URL="https://raw.githubusercontent.com/goodboy34-tech/eeee/master/node-agent"
    FILES=(
        "package.json"
        "package-lock.json"
        "tsconfig.json"
        "Dockerfile"
        ".env.example"
    )

    echo "Downloading updates..."
    for file in "${FILES[@]}"; do
        echo "  * $file"
        rm -f "node-agent/$file"  # Remove if exists
        if ! curl -fsSL "$REPO_URL/$file" -o "node-agent/$file"; then
            echo "X Failed to download $file"
            exit 1
        fi
        chmod 644 "node-agent/$file"
    done

    # Load updated api.ts
    echo "  / src/api.ts"
    rm -f "node-agent/src/api.ts"  # Remove if exists
    if ! curl -fsSL "$REPO_URL/src/api.ts" -o "node-agent/src/api.ts"; then
        echo "X Failed to download src/api.ts"
        exit 1
    fi
    chmod 644 "node-agent/src/api.ts"

    # Create systemd service
    create_systemd_service

    # Restart service
    systemctl daemon-reload
    systemctl enable mtproxy-node
    systemctl restart mtproxy-node

    # Show API KEY
    if [ -f "node-agent/.env" ]; then
        API_KEY=$(grep "^API_TOKEN=" node-agent/.env | cut -d '=' -f2)
        if [ -n "$API_KEY" ]; then
            IP=$(curl -s ifconfig.me)
            echo ""
            echo "-> Update completed!"
            echo ""
            echo "Data for adding to bot:"
            echo "==============================================="
            echo "name: Node-1"
            echo "ip: $IP"
            echo "api_key: $API_KEY"
            echo "==============================================="
        fi
    fi
    exit 0
}

# Show API KEY function
show_api_key() {
    echo ""
    if [ -f "$INSTALL_DIR/node-agent/.env" ]; then
        API_KEY=$(grep "^API_TOKEN=" "$INSTALL_DIR/node-agent/.env" | cut -d '=' -f2)
        IP=$(curl -s ifconfig.me)
        if [ -n "$API_KEY" ]; then
            echo "Data for adding to bot:"
            echo "==============================================="
            echo "name: Node-1"
            echo "ip: $IP"
            echo "api_key: $API_KEY"
            echo "==============================================="
        else
            echo "X API_TOKEN not found in .env file"
        fi
    else
        echo "X .env file not found"
    fi
    exit 0
}

# Reinstall function
perform_reinstall() {
    echo ""
    echo "X WARNING! All data will be deleted!"
    read -p "Continue? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "Cancelled"
        exit 0
    fi
    cd "$INSTALL_DIR"
    docker compose down -v
    cd /
    rm -rf "$INSTALL_DIR"
    echo "-> Old installation removed"
}

# New installation function
perform_install() {
    # Install Docker
    if ! command -v docker &>/dev/null; then
        echo "* Installing Docker..."
        curl -fsSL https://get.docker.com | sh
        systemctl enable docker
        systemctl start docker
        echo "-> Docker installed"
    else
        echo "-> Docker already installed: $(docker --version)"
    fi

    # Check Docker Compose
    if ! docker compose version &>/dev/null; then
        echo "X Docker Compose not found. Update Docker to version with built-in Compose."
        exit 1
    fi

    echo "-> Docker Compose: $(docker compose version)"

    # Determine IP
    echo ""
    echo "* Determining IP address..."
    EXTERNAL_IP=$(curl -s ifconfig.me || curl -s api.ipify.org || echo "")
    if [ -z "$EXTERNAL_IP" ]; then
        echo "! Could not determine IP automatically"
        read -p "Enter external IP of this server: " EXTERNAL_IP
    fi
    echo "* External IP: $EXTERNAL_IP"

    echo ""
    echo "* Downloading node-agent..."
    mkdir -p "$INSTALL_DIR/node-agent"
    cd "$INSTALL_DIR"

    # Download only necessary node-agent files from GitHub
    REPO_URL="https://raw.githubusercontent.com/goodboy34-tech/eeee/master/node-agent"
    FILES=(
        "package.json"
        "package-lock.json"
        "tsconfig.json"
        "Dockerfile"
        ".env.example"
    )

    echo "Downloading files..."
    for file in "${FILES[@]}"; do
        echo "  * $file"
        curl -fsSL "$REPO_URL/$file" -o "node-agent/$file"
    done

    # Load src directory
    echo "  / src/"
    mkdir -p node-agent/src
    curl -fsSL "$REPO_URL/src/api.ts" -o "node-agent/src/api.ts"

    echo "-> node-agent downloaded"

    echo ""
    echo "========================================================"
    echo "  Node Setup"
    echo "========================================================"
    echo ""

    # Generate API key for authorization
    echo "Generating API key..."
    API_KEY=$(openssl rand -hex 32)
    echo "* API Key: $API_KEY"

    echo ""
    echo "* Creating node-agent configuration..."

    # Minimal configuration - everything else is configured via API
    cat > node-agent/.env <<EOF
# API Configuration
API_TOKEN=$API_KEY
API_PORT=3000

# Node Environment
NODE_ENV=production
EOF

    echo "-> Configuration created: node-agent/.env"

    # Create .env in root for docker-compose
    echo ""
    echo "* Creating .env for docker-compose..."

    cat > .env <<EOF
# API Configuration
API_TOKEN=$API_KEY
API_PORT=3000
EOF

    echo "-> .env created"

    # Create docker-compose for standalone node
    echo ""
    echo "* Creating docker-compose.yml..."

    cat > docker-compose.yml <<'COMPOSE_EOF'
services:
  node-agent:
    build:
      context: ./node-agent
      dockerfile: Dockerfile
    container_name: mtproxy-node-agent
    restart: unless-stopped
    env_file:
      - ./node-agent/.env
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data
    ports:
      - "${API_PORT:-3000}:3000"
    networks:
      - mtproxy-network

networks:
  mtproxy-network:
    driver: bridge
COMPOSE_EOF

    echo "-> docker-compose.yml created"

    # Firewall setup
    echo ""
    read -p "Setup firewall automatically? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "* Setting up firewall..."
        if command -v ufw &>/dev/null; then
            ufw allow 443/tcp comment "MTProxy"
            ufw allow 1080/tcp comment "SOCKS5"
            ufw allow 3000/tcp comment "Node API"
            echo "-> UFW rules added"
        elif command -v firewall-cmd &>/dev/null; then
            firewall-cmd --permanent --add-port=443/tcp
            firewall-cmd --permanent --add-port=1080/tcp
            firewall-cmd --permanent --add-port=3000/tcp
            firewall-cmd --reload
            echo "-> FirewallD rules added"
        else
            echo "! Firewall not detected, configure manually:"
            echo "   Ports: 443, 1080, 3000"
        fi
    else
        echo "! Don't forget to open ports manually:"
        echo "   443/tcp  - MTProxy"
        echo "   1080/tcp - SOCKS5"
        echo "   3000/tcp - Node API"
    fi

    # Create and start systemd service
    echo ""
    echo "* Creating and starting MTProxy Node service..."
    create_systemd_service
    systemctl daemon-reload
    systemctl enable mtproxy-node
    systemctl start mtproxy-node

    echo ""
    echo "* Waiting for service to start..."
    sleep 10

    # Check status
    echo ""
    echo "* Service status:"
    systemctl status mtproxy-node --no-pager -l

    # Create global management command
    echo ""
    echo "* Creating global 'mtproxy-node' command..."

    cat > /usr/local/bin/mtproxy-node <<'NODE_SCRIPT_EOF'
#!/bin/bash

INSTALL_DIR="/opt/mtproxy-node"

if [ ! -d "$INSTALL_DIR" ]; then
    echo "X Node not installed in $INSTALL_DIR"
    exit 1
fi

cd "$INSTALL_DIR"

case "$1" in
    status)
        echo "* MTProxy Node Status:"
        systemctl status mtproxy-node --no-pager -l
        echo ""
        echo "* Container status:"
        docker compose ps
        echo ""
        echo "* Resources:"
        docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"
        ;;
    logs)
        if [ -n "$2" ]; then
            docker compose logs -f "$2"
        else
            docker compose logs -f
        fi
        ;;
    restart)
        echo "* Restarting service..."
        systemctl restart mtproxy-node
        echo "-> Restarted"
        ;;
    update)
        echo "* Updating from GitHub..."
        curl -fsSL https://raw.githubusercontent.com/goodboy34-tech/eeee/master/install-node.sh | bash
        ;;
    rebuild)
        echo "* Rebuilding containers..."
        systemctl stop mtproxy-node
        docker compose down
        docker compose up -d --build
        systemctl start mtproxy-node
        echo "-> Rebuilt"
        ;;
    setup)
        echo ""
        echo "========================================================"
        echo "  Adding API TOKEN from bot"
        echo "========================================================"
        echo ""

        read -p "Enter API TOKEN from bot: " API_TOKEN

        if [ -z "$API_TOKEN" ]; then
            echo "X API TOKEN cannot be empty!"
            return 1
        fi

        # Add API_TOKEN to .env
        if grep -q "^API_TOKEN=" node-agent/.env 2>/dev/null; then
            sed -i "s/^API_TOKEN=.*/API_TOKEN=$API_TOKEN/" node-agent/.env
            echo "-> API TOKEN updated"
        else
            echo "API_TOKEN=$API_TOKEN" >> node-agent/.env
            echo "-> API TOKEN added"
        fi

        # Restart node-agent
        echo ""
        echo "* Restarting node-agent..."
        docker compose restart node-agent

        echo ""
        echo "-> Done! Check connection:"
        echo "   docker compose logs -f node-agent"
        ;;
    config)
        echo "* Current configuration:"
        echo "* Directory: $INSTALL_DIR"
        echo ""
        if [ -f ".env" ]; then
            echo "* .env:"
            cat .env
            echo ""
        fi
        if [ -f "node-agent/.env" ]; then
            echo "* node-agent/.env:"
            cat node-agent/.env
            echo ""
        fi
        ;;
    shell)
        if [ -z "$2" ]; then
            echo "Usage: mtproxy-node shell <service>"
            echo "Available services:"
            docker compose ps --services
            exit 1
        fi
        docker compose exec "$2" /bin/sh
        ;;
    proxy-link)
        echo "* MTProxy links:"
        # Look for links in logs
        SECRET_LINE=$(docker logs mtproxy 2>&1 | grep -E "tg://|t.me/proxy" | head -1 || echo "")
        if [ -n "$SECRET_LINE" ]; then
            echo "$SECRET_LINE"
        else
            echo "X Link not found in logs"
            echo "   MTProxy may not be running yet"
        fi
        ;;
    "")
        echo "* MTProxy Node Manager"
        echo ""
        echo "Usage: mtproxy-node <command>"
        echo ""
        echo "Commands:"
        echo "  status       - show status and resources"
        echo "  logs [service] - show logs (Ctrl+C to exit)"
        echo "  restart      - restart all services"
        echo "  update       - update from GitHub"
        echo "  rebuild      - rebuild containers"
        echo "  setup        - add/update API TOKEN from bot"
        echo "  config       - show current configuration"
        echo "  shell <service> - open shell in container"
        echo "  proxy-link   - show MTProxy link"
        echo ""
        echo "Examples:"
        echo "  mtproxy-node status"
        echo "  mtproxy-node logs node-agent"
        echo "  mtproxy-node setup"
        ;;
    *)
        echo "X Unknown command: $1"
        echo "Use 'mtproxy-node' for command list"
        exit 1
        ;;
esac
NODE_SCRIPT_EOF

    chmod +x /usr/local/bin/mtproxy-node

    echo "-> 'mtproxy-node' command created"

    echo ""
    echo "========================================================"
    echo "  -> MTProxy Node installed!"
    echo "========================================================"
    echo ""
    echo "* Data for adding to bot:"
    echo ""
    echo "-----------------------------------------------------"
    echo "name: Node-1"
    echo "ip: $EXTERNAL_IP"
    echo "api_key: $API_KEY"
    echo "-----------------------------------------------------"
    echo ""
    echo "* Steps:"
    echo "1. In Telegram bot send /add_node"
    echo "2. Send the data above to the bot chat"
    echo "3. Bot will automatically configure proxies!"
    echo ""
    echo "* Management:"
    echo "   mtproxy-node status      - status"
    echo "   mtproxy-node logs        - logs"
    echo "   mtproxy-node restart     - restart"
    echo "   mtproxy-node update      - update"
    echo ""
    echo "* Directory: $INSTALL_DIR"
    echo ""
    echo "========================================================"
}

# API token setup function
setup_api_token() {
    echo ""
    echo "========================================================"
    echo "  Adding API TOKEN from bot"
    echo "========================================================"
    echo ""

    read -p "Enter API TOKEN from bot: " API_TOKEN

    if [ -z "$API_TOKEN" ]; then
        echo "X API TOKEN cannot be empty!"
        return 1
    fi

    # Add API_TOKEN to .env
    if grep -q "^API_TOKEN=" node-agent/.env 2>/dev/null; then
        sed -i "s/^API_TOKEN=.*/API_TOKEN=$API_TOKEN/" node-agent/.env
        echo "-> API TOKEN updated"
    else
        echo "API_TOKEN=$API_TOKEN" >> node-agent/.env
        echo "-> API TOKEN added"
    fi

    # Restart node-agent
    echo ""
    echo "* Restarting node-agent..."
    docker compose restart node-agent

    echo ""
    echo "-> Done! Check connection:"
    echo "   docker compose logs -f node-agent"
    echo ""
}

# Check command line arguments
if [ "$1" = "setup" ]; then
    # If run from arbitrary directory, go to install dir
    if [ -d "/opt/mtproxy-node" ]; then
        cd /opt/mtproxy-node
    else
        echo "X Node not installed in /opt/mtproxy-node"
        exit 1
    fi

    # Check docker-compose.yml presence
    if [ ! -f "docker-compose.yml" ]; then
        echo "X docker-compose.yml not found"
        echo "   Run full reinstallation:"
        echo "   curl -fsSL https://raw.githubusercontent.com/goodboy34-tech/eeee/master/install-node.sh | sudo bash"
        exit 1
    fi

    setup_api_token
    exit 0
fi

# Check for existing installation
if [ -d "$INSTALL_DIR" ]; then
    echo "* Existing installation detected"
    echo ""

    # Check if script is run interactively
    if [ -t 0 ]; then
        echo "Choose action:"
        echo "1) Update (git pull + restart)"
        echo "2) Show API KEY"
        echo "3) Reinstall (delete everything and install anew)"
        echo "4) Exit"
        echo ""
        read -p "Your choice (1-4): " choice

        case $choice in
            1)
                perform_update
                ;;
            2)
                show_api_key
                ;;
            3)
                perform_reinstall
                ;;
            4)
                echo "Exit"
                exit 0
                ;;
            *)
                echo "X Invalid choice"
                exit 1
                ;;
        esac
    else
        echo "Script run non-interactively. Performing update..."
        perform_update
    fi
else
    # New installation
    perform_install
fi

# Launch main function
main
