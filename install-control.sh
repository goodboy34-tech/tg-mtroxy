#!/bin/bash
set -e

# Ensure we have a valid working directory from the start
# This is critical for environments where cwd is corrupted
if ! pwd >/dev/null 2>&1; then
    cd /tmp 2>/dev/null || cd /root 2>/dev/null || cd / 2>/dev/null || {
        echo "X Cannot establish a valid working directory"
        exit 1
    }
fi

# Installation script path
SCRIPT_PATH="/usr/local/bin/install-control.sh"

# If script is run from URL, install it locally first
if [ ! -f "$SCRIPT_PATH" ] || [ "$0" != "$SCRIPT_PATH" ]; then
    echo "========================================================"
    echo "  Installing MTProxy Control Panel Script"
    echo "========================================================"
    echo ""

    # Root check
    if [ "$EUID" -ne 0 ]; then
        echo "X Run script with root privileges:"
        echo "   sudo bash <(curl -fsSL https://raw.githubusercontent.com/goodboy34-tech/eeee/master/install-control.sh)"
        exit 1
    fi

    echo "* Downloading script to $SCRIPT_PATH..."
    curl -fsSL https://raw.githubusercontent.com/goodboy34-tech/eeee/master/install-control.sh -o "$SCRIPT_PATH"
    chmod +x "$SCRIPT_PATH"

    echo "-> Script installed successfully!"
    echo ""
    echo "Now running the installation..."
    echo ""
    cd /tmp || cd /root || cd /
    exec "$SCRIPT_PATH" "$@"
    exit 0
fi

echo "========================================================"
echo "  MTProxy Control Panel - Installation"
echo "========================================================"
echo ""

# Root check
if [ "$EUID" -ne 0 ]; then
    echo "X Run script with root privileges:"
    echo "   sudo $SCRIPT_PATH"
    exit 1
fi

# Installation directory
INSTALL_DIR="/opt/mtproxy-control"

# Create systemd service function
create_systemd_service() {
    echo "* Creating systemd service..."

    cat > /etc/systemd/system/mtproxy-control.service <<EOF
[Unit]
Description=MTProxy Control Panel Service
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

    echo "-> Systemd service created: mtproxy-control.service"
}

# Update function
perform_update() {
    echo ""
    echo "-> Updating..."

    # Check if installation directory exists
    if [ ! -d "$INSTALL_DIR" ]; then
        echo "X Installation directory $INSTALL_DIR not found"
        echo "   Run full installation first:"
        echo "   curl -fsSL https://raw.githubusercontent.com/goodboy34-tech/eeee/master/install-control.sh | sudo bash"
        exit 1
    fi

    cd "$INSTALL_DIR" || {
        echo "X Failed to change to installation directory $INSTALL_DIR"
        exit 1
    }

    # Check write permissions
    if [ ! -w "$INSTALL_DIR" ]; then
        echo "X No write permissions to $INSTALL_DIR"
        echo "   Make sure you're running as root: sudo bash ..."
        exit 1
    fi

    # Update from git
    echo "* Updating from GitHub..."
    if ! git pull; then
        echo "X Failed to update from GitHub"
        exit 1
    fi

    # Always recreate systemd service to ensure it's up to date
    echo "* Ensuring systemd service is properly configured..."
    create_systemd_service
    if [ -f "/etc/systemd/system/mtproxy-control.service" ]; then
        echo "* Service file created successfully"
        # Validate service file syntax
        if systemctl show mtproxy-control.service >/dev/null 2>&1; then
            echo "* Service file syntax is valid"
        else
            echo "X Service file has syntax errors, checking content..."
            cat /etc/systemd/system/mtproxy-control.service
            exit 1
        fi
        systemctl daemon-reload
        systemctl enable mtproxy-control 2>/dev/null || echo "* Warning: Could not enable service"
    else
        echo "X Failed to create service file at /etc/systemd/system/mtproxy-control.service"
        ls -la /etc/systemd/system/ | head -10
        exit 1
    fi

    # Restart service
    echo "* Attempting to restart service..."
    
    # Check if Docker is running
    if ! systemctl is-active --quiet docker; then
        echo "* Docker is not running, starting Docker..."
        systemctl start docker || {
            echo "X Failed to start Docker"
            exit 1
        }
    fi
    
    if systemctl restart mtproxy-control; then
        echo "* Service restarted successfully"
    else
        echo "X Failed to restart service, checking status..."
        if systemctl status mtproxy-control --no-pager -l 2>/dev/null; then
            echo "* Service status shown above"
        else
            echo "* Service not found, checking if systemd is running..."
            if systemctl is-system-running >/dev/null 2>&1; then
                echo "* Systemd is running, service file may be corrupted"
                echo "* Service file content:"
                cat /etc/systemd/system/mtproxy-control.service 2>/dev/null || echo "* Service file not found"
                echo "* Checking systemd service list:"
                systemctl list-units --type=service | grep mtproxy || echo "* mtproxy service not in list"
            else
                echo "* Systemd is not running properly"
                systemctl status
            fi
        fi
    fi

    # Create global management command
    create_management_command

    echo ""
    echo "-> Update completed!"
    exit 0
}

# Create management command function
create_management_command() {
    echo "* Creating global 'mtproxy-control' command..."

    cat > /usr/local/bin/mtproxy-control <<'SCRIPT_EOF'
#!/bin/bash

INSTALL_DIR="/opt/mtproxy-control"

if [ ! -d "$INSTALL_DIR" ]; then
    echo "X Control Panel not installed in $INSTALL_DIR"
    exit 1
fi

cd "$INSTALL_DIR"

case "$1" in
    status)
        echo "* MTProxy Control Panel Status:"
        systemctl status mtproxy-control --no-pager -l
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
        systemctl restart mtproxy-control
        echo "-> Restarted"
        ;;
    update)
        echo "* Updating from GitHub..."
        curl -fsSL https://raw.githubusercontent.com/goodboy34-tech/eeee/master/install-control.sh | bash
        ;;
    rebuild)
        echo "* Rebuilding containers..."
        systemctl stop mtproxy-control
        docker compose down
        docker compose build --no-cache
        systemctl start mtproxy-control
        echo "-> Rebuilt"
        ;;
    shell)
        if [ -n "$2" ]; then
            docker compose exec "$2" /bin/sh
        else
            echo "Usage: mtproxy-control shell <service>"
        fi
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
        ;;
    backup)
        BACKUP_FILE="backup-$(date +%Y%m%d-%H%M%S).tar.gz"
        echo "* Creating backup: $BACKUP_FILE"
        tar -czf "$BACKUP_FILE" .env data/ 2>/dev/null || true
        echo "-> Backup created: $BACKUP_FILE"
        ;;
    restore)
        if [ -z "$2" ]; then
            echo "Usage: mtproxy-control restore <backup-file>"
            exit 1
        fi
        
        if [ ! -f "$2" ]; then
            echo "X Backup file not found: $2"
            exit 1
        fi
        
        echo "* Restoring from backup: $2"
        systemctl stop mtproxy-control
        tar -xzf "$2"
        systemctl start mtproxy-control
        echo "-> Backup restored and service restarted"
        ;;
    *)
        echo "MTProxy Control Panel Management Tool"
        echo ""
        echo "Usage: mtproxy-control <command>"
        echo ""
        echo "Commands:"
        echo "  status    - Show service and container status"
        echo "  logs      - Show container logs (use 'logs <service>' for specific)"
        echo "  restart   - Restart the service"
        echo "  update    - Update from GitHub"
        echo "  rebuild   - Rebuild containers"
        echo "  shell     - Open shell in container"
        echo "  config    - Show current configuration"
        echo "  backup    - Create backup archive"
        echo "  restore   - Restore from backup"
        echo ""
        echo "Examples:"
        echo "  mtproxy-control status"
        echo "  mtproxy-control logs"
        echo "  mtproxy-control restart"
        ;;
esac
SCRIPT_EOF

    chmod +x /usr/local/bin/mtproxy-control
    echo "-> Global command created: mtproxy-control"
}

# Show bot info function
show_bot_info() {
    echo ""
    if [ -f "$INSTALL_DIR/control-panel/.env" ]; then
        BOT_TOKEN=$(grep "^BOT_TOKEN=" "$INSTALL_DIR/control-panel/.env" | cut -d '=' -f2)
        IP=$(curl -s ifconfig.me)
        if [ -n "$BOT_TOKEN" ]; then
            echo "Control Panel Information:"
            echo "==============================================="
            echo "Server IP: $IP"
            echo "Bot Token: $BOT_TOKEN"
            echo "Web Panel: http://$IP:3000"
            echo "==============================================="
            echo ""
            echo "To access the web panel:"
            echo "1. Open http://$IP:3000 in your browser"
            echo "2. Use the bot token above to authenticate"
        else
            echo "X BOT_TOKEN not found in .env file"
        fi
    else
        echo "X Control panel .env file not found"
        echo "   Installation may be incomplete"
    fi
    echo ""
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

    # Clone repository
    echo ""
    echo "* Cloning repository..."
    if [ -d "$INSTALL_DIR" ]; then
        echo "X Directory $INSTALL_DIR already exists"
        echo "   Remove it first or use update"
        exit 1
    fi

    git clone https://github.com/goodboy34-tech/eeee.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"

    echo ""
    echo "========================================================"
    echo "  Control Panel Setup"
    echo "========================================================"
    echo ""

    # Request Telegram Bot Token
    read -p "Enter Telegram Bot Token: " BOT_TOKEN
    if [ -z "$BOT_TOKEN" ]; then
        echo "X Bot Token cannot be empty!"
        exit 1
    fi

    # Create .env for control-panel
    echo ""
    echo "* Creating configuration..."

    cat > control-panel/.env <<EOF
# Telegram Bot Configuration
BOT_TOKEN=$BOT_TOKEN

# Database
DATABASE_PATH=./data/database.sqlite

# Server
PORT=3000
NODE_ENV=production
EOF

    echo "-> Configuration created: control-panel/.env"

    # Firewall setup
    echo ""
    read -p "Setup firewall for port 3000? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if command -v ufw &>/dev/null; then
            ufw allow 3000/tcp comment "MTProxy Control Panel"
            echo "-> UFW rule added"
        elif command -v firewall-cmd &>/dev/null; then
            firewall-cmd --permanent --add-port=3000/tcp
            firewall-cmd --reload
            echo "-> FirewallD rule added"
        else
            echo "! Firewall not detected"
        fi
    else
        echo "! Don't forget to open port 3000 manually"
    fi

    # Create and start systemd service
    echo ""
    echo "* Creating and starting Control Panel service..."
    create_systemd_service
    systemctl daemon-reload
    systemctl enable mtproxy-control
    systemctl start mtproxy-control

    echo ""
    echo "* Waiting for service to start..."
    sleep 10

    # Check status
    echo ""
    echo "* Service status:"
    systemctl status mtproxy-control --no-pager -l

    # Create global management command
    create_management_command

    echo ""
    echo "========================================================"
    echo "  -> Control Panel installed!"
    echo "========================================================"
    echo ""
    echo "* Telegram Bot is running"
    echo ""
    echo "* Management:"
    echo "   mtproxy-control status      - status"
    echo "   mtproxy-control logs        - logs"
    echo "   mtproxy-control restart     - restart"
    echo "   mtproxy-control update      - update"
    echo ""
    echo "* Directory: $INSTALL_DIR"
    echo ""
    echo "========================================================"
}

# Check for existing installation
if [ -d "$INSTALL_DIR" ]; then
    echo "* Existing installation detected"
    echo ""

    # Check if script is run interactively
    if [ -t 0 ]; then
        echo "Choose action:"
        echo "1) Update (git pull + restart)"
        echo "2) Show Bot Info"
        echo "3) Reinstall (delete everything and install anew)"
        echo "4) Exit"
        echo ""
        read -p "Your choice (1-4): " choice

        case $choice in
            1)
                perform_update
                ;;
            2)
                show_bot_info
                ;;
            3)
                echo ""
                echo "X WARNING! All data will be deleted!"
                read -p "Continue? (yes/no): " confirm
                if [ "$confirm" != "yes" ]; then
                    echo "Cancelled"
                    exit 0
                fi
                cd "$INSTALL_DIR"
                systemctl stop mtproxy-control 2>/dev/null || true
                docker compose down -v 2>/dev/null || true
                cd /
                rm -rf "$INSTALL_DIR"
                echo "-> Old installation removed"
                perform_install
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
